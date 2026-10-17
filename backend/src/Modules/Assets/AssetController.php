<?php
declare(strict_types=1);

namespace DuskDex\Modules\Assets;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Mailer;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Response;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Shared\Repo;

/**
 * Biblioteca de imagens próprias (capas, recortes, panoramas, avatar e banner).
 * - Upload binário (corpo da requisição = arquivo), tipo verificado pelo conteúdo (não pela extensão).
 * - Metadados removidos (EXIF/GPS) sem recompressão; o original não é alterado de outra forma.
 * - Arquivos ficam FORA da pasta pública (STORAGE_PATH/uploads) e são servidos por esta API:
 *   privados ao dono, exceto quando usados em perfil (avatar/banner) ou em fichário público/não listado.
 */
final class AssetController
{
    private const MIMES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];

    public static function maxUpload(): int
    {
        $toBytes = function (string $v): int {
            $v = trim($v);
            if ($v === '' || $v === '0' || $v === '-1') { return PHP_INT_MAX; }
            $n = (int) $v; $u = strtolower(substr($v, -1));
            return match ($u) { 'g' => $n * 1024 ** 3, 'm' => $n * 1024 ** 2, 'k' => $n * 1024, default => $n };
        };
        return (int) min(15 * 1024 * 1024, $toBytes((string) ini_get('post_max_size')));
    }

    public static function out(array $a): array
    {
        return [
            'id' => $a['public_id'], 'name' => $a['name'], 'mime' => $a['mime'], 'width' => (int) $a['width'], 'height' => (int) $a['height'],
            'size' => (int) $a['size_bytes'], 'createdAt' => Repo::iso($a['created_at']), 'url' => 'api/v1/assets/' . $a['public_id'] . '/file',
        ];
    }

    public static function index(Request $r): array
    {
        return array_map([self::class, 'out'], Database::all('SELECT * FROM assets WHERE owner_id = ? ORDER BY id DESC', [Security::userId()]));
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('upload:' . $uid, Env::int('RATE_UPLOADS_PER_HOUR', 120), 3600);
        $bytes = $r->raw();
        $max = self::maxUpload();
        if ($bytes === '') {
            throw HttpException::validation('Arquivo vazio. Se a imagem for grande, o servidor pode ter recusado o envio (limite de ' . round($max / 1048576, 1) . ' MB).');
        }
        if (strlen($bytes) > $max) {
            throw new HttpException(413, 'TOO_LARGE', 'Imagem acima do limite de ' . round($max / 1048576, 1) . ' MB.');
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes) ?: '';
        if (!isset(self::MIMES[$mime])) {
            throw HttpException::validation('Formato não suportado. Envie PNG, JPEG ou WebP.');
        }
        $info = @getimagesizefromstring($bytes);
        if (!$info || $info[0] < 16 || $info[1] < 16 || $info[0] > 12000 || $info[1] > 12000) {
            throw HttpException::validation('Imagem inválida ou com dimensões fora do permitido (16 a 12000 px).');
        }
        $clean = ImageSanitizer::clean($bytes, $mime);
        if ($clean === null) {
            throw HttpException::validation('Não foi possível ler a estrutura da imagem. Tente exportá-la novamente em PNG, JPEG ou WebP.');
        }
        $quotaMb = Env::int('ASSET_QUOTA_MB', 500);
        $used = (int) (Database::one('SELECT COALESCE(SUM(size_bytes), 0) n FROM assets WHERE owner_id = ?', [$uid])['n'] ?? 0);
        if ($used + strlen($clean) > $quotaMb * 1048576) {
            throw HttpException::rule('QUOTA', "Sua biblioteca atingiu o limite de $quotaMb MB. Exclua imagens que não usa mais.");
        }
        $name = rawurldecode((string) ($r->header('x-file-name') ?? 'imagem'));
        $name = mb_substr(trim(preg_replace('/[\x00-\x1f\x7f\/\\\\]+/u', ' ', $name) ?? 'imagem'), 0, 120) ?: 'imagem';
        $pub = Ulid::generate();
        $rel = 'uploads/' . $uid . '/' . $pub . '.' . self::MIMES[$mime];
        $abs = Mailer::storageDir() . '/' . $rel;
        if (!is_dir(dirname($abs)) && !mkdir(dirname($abs), 0770, true) && !is_dir(dirname($abs))) {
            throw new \RuntimeException('Não foi possível criar a pasta de uploads (verifique STORAGE_PATH).');
        }
        if (file_put_contents($abs, $clean, LOCK_EX) !== strlen($clean)) {
            throw new \RuntimeException('Falha ao gravar a imagem.');
        }
        try {
            $id = Database::insert('INSERT INTO assets (public_id, owner_id, name, mime, width, height, size_bytes, sha256, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$pub, $uid, $name, $mime, $info[0], $info[1], strlen($clean), hash('sha256', $clean), $rel, Repo::now()]);
        } catch (\Throwable $e) {
            @unlink($abs);
            throw $e;
        }
        Repo::activity($uid, 'asset', "Imagem “{$name}” enviada para a biblioteca", 'image');
        return self::out(Database::one('SELECT * FROM assets WHERE id = ?', [$id]));
    }

    /** Quem pode ver: o dono; qualquer pessoa se a imagem for avatar/banner ou estiver num fichário público/não listado. */
    public static function canView(array $a, ?int $viewer): bool
    {
        if ($viewer !== null && $viewer === (int) $a['owner_id']) { return true; }
        if (Database::one('SELECT 1 FROM users WHERE id = ? AND (avatar_asset_id = ? OR banner_asset_id = ?)', [$a['owner_id'], $a['id'], $a['id']])) { return true; }
        return (bool) Database::one("SELECT 1 FROM binders WHERE owner_id = ? AND visibility IN ('public', 'unlisted') AND (pages LIKE ? OR appearance LIKE ?) LIMIT 1",
            [$a['owner_id'], '%' . $a['public_id'] . '%', '%' . $a['public_id'] . '%']);
    }

    public static function file(Request $r): ?array
    {
        $a = Database::one('SELECT * FROM assets WHERE public_id = ?', [$r->params['id']]);
        $viewer = Security::userId();
        if (!$a || !self::canView($a, $viewer)) { throw HttpException::notFound('Imagem não encontrada.'); }
        $abs = Mailer::storageDir() . '/' . $a['path'];
        if (!is_file($abs)) { throw HttpException::notFound('Arquivo da imagem não encontrado no servidor.'); }
        Response::file($abs, $a['mime'], $viewer === (int) $a['owner_id'], $a['sha256']);
        return null; // resposta já enviada
    }

    public static function usage(Request $r): array
    {
        $uid = (int) Security::userId();
        $a = Database::one('SELECT * FROM assets WHERE public_id = ? AND owner_id = ?', [$r->params['id'], $uid]);
        if (!$a) { throw HttpException::notFound('Imagem não encontrada.'); }
        return self::uses($a, $uid);
    }

    private static function uses(array $a, int $uid): array
    {
        $uses = [];
        $u = Database::one('SELECT avatar_asset_id, banner_asset_id FROM users WHERE id = ?', [$uid]);
        if ((int) ($u['avatar_asset_id'] ?? 0) === (int) $a['id']) { $uses[] = ['binder' => null, 'where' => 'avatar do perfil']; }
        if ((int) ($u['banner_asset_id'] ?? 0) === (int) $a['id']) { $uses[] = ['binder' => null, 'where' => 'banner do perfil']; }
        $rows = Database::all('SELECT public_id, name, pages, appearance FROM binders WHERE owner_id = ? AND (pages LIKE ? OR appearance LIKE ?)', [$uid, '%' . $a['public_id'] . '%', '%' . $a['public_id'] . '%']);
        foreach ($rows as $b) {
            $brief = ['id' => $b['public_id'], 'name' => $b['name']];
            if ((Repo::decode($b['appearance'])['coverAssetId'] ?? null) === $a['public_id']) { $uses[] = ['binder' => $brief, 'where' => 'capa']; }
            foreach (Repo::decode($b['pages']) as $pi => $p) {
                foreach ($p['slots'] ?? [] as $si => $s) {
                    if (($s['assetId'] ?? null) === $a['public_id']) { $uses[] = ['binder' => $brief, 'where' => 'pág. ' . ($pi + 1) . ', bolso ' . ($si + 1)]; }
                }
            }
        }
        return $uses;
    }

    public static function destroy(Request $r): array
    {
        $uid = (int) Security::userId();
        $a = Database::one('SELECT * FROM assets WHERE public_id = ? AND owner_id = ?', [$r->params['id'], $uid]);
        if (!$a) { throw HttpException::notFound('Imagem não encontrada.'); }
        $uses = self::uses($a, $uid);
        if ($uses) { throw HttpException::rule('IN_USE', 'Imagem em uso (' . count($uses) . ' lugar(es)). Remova-a dos fichários e do perfil antes de excluir.'); }
        Database::exec('DELETE FROM assets WHERE id = ?', [$a['id']]);
        @unlink(Mailer::storageDir() . '/' . $a['path']);
        return ['ok' => true];
    }

    /** Converte ID público → interno, conferindo o dono (para referências em fichários/perfil). */
    public static function ownedId(int $uid, mixed $pub): ?int
    {
        if (!is_string($pub) || $pub === '') { return null; }
        $row = Database::one('SELECT id FROM assets WHERE public_id = ? AND owner_id = ?', [$pub, $uid]);
        if (!$row) { throw HttpException::validation('Imagem não encontrada na sua biblioteca.'); }
        return (int) $row['id'];
    }
}
