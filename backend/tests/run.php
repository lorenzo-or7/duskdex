<?php
declare(strict_types=1);

// Testes de integração da API (PHP puro + extensão curl). Exercitam o servidor real e o MySQL.
// Pré-requisitos: banco migrado e servidor rodando (php -S 127.0.0.1:8080 server.php).
// Uso: php backend/tests/run.php [URL base]   — padrão http://127.0.0.1:8080/api/v1
// Recusa rodar com APP_ENV=production (limpa os contadores de rate limit do banco de desenvolvimento).

require dirname(__DIR__) . '/bootstrap.php';

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;

if (Env::get('APP_ENV') === 'production') {
    fwrite(STDERR, "Recusado: não rode testes contra produção.\n");
    exit(1);
}
Database::exec('DELETE FROM rate_limits'); // execuções anteriores não devem disparar o limite

$BASE = rtrim($argv[1] ?? 'http://127.0.0.1:8080/api/v1', '/');

final class Client
{
    private string $jar;
    public ?string $csrf = null;

    public function __construct(private string $base)
    {
        $this->jar = tempnam(sys_get_temp_dir(), 'ddjar');
    }

    /** @return array{0:int,1:array} */
    public function call(string $method, string $path, ?array $body = null, bool $withCsrf = true): array
    {
        $ch = curl_init($this->base . $path);
        $headers = ['Accept: application/json'];
        if ($body !== null) { $headers[] = 'Content-Type: application/json'; }
        if ($withCsrf && $method !== 'GET' && $this->csrf) { $headers[] = 'X-CSRF-Token: ' . $this->csrf; }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_COOKIEJAR => $this->jar, CURLOPT_COOKIEFILE => $this->jar, CURLOPT_TIMEOUT => 15,
        ]);
        if ($body !== null) { curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body)); }
        $raw = (string) curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, json_decode($raw, true) ?? []];
    }

    /** Envio binário (upload de imagem). */
    public function upload(string $path, string $bytes, string $name, string $type = 'application/octet-stream'): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'POST', CURLOPT_RETURNTRANSFER => true, CURLOPT_POSTFIELDS => $bytes,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: ' . $type, 'X-File-Name: ' . rawurlencode($name), 'X-CSRF-Token: ' . $this->csrf],
            CURLOPT_COOKIEJAR => $this->jar, CURLOPT_COOKIEFILE => $this->jar, CURLOPT_TIMEOUT => 30,
        ]);
        $raw = (string) curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, json_decode($raw, true) ?? []];
    }

    /** GET bruto (arquivos): [status, corpo, content-type]. */
    public function raw(string $path): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $this->jar, CURLOPT_COOKIEFILE => $this->jar, CURLOPT_TIMEOUT => 15]);
        $raw = (string) curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        return [$code, $raw, $type];
    }

    public function login(string $login, string $password = 'senha-segura-123'): int
    {
        $this->refreshCsrf();
        [$code] = $this->call('POST', '/auth/login', ['login' => $login, 'password' => $password]);
        $this->refreshCsrf();
        return $code;
    }

    public function refreshCsrf(): void
    {
        [, $j] = $this->call('GET', '/auth/csrf');
        $this->csrf = $j['data']['token'] ?? null;
    }

    public function register(string $user): int
    {
        $this->refreshCsrf();
        [$code] = $this->call('POST', '/auth/register', ['displayName' => $user, 'username' => $user, 'email' => "$user@example.com", 'password' => 'senha-segura-123', 'acceptTerms' => true]);
        $this->refreshCsrf(); // a sessão é regenerada no login/registro
        return $code;
    }
}

$passed = 0; $failed = 0;
function check(string $name, bool $ok, string $detail = ''): void
{
    global $passed, $failed;
    if ($ok) { $passed++; echo "✓ $name\n"; } else { $failed++; echo "✗ $name" . ($detail ? " — $detail" : '') . "\n"; }
}

$suffix = substr(bin2hex(random_bytes(4)), 0, 7);
$a = new Client($BASE);
$b = new Client($BASE);

// 1) Autenticação obrigatória
[$code] = $a->call('GET', '/binders');
check('sem sessão: GET /binders → 401', $code === 401, "veio $code");

// 2) Registro
check('registro do usuário A', $a->register("ita$suffix") === 200);
check('registro do usuário B', $b->register("itb$suffix") === 200);

// 3) CSRF
[$code] = $a->call('POST', '/binders', ['name' => 'X', 'type' => 'virtual', 'rows' => 3, 'cols' => 3], false);
check('POST sem token CSRF → 403', $code === 403, "veio $code");

// 4) Uma cópia física ocupa um único bolso
$key = "custom:custom_it$suffix";
[$code] = $a->call('POST', '/cards', ['cards' => [['key' => $key, 'name' => 'Carta de teste', 'lang' => 'pt-br']]]);
check('registra carta personalizada', $code === 200, "veio $code");
[$code, $j] = $a->call('POST', '/collection/copies', ['items' => [['cardKey' => $key, 'qty' => 2, 'lang' => 'pt-br']]]);
$copies = $j['data']['copies'] ?? [];
check('cadastrar 2 unidades cria 2 cópias individuais', $code === 201 && count($copies) === 2, "veio $code / " . count($copies));
$copyId = $copies[0]['id'] ?? '';

[$code, $j] = $a->call('POST', '/binders', ['name' => 'Físico A', 'type' => 'physical', 'rows' => 3, 'cols' => 3, 'pages' => 2]);
$f1 = $j['data'] ?? [];
[, $j] = $a->call('POST', '/binders', ['name' => 'Físico B', 'type' => 'physical', 'rows' => 3, 'cols' => 3, 'pages' => 1]);
$f2 = $j['data'] ?? [];
check('cria dois fichários físicos', !empty($f1['id']) && !empty($f2['id']));

$p1 = $f1['pages'][0]['id'] ?? ''; $p2 = $f2['pages'][0]['id'] ?? '';
[$code] = $a->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'place', 'pageId' => $p1, 'index' => 0, 'copyId' => $copyId]]]);
check('coloca a cópia no fichário 1', $code === 200, "veio $code");
[$code] = $a->call('POST', "/binders/{$f2['id']}/ops", ['ops' => [['op' => 'place', 'pageId' => $p2, 'index' => 4, 'copyId' => $copyId]]]);
check('coloca a MESMA cópia no fichário 2', $code === 200, "veio $code");
[, $j1] = $a->call('GET', "/binders/{$f1['id']}");
[, $j2] = $a->call('GET', "/binders/{$f2['id']}");
$in1 = ($j1['data']['pages'][0]['slots'][0]['copyId'] ?? null) === $copyId;
$in2 = ($j2['data']['pages'][0]['slots'][4]['copyId'] ?? null) === $copyId;
check('a cópia saiu do fichário 1 e está só no fichário 2', !$in1 && $in2);
$dbCount = Database::one('SELECT COUNT(*) n FROM card_copies WHERE public_id = ? AND slot_binder_id IS NOT NULL', [$copyId]);
check('no banco, a cópia tem uma única posição', (int) ($dbCount['n'] ?? 0) === 1);

[$code] = $a->call('POST', "/binders/{$f2['id']}/ops", ['ops' => [['op' => 'place', 'pageId' => $p2, 'index' => 4, 'copyId' => $copies[1]['id'] ?? '']]]);
check('bolso já ocupado recusa outra cópia (422)', $code === 422, "veio $code");

[$code] = $a->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'lock', 'pageId' => $p1, 'index' => 1, 'locked' => true]]]);
[$code] = $a->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'place', 'pageId' => $p1, 'index' => 1, 'copyId' => $copies[1]['id'] ?? '']]]);
check('bolso bloqueado recusa carta física', $code === 422, "veio $code");

// 5) Isolamento entre usuários (IDOR)
[$code] = $b->call('GET', "/binders/{$f1['id']}");
check('B não lê fichário de A (404)', $code === 404, "veio $code");
[$code] = $b->call('DELETE', "/binders/{$f1['id']}");
check('B não apaga fichário de A (404)', $code === 404, "veio $code");
[$code] = $b->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'unplace', 'pageId' => $p1, 'index' => 0]]]);
check('B não altera bolsos de A (404)', $code === 404, "veio $code");
[, $j] = $b->call('GET', '/collection/copies');
check('coleção de B não contém cópias de A', !array_filter($j['data'] ?? [], fn ($c) => ($c['id'] ?? '') === $copyId));
[$code] = $a->call('GET', "/binders/{$f1['id']}");
check('A continua acessando o próprio fichário', $code === 200, "veio $code");

// 5b) Estado de conservação
[$code, $j] = $a->call('POST', '/collection/copies', ['items' => [['cardKey' => $key, 'qty' => 1, 'lang' => 'pt-br', 'condition' => 'SP'], ['cardKey' => $key, 'qty' => 1, 'lang' => 'pt-br', 'condition' => 'XX']]]);
$cc = $j['data']['copies'] ?? [];
check('cópia nasce com o estado escolhido (SP) e estado inválido vira NM', $code === 201 && ($cc[0]['condition'] ?? '') === 'SP' && ($cc[1]['condition'] ?? '') === 'NM', json_encode(array_column($cc, 'condition')));
[$code, $j] = $a->call('POST', '/collection/copies/condition', ['copyIds' => [$cc[0]['id'] ?? ''], 'condition' => 'HP']);
[, $all] = $a->call('GET', '/collection/copies');
$now = array_values(array_filter($all['data'] ?? [], fn ($c) => ($c['id'] ?? '') === ($cc[0]['id'] ?? 'x')))[0] ?? [];
check('muda o estado de uma cópia (SP → HP)', $code === 200 && ($now['condition'] ?? '') === 'HP', "veio $code");
[$code] = $a->call('POST', '/collection/copies/condition', ['copyIds' => [$cc[0]['id'] ?? ''], 'condition' => 'ZZ']);
check('estado inexistente é recusado (422)', $code === 422, "veio $code");
[$code, $j] = $b->call('POST', '/collection/copies/condition', ['copyIds' => [$cc[0]['id'] ?? ''], 'condition' => 'D']);
check('B não muda o estado de cópia de A', $code === 200 && ($j['data']['updated'] ?? -1) === 0, "veio $code");

// 8) Imagens: upload validado pelo conteúdo, metadados removidos, acesso privado/público
$png = (string) file_get_contents(dirname(__DIR__, 2) . '/tests/e2e/fixtures/art.png');
[$code, $j] = $a->upload('/assets', $png, 'arte de teste.png');
$asset = $j['data'] ?? [];
check('upload de PNG cria a imagem', $code === 201 && ($asset['width'] ?? 0) > 0, "veio $code " . json_encode($j['error'] ?? null));
[$code] = $a->upload('/assets', str_repeat('isto não é imagem ', 50), 'falso.png');
check('arquivo que não é imagem → 422', $code === 422, "veio $code");
// JPEG mínimo com segmento EXIF (APP1) contendo um "GPS" falso
$jpg = '';
if (function_exists('imagecreatetruecolor')) {
    $im = imagecreatetruecolor(40, 40); ob_start(); imagejpeg($im); $jpg = (string) ob_get_clean();
    $exif = "Exif\0\0" . 'GPSLatitude=-23.5505 GPSLongitude=-46.6333';
    $jpg = substr($jpg, 0, 2) . "\xFF\xE1" . pack('n', strlen($exif) + 2) . $exif . substr($jpg, 2);
    [$code, $j] = $a->upload('/assets', $jpg, 'foto.jpg');
    $jpgAsset = $j['data']['id'] ?? '';
    [$fc, $body, $type] = $a->raw("/assets/$jpgAsset/file");
    check('EXIF/GPS removido do JPEG enviado', $code === 201 && $fc === 200 && str_starts_with($type, 'image/jpeg') && !str_contains($body, 'GPSLatitude'), "upload $code, arquivo $fc");
}
[$code, , $type] = $a->raw("/assets/{$asset['id']}/file");
check('dono vê a própria imagem', $code === 200 && str_starts_with($type, 'image/png'), "veio $code $type");
[$code] = $b->raw("/assets/{$asset['id']}/file");
check('outro usuário NÃO vê imagem privada (404)', $code === 404, "veio $code");
[$code, $j] = $a->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'set', 'pageId' => $p1, 'index' => 2, 'slot' => ['kind' => 'image', 'assetId' => $asset['id'], 'crop' => ['x' => 0.5, 'y' => 0.5, 'scale' => 1.4]]]]]);
check('bolso recebe imagem própria no servidor', $code === 200 && ($j['data']['binder']['pages'][0]['slots'][2]['kind'] ?? '') === 'image', "veio $code");
[$code] = $b->call('POST', "/binders/{$f1['id']}/ops", ['ops' => [['op' => 'set', 'pageId' => $p1, 'index' => 3, 'slot' => ['kind' => 'image', 'assetId' => $asset['id']]]]]);
check('B não usa imagem de A (404 no fichário)', $code === 404, "veio $code");
[$code] = $a->call('DELETE', "/assets/{$asset['id']}");
check('imagem em uso não pode ser excluída', $code === 422, "veio $code");
$a->call('PATCH', "/binders/{$f1['id']}", ['visibility' => 'public']);
[$code] = $b->raw("/assets/{$asset['id']}/file");
check('imagem em fichário público fica visível', $code === 200, "veio $code");
[$code, $j] = $b->call('GET', "/public/binders/{$f1['id']}");
$pubSlots = $j['data']['pages'][0]['slots'] ?? [];
check('fichário público não expõe ids de cópias', $code === 200 && !str_contains(json_encode($pubSlots), $copyId) && !array_key_exists('locationId', $j['data'] ?? []), "veio $code");

// 9) Inventário: prévia, movimentação idempotente, reversão e conflito
[, $j] = $a->call('POST', '/storage-locations', ['name' => 'Caixa azul', 'kind' => 'box']);
$box = $j['data']['id'] ?? '';
[, $j] = $a->call('POST', '/storage-locations', ['name' => 'Gaveta', 'kind' => 'drawer']);
$drawer = $j['data']['id'] ?? '';
$c2 = $copies[1]['id'] ?? '';
[$code, $j] = $a->call('POST', '/inventory/move/preview', ['copyIds' => [$c2], 'locationId' => $box]);
$token = $j['data']['token'] ?? '';
check('prévia de movimentação lista a cópia', $code === 200 && count($j['data']['items'] ?? []) === 1, "veio $code");
$idem = 'mv' . bin2hex(random_bytes(6));
[$code, $j] = $a->call('POST', '/inventory/move', ['copyIds' => [$c2], 'locationId' => $box, 'token' => $token, 'idempotencyKey' => $idem]);
$mv = $j['data'] ?? [];
[$code2, $j2] = $a->call('POST', '/inventory/move', ['copyIds' => [$c2], 'locationId' => $box, 'token' => $token, 'idempotencyKey' => $idem]);
check('repetir a mesma movimentação não duplica (idempotência)', $code === 200 && $code2 === 200 && ($j2['data']['id'] ?? '') === ($mv['id'] ?? 'x'), "veio $code/$code2");
[$code] = $a->call('POST', '/inventory/move', ['copyIds' => [$c2], 'locationId' => $drawer, 'token' => $token]);
check('token de prévia desatualizado → 409', $code === 409, "veio $code");
[$code, $j] = $a->call('GET', "/inventory/batches/{$mv['id']}/revert-preview");
check('prévia de reversão sem conflitos', $code === 200 && empty($j['data']['items'][0]['conflicts']), "veio $code");
[$code, $j] = $a->call('POST', "/inventory/batches/{$mv['id']}/revert", ['movementIds' => [$mv['movements'][0]['id'] ?? '']]);
[, $cl] = $a->call('GET', '/collection/copies');
$back = array_values(array_filter($cl['data'] ?? [], fn ($c) => $c['id'] === $c2))[0] ?? [];
check('reversão devolve a cópia ao local anterior', $code === 200 && ($back['locationId'] ?? '') !== $box, "veio $code");
[$code] = $a->call('POST', "/inventory/batches/{$mv['id']}/revert", ['movementIds' => [$mv['movements'][0]['id'] ?? '']]);
check('o mesmo movimento não é revertido duas vezes', $code === 422 || $code === 409, "veio $code");
[, $j] = $a->call('POST', '/inventory/move', ['copyIds' => [$c2], 'locationId' => $drawer]);
$mv2 = $j['data'] ?? [];
$a->call('POST', '/inventory/move', ['copyIds' => [$c2], 'locationId' => $box]);
[$code] = $a->call('POST', "/inventory/batches/{$mv2['id']}/revert", ['movementIds' => [$mv2['movements'][0]['id'] ?? '']]);
check('reverter movimento já superado → 409 (conflito)', $code === 409, "veio $code");
[$code, $j] = $a->call('GET', '/inventory/batches');
check('histórico marca movimentos revertidos', $code === 200 && (bool) array_filter($j['data'] ?? [], fn ($b) => ($b['id'] ?? '') === $mv['id'] && count($b['revertedMovementIds']) === 1));

// 10) Base local valida cartas TCGdex no servidor; decks: reserva, montagem física e desmontagem
$tk = 'en:swsh3-136';
[$code, $j] = $a->call('POST', '/cards', ['cards' => [['key' => $tk, 'id' => 'swsh3-136', 'name' => 'nome falso', 'lang' => 'en']]]);
check('servidor valida a carta pela base local (nome real, verificada)', $code === 200 && ($j['data'][0]['name'] ?? '') === 'Furret' && !empty($j['data'][0]['verified']), json_encode($j['data'][0]['name'] ?? $j));
[, $j] = $a->call('POST', '/collection/copies', ['items' => [['cardKey' => $tk, 'cardId' => 'swsh3-136', 'qty' => 3, 'lang' => 'en']]]);
$fur = array_column($j['data']['copies'] ?? [], 'id');
[$code, $j] = $a->call('POST', '/decks', ['name' => 'Deck Furret', 'format' => 'casual', 'cards' => [['cardKey' => $tk, 'cardId' => 'swsh3-136', 'qty' => 2]]]);
$deck = $j['data']['id'] ?? '';
[$code] = $a->call('POST', "/decks/$deck/reserve", ['copyIds' => [$fur[0], $fur[1]]]);
check('reserva cópias para o deck', $code === 200, "veio $code");
[$code, $j] = $a->call('POST', "/decks/$deck/assemble", []);
[, $cl] = $a->call('GET', '/collection/copies');
$asm = array_values(array_filter($cl['data'] ?? [], fn ($c) => in_array($c['id'], [$fur[0], $fur[1]], true) && $c['deckAssembled']));
check('montagem física move as cópias para o deck box', $code === 200 && count($asm) === 2, "veio $code / " . count($asm));
[$code] = $a->call('POST', '/collection/copies/remove', ['copyIds' => [$fur[0]]]);
check('cópia montada em deck não pode ser removida', $code === 422, "veio $code");
[$code] = $a->call('DELETE', "/decks/$deck");
check('deck montado não pode ser excluído', $code === 422, "veio $code");
[$code] = $a->call('POST', "/decks/$deck/disassemble", []);
[, $dk] = $a->call('GET', "/decks/$deck");
check('desmontagem devolve as cartas e o deck volta a virtual', $code === 200 && ($dk['data']['status'] ?? '') === 'virtual', "veio $code");

// 11) Comunidade: feed público, curtidas, comentários, seguir, notificações, bloqueio, denúncia
$guest = new Client($BASE);
[$code, $j] = $a->call('POST', '/community/posts', ['body' => "Minha página de Furret $suffix", 'attachment' => ['type' => 'cards', 'cards' => [$tk]]]);
$post = $j['data']['id'] ?? '';
check('publica com carta anexada', $code === 201 && ($j['data']['attachment']['cards'][0]['name'] ?? '') === 'Furret', "veio $code");
[$code] = $a->call('POST', '/community/posts', ['body' => '   ']);
check('publicação vazia → 422', $code === 422, "veio $code");
[$code, $j] = $guest->call('GET', '/community/feed');
check('feed geral é público (sem login)', $code === 200 && (bool) array_filter($j['data']['items'] ?? [], fn ($p) => $p['id'] === $post));
[$code] = $guest->call('POST', "/community/posts/$post/like", []);
check('visitante não curte sem conta', $code === 401 || $code === 403, "veio $code");
[$code, $j] = $b->call('POST', "/community/posts/$post/like", []);
$b->call('POST', "/community/posts/$post/like", []);
check('curtida conta uma vez por pessoa', $code === 200 && ($j['data']['likes'] ?? 0) === 1);
[$code] = $b->call('POST', "/community/posts/$post/comments", ['body' => 'Que página linda!']);
[, $j] = $guest->call('GET', "/community/posts/$post/comments");
check('comentário publicado e visível', $code === 200 && ($j['data'][0]['body'] ?? '') === 'Que página linda!', "veio $code");
[$code] = $b->call('POST', "/community/u/ita$suffix/follow", []);
[, $j] = $guest->call('GET', "/community/u/ita$suffix");
check('seguir aumenta seguidores no perfil público', $code === 200 && ($j['data']['followers'] ?? 0) === 1);
check('perfil público não expõe e-mail', !str_contains(json_encode($j), '@example.com'));
[, $j] = $a->call('GET', '/notifications/count');
check('autor recebe notificações (curtida, comentário, seguidor)', ($j['data']['unread'] ?? 0) >= 3, json_encode($j['data'] ?? null));
[$code] = $b->call('DELETE', "/community/posts/$post");
check('B não exclui post de A', $code === 403, "veio $code");
[$code] = $b->call('POST', '/community/reports', ['targetType' => 'post', 'targetId' => $post, 'reason' => 'spam']);
check('denúncia registrada', $code === 200, "veio $code");
[$code] = $a->call('POST', "/community/u/itb$suffix/block", []);
[$code2] = $b->call('GET', "/community/u/ita$suffix");
[, $j] = $b->call('GET', '/community/feed');
check('bloqueio: B não vê perfil nem posts de A', $code === 200 && $code2 === 404 && !array_filter($j['data']['items'] ?? [], fn ($p) => $p['id'] === $post), "veio $code/$code2");
[, $j] = $guest->call('GET', "/community/u/ita$suffix");
check('bloqueio desfaz o seguir', ($j['data']['followers'] ?? -1) === 0);
$a->call('DELETE', "/community/u/itb$suffix/block");

// 12) Trocas: proposta, aceite atômico com histórico nos dois lados, nada duplicado
[, $j] = $b->call('POST', '/cards', ['cards' => [['key' => 'en:base1-58', 'id' => 'base1-58', 'lang' => 'en']]]);
[, $j] = $b->call('POST', '/collection/copies', ['items' => [['cardKey' => 'en:base1-58', 'cardId' => 'base1-58', 'qty' => 1, 'lang' => 'en']]]);
$bCopy = $j['data']['copies'][0]['id'] ?? '';
$aGive = $fur[2];
[, $j] = $b->call('GET', "/community/u/ita$suffix/tradable");
check('sem marcação, nada aparece para troca', ($j['data']['items'] ?? ['x']) === []);
$a->call('POST', '/collection/copies/condition', ['copyIds' => [$aGive], 'condition' => 'SP']);
$a->call('POST', '/collection/copies/trade', ['copyIds' => [$aGive], 'forTrade' => true]);
[, $j] = $b->call('GET', "/community/u/ita$suffix/tradable");
check('cópia marcada aparece para troca, sem localização', count($j['data']['items'] ?? []) === 1 && !str_contains(json_encode($j['data']), 'locationId'));
check('quem se interessa vê o estado de conservação da carta oferecida (SP)', ($j['data']['items'][0]['condition'] ?? '') === 'SP');
[$code] = $b->call('POST', '/trades', ['to' => "ita$suffix", 'give' => [$bCopy], 'want' => [$fur[0]]]);
check('não dá para pedir carta não marcada para troca', $code === 422, "veio $code");
[$code, $j] = $b->call('POST', '/trades', ['to' => "ita$suffix", 'give' => [$bCopy], 'want' => [$aGive], 'message' => 'Topa?']);
$trade = $j['data']['id'] ?? '';
check('B propõe troca', $code === 201 && $trade !== '', "veio $code");
[$code] = $b->call('POST', "/trades/$trade/accept", []);
check('quem propôs não pode aceitar', $code === 403, "veio $code");
[, $j] = $a->call('GET', "/trades/$trade");
$wantItem = ($j['data']['want'][0] ?? $j['data']['items'][0] ?? []);
check('a proposta registra o estado de cada carta', str_contains(json_encode($j['data'] ?? []), '"condition":"SP"'));
$a->call('POST', '/collection/copies/condition', ['copyIds' => [$aGive], 'condition' => 'HP']);
[, $j] = $b->call('GET', "/trades/$trade");
check('estado mudou depois da proposta: a carta aparece como indisponível, com o estado atual', str_contains(json_encode($j['data'] ?? []), '"conditionNow":"HP"'));
[$code, $j] = $a->call('POST', "/trades/$trade/accept", []);
check('troca não pode ser aceita com estado diferente do proposto (409)', $code === 409, "veio $code");
$a->call('POST', '/collection/copies/condition', ['copyIds' => [$aGive], 'condition' => 'SP']);
[$code, $j] = $a->call('POST', "/trades/$trade/accept", []);
check('A aceita a troca', $code === 200 && ($j['data']['status'] ?? '') === 'accepted', "veio $code " . json_encode($j['error'] ?? null));
[, $ca] = $a->call('GET', '/collection/copies');
[, $cb] = $b->call('GET', '/collection/copies');
$aHasPika = (bool) array_filter($ca['data'] ?? [], fn ($c) => $c['cardId'] === 'base1-58' && $c['status'] === 'active' && $c['viaTrade']);
$bHasFurret = (bool) array_filter($cb['data'] ?? [], fn ($c) => $c['cardId'] === 'swsh3-136' && $c['status'] === 'active');
$aGaveIt = (bool) array_filter($ca['data'] ?? [], fn ($c) => $c['id'] === $aGive && $c['status'] === 'removed');
check('cartas trocaram de dono (nova cópia para cada um; a antiga sai da coleção)', $aHasPika && $bHasFurret && $aGaveIt);
$bFurret = array_values(array_filter($cb['data'] ?? [], fn ($c) => $c['cardId'] === 'swsh3-136' && $c['status'] === 'active'))[0] ?? [];
check('quem recebe a carta recebe também o estado dela (SP)', ($bFurret['condition'] ?? '') === 'SP');
[, $hb] = $b->call('GET', '/inventory/batches');
check('a troca aparece no histórico de inventário', (bool) array_filter($hb['data'] ?? [], fn ($x) => $x['type'] === 'trade'));
[$code] = $a->call('POST', "/trades/$trade/accept", []);
check('aceitar de novo → 409', $code === 409, "veio $code");
[, $j] = $b->call('POST', '/trades', ['to' => "ita$suffix", 'give' => [], 'want' => [$fur[1]]]);
check('carta já entregue não pode entrar em nova troca', ($j['error']['code'] ?? '') === 'VALIDATION' || isset($j['error']));

// 13) Recuperação de senha (e-mail gravado em storage/mail) e invalidação de sessões antigas
$mailDir = rtrim((string) (getenv('STORAGE_PATH') ?: dirname(__DIR__, 2) . '/storage'), '/') . '/mail';
$before = glob("$mailDir/*.txt") ?: [];
$guest->refreshCsrf();
[$code, $j] = $guest->call('POST', '/auth/forgot', ['email' => "ita$suffix@example.com"]);
[$code2, $j2] = $guest->call('POST', '/auth/forgot', ['email' => "naoexiste$suffix@example.com"]);
check('esqueci a senha responde igual exista ou não a conta', $code === 200 && $code2 === 200 && ($j['data']['message'] ?? 'a') === ($j2['data']['message'] ?? 'b'));
$new = array_values(array_diff(glob("$mailDir/*.txt") ?: [], $before));
$mail = $new ? (string) file_get_contents(end($new)) : '';
preg_match('/redefinir\?token=([a-f0-9]{64})/', $mail, $m);
$resetToken = $m[1] ?? '';
check('e-mail de redefinição gerado com link', $resetToken !== '' && str_contains($mail, "ita$suffix@example.com"));
$reset = new Client($BASE); $reset->refreshCsrf();
[$code] = $reset->call('POST', '/auth/reset', ['token' => $resetToken, 'password' => 'nova-senha-segura-456']);
check('redefine a senha com o token', $code === 200, "veio $code");
$reset->refreshCsrf(); // a sessão é regenerada após redefinir
[$code] = $reset->call('POST', '/auth/reset', ['token' => $resetToken, 'password' => 'outra-senha-segura-789']);
check('token é de uso único', $code === 422, "veio $code");
[$code] = $a->call('GET', '/binders');
check('sessão antiga perde a validade após redefinir a senha', $code === 401, "veio $code");
check('login com a nova senha', $a->login("ita$suffix", 'nova-senha-segura-456') === 200);

// 14) Importação da coleção do navegador
$c3 = new Client($BASE);
$c3->register("itc$suffix");
$ck = "custom:custom_imp$suffix";
$c3->call('POST', '/cards', ['cards' => [['key' => $ck, 'name' => 'Importada', 'lang' => 'pt-br'], ['key' => $tk, 'id' => 'swsh3-136', 'lang' => 'en']]]);
$import = [
    'locations' => [['id' => 'loc_inbox', 'name' => 'Sem local', 'system' => true], ['id' => 'loc_a', 'name' => 'Estante', 'kind' => 'shelf'], ['id' => 'loc_b', 'name' => 'Caixa', 'kind' => 'box', 'parentId' => 'loc_a'], ['id' => 'loc_bnd', 'name' => 'Pasta', 'kind' => 'binder', 'binderId' => 'bnd_1', 'parentId' => 'loc_a']],
    'binders' => [['id' => 'bnd_1', 'name' => 'Pasta', 'type' => 'physical', 'layout' => ['rows' => 3, 'cols' => 3], 'locationId' => 'loc_bnd', 'appearance' => ['color' => '#334455'],
        'pages' => [['id' => 'pg1', 'rows' => 3, 'cols' => 3, 'slots' => array_merge([['kind' => 'copy', 'copyId' => 'cp_1', 'cardKey' => $tk], ['kind' => 'ghost', 'cardKey' => $ck], ['kind' => 'virtual', 'cardKey' => $tk]], array_fill(0, 6, ['kind' => 'empty']))]]]],
    'copies' => [['id' => 'cp_1', 'cardKey' => $tk, 'cardId' => 'swsh3-136', 'lang' => 'en', 'status' => 'active', 'locationId' => 'loc_bnd', 'slot' => ['binderId' => 'bnd_1', 'pageId' => 'pg1', 'index' => 0]],
        ['id' => 'cp_2', 'cardKey' => $ck, 'lang' => 'pt-br', 'status' => 'active', 'locationId' => 'loc_b'], ['id' => 'cp_3', 'cardKey' => $ck, 'status' => 'removed', 'locationId' => 'loc_removed'],
        ['id' => 'cp_4', 'cardKey' => 'en:desconhecida-1', 'status' => 'active', 'locationId' => 'loc_b']],
    'decks' => [['name' => 'Deck importado', 'format' => 'casual', 'cards' => [['cardKey' => $tk, 'cardId' => 'swsh3-136', 'qty' => 2]]]],
    'wishlist' => [['cardKey' => $tk, 'cardId' => 'swsh3-136', 'qty' => 1]],
];
[$code, $j] = $c3->call('POST', '/users/me/import', $import);
$sum = $j['data'] ?? [];
check('importa locais, fichário, cópias ativas, deck e wishlist', $code === 200 && $sum['copies'] === 2 && $sum['binders'] === 1 && $sum['locations'] === 2 && $sum['decks'] === 1, "veio $code " . json_encode($sum ?: $j));
[, $bl] = $c3->call('GET', '/binders');
[, $cl] = $c3->call('GET', '/collection/copies');
$imp = $bl['data'][0] ?? [];
$slot0 = $imp['pages'][0]['slots'][0] ?? [];
$copyIn = array_values(array_filter($cl['data'] ?? [], fn ($c) => ($c['id'] ?? '') === ($slot0['copyId'] ?? 'x')))[0] ?? null;
check('cópia importada ocupa o bolso certo com o novo id', ($slot0['kind'] ?? '') === 'copy' && $copyIn && ($copyIn['slot']['binderId'] ?? '') === $imp['id']);
check('referência virtual em fichário físico vira fantasma', ($imp['pages'][0]['slots'][2]['kind'] ?? '') === 'ghost');

// 15) Exclusão de conta (LGPD)
[$code] = $c3->call('DELETE', '/users/me', ['password' => 'errada']);
check('excluir conta exige a senha correta', $code === 422, "veio $code");
[$code] = $c3->call('DELETE', '/users/me', ['password' => 'senha-segura-123']);
$c4 = new Client($BASE);
check('conta excluída não consegue mais entrar', $code === 200 && $c4->login("itc$suffix") === 401, "veio $code");
check('dados da conta excluída removidos do banco', !Database::one('SELECT 1 FROM users WHERE username = ?', ["itc$suffix"]) && !Database::one("SELECT 1 FROM storage_locations l JOIN users u ON u.id = l.owner_id WHERE u.username = ?", ["itc$suffix"]));

// 6) Logout invalida a sessão
$a->call('POST', '/auth/logout');
[$code] = $a->call('GET', '/binders');
check('após logout: GET /binders → 401', $code === 401, "veio $code");

// 7) Rate limit de login (limite padrão: 8 por conta em 15 min)
$c = new Client($BASE);
$last = 0;
for ($i = 0; $i < 10; $i++) {
    $c->refreshCsrf();
    [$last] = $c->call('POST', '/auth/login', ['login' => "ita$suffix", 'password' => 'senha-errada-x']);
}
check('10ª senha errada seguida → 429', $last === 429, "veio $last");
Database::exec('DELETE FROM rate_limits');

echo "\n$passed passaram, $failed falharam.\n";
exit($failed ? 1 : 0);
