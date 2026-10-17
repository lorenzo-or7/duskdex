<?php
declare(strict_types=1);

namespace DuskDex\Modules\Community;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Modules\Shared\Repo;

/** Utilidades sociais: perfis públicos resumidos, bloqueios, notificações e snapshots de cartas para exibição. */
final class Social
{
    public static function assetUrl(?string $pub): ?string
    {
        return $pub ? 'api/v1/assets/' . $pub . '/file' : null;
    }

    /** Resumo público de usuários (nunca e-mail, localização ou inventário). @return array<int, array> por id interno */
    public static function briefs(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', array_filter($ids))));
        if (!$ids) { return []; }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $rows = Database::all("SELECT u.id, u.public_id, u.username, u.display_name, a.public_id AS avatar FROM users u LEFT JOIN assets a ON a.id = u.avatar_asset_id WHERE u.id IN ($in)", $ids);
        $out = [];
        foreach ($rows as $u) {
            $out[(int) $u['id']] = ['id' => $u['public_id'], 'username' => $u['username'], 'displayName' => $u['display_name'], 'avatarUrl' => self::assetUrl($u['avatar'])];
        }
        return $out;
    }

    public static function userByUsername(string $username): array
    {
        $u = Database::one("SELECT * FROM users WHERE username = ? AND status = 'active'", [mb_strtolower($username)]);
        if (!$u) { throw HttpException::notFound('Colecionador não encontrado.'); }
        return $u;
    }

    /** Verdadeiro se um dos dois bloqueou o outro. */
    public static function blockedBetween(?int $a, int $b): bool
    {
        if ($a === null || $a === $b) { return false; }
        return (bool) Database::one('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [$a, $b, $b, $a]);
    }

    /** Ids de usuários que o visitante não deve ver (bloqueou ou foi bloqueado). */
    public static function hiddenFor(?int $viewer): array
    {
        if ($viewer === null) { return []; }
        $rows = Database::all('SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = ?', [$viewer, $viewer]);
        return array_map(fn ($r) => (int) $r['id'], $rows);
    }

    public static function notify(int $userId, ?int $actorId, string $type, string $text, ?string $refType = null, ?string $refPub = null): void
    {
        if ($actorId !== null && ($actorId === $userId || self::blockedBetween($actorId, $userId))) { return; }
        Database::exec('INSERT INTO notifications (user_id, actor_id, type, ref_type, ref_public, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$userId, $actorId, $type, $refType, $refPub, mb_substr($text, 0, 255), Repo::now()]);
    }

    /**
     * Snapshots de cartas para exibição pública: global verificado (owner 0) ou, na falta, o privado do dono.
     * @return array<string, array> por card_key
     */
    public static function snapshots(array $keys, ?int $ownerId = null): array
    {
        $keys = array_values(array_unique(array_filter($keys, 'is_string')));
        if (!$keys) { return []; }
        $in = implode(',', array_fill(0, count($keys), '?'));
        $params = $keys;
        $sql = "SELECT card_key, data, owner_id FROM card_snapshots WHERE card_key IN ($in) AND (owner_id = 0";
        if ($ownerId !== null) { $sql .= ' OR owner_id = ?'; $params[] = $ownerId; }
        $sql .= ')';
        $out = [];
        foreach (Database::all($sql, $params) as $row) {
            if (!isset($out[$row['card_key']]) || (int) $row['owner_id'] === 0) {
                $snap = Repo::decode($row['data']);
                if (($snap['source'] ?? '') === 'custom') { $snap['assetId'] = null; } // imagens de cartas personalizadas são privadas
                $out[$row['card_key']] = $snap;
            }
        }
        return $out;
    }

    /** Texto livre: remove caracteres de controle (exceto quebra de linha) e espaços sobrando. */
    public static function text(mixed $v, int $min, int $max, string $label): string
    {
        if (!is_string($v)) { throw HttpException::validation("$label é obrigatório."); }
        $t = trim((string) preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', $v));
        $t = (string) preg_replace("/\n{3,}/", "\n\n", $t);
        $len = mb_strlen($t);
        if ($len < $min || $len > $max) { throw HttpException::validation("$label deve ter entre $min e $max caracteres."); }
        return $t;
    }
}
