<?php
declare(strict_types=1);

/*
 * Instalador do DuskDex para hospedagem compartilhada (sem terminal).
 *  - Antes da instalação: confere o servidor, pede os dados do MySQL, grava o .env e cria as tabelas.
 *  - Depois (storage/installed.lock existe): só "manutenção", protegida pela senha do banco —
 *    aplica migrações novas (após atualizar os arquivos) e dá o papel de moderação a uma conta.
 */

$root = __DIR__;
$lock = $root . '/storage/installed.lock';
$envFile = $root . '/.env';
$installed = is_file($lock);

session_name('DDINSTALL');
session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Strict', 'cookie_secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
if (empty($_SESSION['t'])) {
    $_SESSION['t'] = bin2hex(random_bytes(16));
}
$token = $_SESSION['t'];
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$e = static fn ($s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

// ---------- requisitos ----------
$checks = [
    ['PHP 8.1 ou mais novo (este: ' . PHP_VERSION . ')', version_compare(PHP_VERSION, '8.1.0', '>=')],
    ['Extensão pdo_mysql', extension_loaded('pdo_mysql')],
    ['Extensão mbstring', extension_loaded('mbstring')],
    ['Extensão fileinfo', extension_loaded('fileinfo')],
    ['Extensão zlib', extension_loaded('zlib')],
    ['Pasta storage com permissão de escrita', is_dir($root . '/storage') && is_writable($root . '/storage')],
    ['Pasta do site com permissão de escrita (para criar o .env)', $installed || is_writable($root)],
    ['Arquivo .htaccess enviado (às vezes o FTP esconde arquivos que começam com ponto)', is_file($root . '/.htaccess')],
];
$ready = !in_array(false, array_column($checks, 1), true);

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$host = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
$dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/instalar.php'))), '/');
$siteUrl = ($https ? 'https' : 'http') . '://' . $host . $dir;

$errors = [];
$done = null;
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($post && !hash_equals($token, (string) ($_POST['t'] ?? ''))) {
    $errors[] = 'A página expirou. Recarregue e tente de novo.';
    $post = false;
}

function dd_pdo(string $host, int $port, string $db, string $user, string $pass): PDO
{
    $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $db), $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 8,
    ]);
    $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
    return $pdo;
}

function dd_explain(PDOException $ex, string $db, string $user): string
{
    $code = (int) ($ex->errorInfo[1] ?? 0);
    $msg = $ex->getMessage();
    return match (true) {
        $code === 1045 || $code === 1698 => "O MySQL recusou o usuário “{$user}” ou a senha. Confira no painel da hospedagem (no cPanel o usuário costuma ter um prefixo, ex.: conta_usuario).",
        $code === 1044 => "O usuário “{$user}” não tem permissão no banco “{$db}”. No painel (Bancos de dados MySQL), adicione o usuário ao banco com TODOS OS PRIVILÉGIOS.",
        $code === 1049 => "O banco “{$db}” não existe. Crie-o no painel da hospedagem (no cPanel o nome costuma ter um prefixo, ex.: conta_duskdex).",
        $code === 2002 || str_contains($msg, 'Connection refused') || str_contains($msg, 'getaddrinfo') => 'Não consegui conectar ao servidor MySQL. Na maioria das hospedagens o host é “localhost”; confira no painel.',
        default => 'Erro do MySQL: ' . mb_substr(preg_replace('/\s+/', ' ', $msg), 0, 200),
    };
}

function dd_env_set(string $text, string $key, string $value): string
{
    $line = $key . '="' . $value . '"';
    $re = '/^[ \t]*#?[ \t]*' . preg_quote($key, '/') . '[ \t]*=.*$/m';
    if (preg_match($re, $text)) {
        return (string) preg_replace_callback($re, static fn () => $line, $text, 1);
    }
    return rtrim($text) . "\n" . $line . "\n";
}

if ($post && !$installed) {
    // ---------- instalação ----------
    $f = static fn (string $k, string $d = ''): string => trim((string) ($_POST[$k] ?? $d));
    $dbHost = $f('db_host', 'localhost');
    $dbPort = (int) ($f('db_port', '3306') ?: 3306);
    $dbName = $f('db_name');
    $dbUser = $f('db_user');
    $dbPass = (string) ($_POST['db_pass'] ?? '');
    $url = rtrim($f('app_url', $siteUrl), '/');
    $mailFrom = $f('mail_from');

    if (!$ready) $errors[] = 'Resolva os itens em vermelho da verificação do servidor antes de instalar.';
    if (!preg_match('/^[A-Za-z0-9_.\-]+$/', $dbHost)) $errors[] = 'Host do MySQL inválido.';
    if (!preg_match('/^[A-Za-z0-9_$\-]{1,64}$/', $dbName)) $errors[] = 'Informe o nome do banco (letras, números e _).';
    if (!preg_match('/^[A-Za-z0-9_.\-@]{1,80}$/', $dbUser)) $errors[] = 'Informe o usuário do banco.';
    if (preg_match('/["\r\n]/', $dbPass) || preg_match('/\s#/', $dbPass)) $errors[] = 'A senha do banco não pode conter aspas duplas, quebras de linha ou “ #”. Troque a senha no painel e tente de novo.';
    if (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#', $url)) $errors[] = 'Endereço do site inválido.';
    if ($mailFrom !== '' && !filter_var($mailFrom, FILTER_VALIDATE_EMAIL)) $errors[] = 'E-mail remetente inválido.';
    // Antes da instalação qualquer visitante abre esta página. Com o MySQL da própria hospedagem (localhost)
    // um intruso não tem como acertar usuário e senha; com um servidor externo ele poderia usar o banco dele.
    // Nesse caso, exige um arquivo criado pelo FTP: prova de que quem instala controla os arquivos do site.
    $localDb = in_array(strtolower($dbHost), ['localhost', '127.0.0.1', '::1'], true);
    if (!$errors && !$localDb && !is_file($root . '/instalar.ok')) {
        $errors[] = "Por segurança, como o MySQL fica em outro servidor (“{$dbHost}”), crie pelo FTP um arquivo vazio chamado instalar.ok nesta mesma pasta e clique em Instalar de novo.";
    }

    if (!$errors) {
        try {
            $pdo = dd_pdo($dbHost, $dbPort, $dbName, $dbUser, $dbPass);
            require $root . '/backend/src/Kernel/Migrator.php';
            $clash = \DuskDex\Kernel\Migrator::conflicts($pdo);
            if ($clash) {
                throw new RuntimeException('Este banco já tem tabelas de outro sistema com os mesmos nomes que o DuskDex usa ('
                    . implode(', ', array_slice($clash, 0, 8)) . (count($clash) > 8 ? '…' : '')
                    . '). Para não estragar o outro site, nada foi alterado. Crie um banco separado só para o DuskDex no painel da hospedagem e use-o aqui.');
            }
            $applied = \DuskDex\Kernel\Migrator::run($pdo);

            $text = (string) @file_get_contents($root . '/.env.example');
            $urlHost = (string) parse_url($url, PHP_URL_HOST);
            foreach ([
                'APP_ENV' => 'production', 'APP_DEBUG' => 'false', 'APP_URL' => $url,
                'DB_HOST' => $dbHost, 'DB_PORT' => (string) $dbPort, 'DB_DATABASE' => $dbName, 'DB_USERNAME' => $dbUser, 'DB_PASSWORD' => $dbPass,
                'SESSION_SECURE' => 'auto',
                'MAIL_DRIVER' => 'mail',
                'MAIL_FROM' => $mailFrom !== '' ? $mailFrom : 'no-reply@' . preg_replace('/^www\./', '', $urlHost),
            ] as $k => $v) {
                $text = dd_env_set($text, $k, $v);
            }
            if (file_put_contents($envFile, $text) === false) {
                throw new RuntimeException('Não consegui gravar o arquivo .env na pasta do site (permissão).');
            }
            @chmod($envFile, 0600);
            foreach (['storage/uploads', 'storage/mail'] as $d) {
                if (!is_dir($root . '/' . $d)) @mkdir($root . '/' . $d, 0750, true);
            }
            file_put_contents($lock, gmdate('c') . "\n");
            @unlink($root . '/instalar.ok');
            $installed = true;
            $done = ['type' => 'install', 'applied' => $applied, 'url' => $url];
        } catch (PDOException $ex) {
            $errors[] = dd_explain($ex, $dbName, $dbUser);
        } catch (Throwable $ex) {
            $errors[] = $ex->getMessage();
        }
    }
} elseif ($post && $installed) {
    // ---------- manutenção (protegida pela senha do banco) ----------
    require $root . '/backend/bootstrap.php';
    $env = '\DuskDex\Kernel\Env';
    $given = (string) ($_POST['db_pass'] ?? '');
    $real = (string) $env::get('DB_PASSWORD', '');
    // no máximo 10 tentativas erradas por hora (contador em storage/, fora do acesso público)
    $attemptsFile = $root . '/storage/instalar-tentativas.json';
    $hour = gmdate('YmdH');
    $att = json_decode((string) @file_get_contents($attemptsFile), true);
    $att = is_array($att) && ($att['h'] ?? '') === $hour ? $att : ['h' => $hour, 'n' => 0];
    if ($att['n'] >= 10) {
        $errors[] = 'Muitas tentativas erradas. Aguarde uma hora e tente de novo.';
    } elseif ($real === '' || !hash_equals($real, $given)) {
        $att['n']++;
        @file_put_contents($attemptsFile, json_encode($att), LOCK_EX);
        usleep(1500000);
        $errors[] = 'Senha do banco incorreta.';
    } else {
        try {
            $pdo = dd_pdo((string) $env::get('DB_HOST', 'localhost'), $env::int('DB_PORT', 3306), (string) $env::get('DB_DATABASE', ''), (string) $env::get('DB_USERNAME', ''), $real);
            $applied = \DuskDex\Kernel\Migrator::run($pdo);
            $msgs = [];
            $username = strtolower(trim((string) ($_POST['admin'] ?? '')));
            if ($username !== '') {
                $st = $pdo->prepare('UPDATE users SET role = ? WHERE username = ?');
                $st->execute(['admin', ltrim($username, '@')]);
                $msgs[] = $st->rowCount() ? "@{$username} agora pode moderar a comunidade." : "Usuário @{$username} não encontrado (ou já era moderador).";
            }
            $done = ['type' => 'maint', 'applied' => $applied, 'msgs' => $msgs];
        } catch (PDOException $ex) {
            $errors[] = dd_explain($ex, (string) $env::get('DB_DATABASE', ''), (string) $env::get('DB_USERNAME', ''));
        }
    }
}
?><!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Instalar DuskDex</title>
<style>
  :root { --bg:#0D0B12; --card:#17131F; --line:#2B2338; --text:#ECE6F3; --muted:#A59BB4; --accent:#B48FE0; --ok:#6FD3A0; --bad:#F07A8A; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:640px; margin:0 auto; padding:40px 16px 64px; }
  h1 { font:600 30px/1.2 Georgia, serif; margin:0 0 4px; }
  h2 { font-size:16px; margin:0 0 12px; }
  p.lead { color:var(--muted); margin:0 0 28px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:18px; }
  ul.checks { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
  ul.checks li::before { content:"✔"; color:var(--ok); margin-right:8px; }
  ul.checks li.no::before { content:"✖"; color:var(--bad); }
  ul.checks li.no { color:var(--bad); }
  label { display:block; font-weight:600; margin:14px 0 6px; }
  label small { font-weight:400; color:var(--muted); }
  input { width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:#0F0C15; color:var(--text); font:inherit; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  .row { display:grid; grid-template-columns:1fr 110px; gap:12px; }
  button { margin-top:20px; width:100%; padding:13px; border:0; border-radius:10px; background:var(--accent); color:#1A1225; font:700 15px system-ui, sans-serif; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .err { border-color:var(--bad); color:#FFD5DB; }
  .ok { border-color:var(--ok); }
  .muted { color:var(--muted); font-size:14px; }
  a { color:var(--accent); }
  code { background:#0F0C15; padding:1px 6px; border-radius:6px; }
  #apicheck { margin-top:10px; }
</style>
</head>
<body>
<main>
  <h1>DuskDex</h1>
  <p class="lead"><?= $installed && !$done ? 'Manutenção da instalação' : 'Instalação no servidor' ?></p>

  <?php if ($errors): ?>
    <section class="err"><?php foreach ($errors as $m): ?><div><?= $e($m) ?></div><?php endforeach; ?></section>
  <?php endif; ?>

  <?php if ($done && $done['type'] === 'install'): ?>
    <section class="ok">
      <h2>Pronto! O DuskDex está instalado.</h2>
      <p>Banco preparado (<?= count($done['applied']) ?> etapa(s)) e configuração gravada.</p>
      <div id="apicheck" class="muted">Testando a API…</div>
      <p style="margin-top:16px"><a href="./#/registrar"><strong>Abrir o site e criar sua conta →</strong></a></p>
      <p class="muted">Depois de criar sua conta, volte a esta página (<code>instalar.php</code>) se quiser virar moderador da comunidade — ela vai pedir a senha do banco.</p>
    </section>
  <?php elseif ($done && $done['type'] === 'maint'): ?>
    <section class="ok">
      <h2>Feito.</h2>
      <p><?= $done['applied'] ? 'Banco atualizado: ' . $e(implode(', ', $done['applied'])) : 'O banco já estava atualizado.' ?></p>
      <?php foreach ($done['msgs'] as $m): ?><p><?= $e($m) ?></p><?php endforeach; ?>
      <p><a href="./">Voltar ao site</a></p>
    </section>
  <?php endif; ?>

  <?php if (!$installed): ?>
    <section>
      <h2>1. Verificação do servidor</h2>
      <ul class="checks">
        <?php foreach ($checks as [$label, $ok]): ?><li class="<?= $ok ? '' : 'no' ?>"><?= $e($label) ?></li><?php endforeach; ?>
      </ul>
      <?php if (!$ready): ?><p class="muted" style="margin-top:12px">Itens em vermelho: no painel da hospedagem, procure “Selecionar versão do PHP” (para versão e extensões). Para permissões, no FileZilla clique com o botão direito na pasta → <em>Permissões de arquivo</em> → 755.</p><?php endif; ?>
    </section>

    <form method="post" autocomplete="off">
      <section>
        <h2>2. Banco de dados MySQL</h2>
        <p class="muted">Crie um banco e um usuário no painel da hospedagem (no cPanel: <em>Bancos de dados MySQL</em>), dê ao usuário <em>todos os privilégios</em> no banco e preencha abaixo.</p>
        <div class="row">
          <div><label for="db_host">Host</label><input id="db_host" name="db_host" value="<?= $e($_POST['db_host'] ?? 'localhost') ?>"></div>
          <div><label for="db_port">Porta</label><input id="db_port" name="db_port" inputmode="numeric" value="<?= $e($_POST['db_port'] ?? '3306') ?>"></div>
        </div>
        <label for="db_name">Nome do banco</label><input id="db_name" name="db_name" required value="<?= $e($_POST['db_name'] ?? '') ?>" placeholder="ex.: conta_duskdex">
        <label for="db_user">Usuário do banco</label><input id="db_user" name="db_user" required value="<?= $e($_POST['db_user'] ?? '') ?>" placeholder="ex.: conta_duskdex">
        <label for="db_pass">Senha do usuário</label><input id="db_pass" name="db_pass" type="password" required>
      </section>
      <section>
        <h2>3. Site</h2>
        <label for="app_url">Endereço do site <small>(usado nos links de e-mail)</small></label>
        <input id="app_url" name="app_url" value="<?= $e($_POST['app_url'] ?? $siteUrl) ?>">
        <label for="mail_from">E-mail remetente <small>(opcional — de preferência um e-mail do seu domínio)</small></label>
        <input id="mail_from" name="mail_from" type="email" value="<?= $e($_POST['mail_from'] ?? '') ?>" placeholder="no-reply@<?= $e(preg_replace('/^www\./', '', explode(':', $host)[0])) ?>">
        <?php if (!$https): ?><p class="muted">Você está acessando sem HTTPS. Se a hospedagem oferece SSL (quase todas oferecem grátis), ative e use o endereço com <code>https://</code>.</p><?php endif; ?>
        <input type="hidden" name="t" value="<?= $e($token) ?>">
        <button type="submit" <?= $ready ? '' : 'disabled' ?>>Instalar</button>
      </section>
    </form>
  <?php elseif (!$done): ?>
    <form method="post" autocomplete="off">
      <section>
        <h2>O DuskDex já está instalado</h2>
        <p class="muted">Use esta página depois de enviar uma versão nova dos arquivos (para atualizar o banco) ou para dar o papel de moderação a uma conta. Para confirmar que é você, informe a senha do banco de dados.</p>
        <label for="db_pass">Senha do banco de dados</label><input id="db_pass" name="db_pass" type="password" required>
        <label for="admin">Tornar moderador <small>(opcional — username da conta, sem @)</small></label><input id="admin" name="admin" value="">
        <input type="hidden" name="t" value="<?= $e($token) ?>">
        <button type="submit">Atualizar</button>
      </section>
    </form>
    <p class="muted"><a href="./">Abrir o site</a></p>
  <?php endif; ?>
</main>
<?php if ($done && $done['type'] === 'install'): ?>
<script>
  (function () {
    var box = document.getElementById('apicheck');
    function show(ok, text) { var sp = document.createElement('span'); sp.style.color = ok ? '#6FD3A0' : '#F07A8A'; sp.textContent = (ok ? '✔ ' : '✖ ') + text; box.textContent = ''; box.appendChild(sp); }
    fetch('api/v1/health', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.data && j.data.database === 'ok') show(true, 'API funcionando.');
        else show(false, 'A API respondeu, mas com problema: ' + ((j && ((j.data && j.data.reason) || (j.error && j.error.message))) || 'desconhecido'));
      })
      .catch(function () { show(false, 'A API não respondeu. Confira se o arquivo .htaccess foi enviado para esta pasta (no FileZilla: Servidor → Forçar exibição de arquivos ocultos).'); });
  })();
</script>
<?php endif; ?>
</body>
</html>
