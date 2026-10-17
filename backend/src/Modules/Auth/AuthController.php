<?php
declare(strict_types=1);

namespace DuskDex\Modules\Auth;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Mailer;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Shared\Repo;

/**
 * Registro, login, logout, sessão atual, recuperação de senha e confirmação de e-mail.
 * Senhas com Argon2id; mensagens genéricas para não revelar se uma conta existe.
 * Tokens de uso único: só o hash SHA-256 fica no banco; expiram (redefinição 1 h, confirmação 48 h).
 */
final class AuthController
{
    public const TERMS_VERSION = '2026-10';

    public static function csrf(Request $r): array
    {
        return ['token' => Security::csrfToken()];
    }

    public static function me(Request $r): array
    {
        return self::userPayload((int) Security::userId());
    }

    public static function register(Request $r): array
    {
        $v = new Validator($r->json());
        $email = $v->email('email');
        $username = $v->str('username', 3, 30, true, '/^[a-z0-9._]+$/', 'Username');
        $display = $v->str('displayName', 1, 60, true, null, 'Nome de exibição');
        $password = $v->str('password', 10, 200, true, null, 'Senha');
        $v->check();
        if (($r->json()['acceptTerms'] ?? false) !== true) {
            throw HttpException::validation('É preciso aceitar os termos de uso e a política de privacidade.', [['field' => 'acceptTerms', 'message' => 'Obrigatório.']]);
        }
        Security::rateLimit('register:' . Security::ipHash(), 10, 3600);
        $exists = Database::one('SELECT id FROM users WHERE email = ? OR username = ?', [$email, $username]);
        if ($exists) {
            throw HttpException::conflict('E-mail ou username já está em uso.');
        }
        $hash = password_hash((string) $password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
        $uid = Database::transaction(function () use ($email, $username, $display, $hash) {
            $now = Repo::now();
            $id = Database::insert('INSERT INTO users (public_id, email, username, display_name, password_hash, privacy, terms_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Ulid::generate(), $email, $username, $display, $hash, Repo::json(['showStats' => true, 'showBinders' => true, 'showDecks' => true]), self::TERMS_VERSION, $now, $now]);
            Database::exec('INSERT INTO storage_locations (public_id, owner_id, name, kind, description, is_system, is_hidden, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?), (?, ?, ?, ?, ?, 1, 1, ?)', [
                Ulid::generate(), $id, 'Sem local definido', 'system', 'Cartas recém-cadastradas ficam aqui até você escolher um local.', $now,
                Ulid::generate(), $id, 'Fora da coleção', 'system', 'Cópias removidas. O histórico é preservado.', $now,
            ]);
            Repo::activity($id, 'account', 'Conta criada no DuskDex', 'user');
            return $id;
        });
        Security::event($uid, 'register');
        self::establish($uid, false);
        self::sendVerification($uid);
        return self::userPayload($uid);
    }

    public static function login(Request $r): array
    {
        $v = new Validator($r->json());
        $login = $v->str('login', 3, 190, true, null, 'Login');
        $password = $v->str('password', 1, 200, true, null, 'Senha');
        $v->check();
        $login = mb_strtolower((string) $login);
        Security::rateLimit('login-ip:' . Security::ipHash(), Env::int('RATE_LOGIN_PER_IP', 30));
        Security::rateLimit('login-acct:' . hash('sha256', $login), Env::int('RATE_LOGIN_PER_ACCOUNT', 8));
        $user = Database::one('SELECT id, password_hash, status FROM users WHERE email = ? OR username = ?', [$login, $login]);
        // Verificação de tempo constante aproximado mesmo quando o usuário não existe.
        $hash = $user['password_hash'] ?? password_hash('timing-equalizer', defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
        $ok = password_verify((string) $password, $hash) && $user !== null;
        if (!$ok || $user['status'] !== 'active') {
            Security::event($user ? (int) $user['id'] : null, 'login_failed');
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas.');
        }
        if (password_needs_rehash($user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
            Database::exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT), $user['id']]);
        }
        Security::clearRate('login-acct:' . hash('sha256', $login));
        self::establish((int) $user['id'], (bool) ($r->json()['remember'] ?? false));
        Security::event((int) $user['id'], 'login');
        return self::userPayload((int) $user['id']);
    }

    public static function logout(Request $r): array
    {
        $uid = Security::userId();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => time() - 42000, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
        }
        session_destroy();
        if ($uid) {
            Security::event($uid, 'logout');
        }
        return ['ok' => true];
    }

    private static function establish(int $uid, bool $remember): void
    {
        session_regenerate_id(true); // evita fixação de sessão
        $_SESSION['uid'] = $uid;
        $_SESSION['auth_at'] = microtime(true);
        $_SESSION['remember'] = $remember;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        if ($remember) {
            $p = session_get_cookie_params();
            setcookie(session_name(), session_id(), ['expires' => time() + Env::int('SESSION_REMEMBER_DAYS', 30) * 86400, 'path' => '/', 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
        }
    }

    public static function userPayload(int $uid): array
    {
        $u = Database::one('SELECT u.public_id, u.email, u.username, u.display_name, u.role, u.email_verified_at, a.public_id AS avatar FROM users u LEFT JOIN assets a ON a.id = u.avatar_asset_id WHERE u.id = ?', [$uid]);
        if (!$u) {
            throw HttpException::unauthenticated();
        }
        return ['id' => $u['public_id'], 'email' => $u['email'], 'username' => $u['username'], 'displayName' => $u['display_name'],
            'role' => $u['role'], 'emailVerified' => $u['email_verified_at'] !== null,
            'avatarUrl' => $u['avatar'] ? 'api/v1/assets/' . $u['avatar'] . '/file' : null];
    }

    // ------------------------------------------------------------ tokens de uso único

    private static function issueToken(int $uid, string $purpose, int $ttlSeconds): string
    {
        $token = bin2hex(random_bytes(32));
        Database::exec('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [Repo::now(), $uid, $purpose]);
        $exp = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->modify("+$ttlSeconds seconds")->format('Y-m-d H:i:s.v');
        Database::exec('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [$uid, $purpose, hash('sha256', $token), $exp, Repo::now()]);
        return $token;
    }

    /** Consome um token (uso único). Retorna o id do usuário ou lança erro genérico. */
    private static function consumeToken(mixed $token, string $purpose): int
    {
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw HttpException::rule('INVALID_TOKEN', 'Link inválido ou expirado. Peça um novo.');
        }
        $row = Database::one('SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE', [hash('sha256', $token), $purpose]);
        if (!$row) {
            throw HttpException::rule('INVALID_TOKEN', 'Link inválido ou expirado. Peça um novo.');
        }
        Database::exec('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [Repo::now(), $row['id']]);
        return (int) $row['user_id'];
    }

    private static function appUrl(): string
    {
        return rtrim((string) Env::get('APP_URL', 'http://127.0.0.1:8080'), '/');
    }

    /**
     * Envia o link de confirmação. Devolve ['sent' => bool, 'link' => ?string]; o link só é devolvido
     * no modo de teste (MAIL_DRIVER=log) fora de produção, para permitir confirmar sem e-mail real.
     */
    private static function sendVerification(int $uid): array
    {
        $u = Database::one('SELECT email, display_name, email_verified_at FROM users WHERE id = ?', [$uid]);
        if (!$u || $u['email_verified_at'] !== null) { return ['sent' => true, 'link' => null]; }
        $token = self::issueToken($uid, 'verify', 48 * 3600);
        $link = self::appUrl() . "/#/verificar?token=$token";
        $sent = Mailer::send($u['email'], 'Confirme seu e-mail no DuskDex',
            "Olá, {$u['display_name']}!\n\nConfirme seu e-mail para concluir o cadastro no DuskDex:\n$link\n\nO link vale por 48 horas. Se você não criou esta conta, ignore esta mensagem.\n\n— DuskDex");
        $dev = Mailer::testMode() && Env::get('APP_ENV') !== 'production';
        return ['sent' => $sent, 'link' => $dev ? '#/verificar?token=' . $token : null];
    }

    /** Falha no envio: explica o motivo fora de produção; em produção, só uma mensagem genérica. */
    private static function mailFailure(): HttpException
    {
        $why = Env::get('APP_ENV') === 'production' ? '' : ' Motivo: ' . (Mailer::$lastError ?? 'desconhecido') . ' Veja “E-mail” no README.';
        return new HttpException(502, 'MAIL_FAILED', 'Não foi possível enviar o e-mail agora.' . $why);
    }

    public static function forgot(Request $r): array
    {
        $v = new Validator($r->json());
        $email = $v->email('email');
        $v->check();
        Security::rateLimit('forgot-ip:' . Security::ipHash(), 10, 3600);
        Security::rateLimit('forgot-acct:' . hash('sha256', (string) $email), 3, 3600);
        $u = Database::one("SELECT id, display_name FROM users WHERE email = ? AND status = 'active'", [$email]);
        if ($u) {
            $token = self::issueToken((int) $u['id'], 'reset', 3600);
            Mailer::send((string) $email, 'Redefinição de senha do DuskDex',
                "Olá, {$u['display_name']}!\n\nRecebemos um pedido para redefinir a senha da sua conta. Para escolher uma nova senha, abra:\n" . self::appUrl() . "/#/redefinir?token=$token\n\nO link vale por 1 hora e só pode ser usado uma vez. Se não foi você, ignore esta mensagem — sua senha continua a mesma.\n\n— DuskDex");
            Security::event((int) $u['id'], 'password_reset_requested');
        }
        // resposta idêntica exista ou não a conta
        return ['ok' => true, 'message' => 'Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha.'];
    }

    public static function reset(Request $r): array
    {
        $v = new Validator($r->json());
        $password = $v->str('password', 10, 200, true, null, 'Senha');
        $v->check();
        Security::rateLimit('reset-ip:' . Security::ipHash(), 20, 3600);
        $uid = Database::transaction(function () use ($r, $password) {
            $uid = self::consumeToken($r->input('token'), 'reset');
            Database::exec('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
                [password_hash((string) $password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT), Repo::now(), Repo::now(), $uid]);
            // quem recebeu o link no e-mail comprovou o endereço
            Database::exec('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [Repo::now(), $uid]);
            return $uid;
        });
        Security::event($uid, 'password_reset');
        Security::clearRate('login-acct:' . hash('sha256', (string) Database::one('SELECT email FROM users WHERE id = ?', [$uid])['email']));
        self::establish($uid, false); // sessões anteriores perdem a validade (password_changed_at)
        return self::userPayload($uid);
    }

    public static function verify(Request $r): array
    {
        $uid = Database::transaction(function () use ($r) {
            $uid = self::consumeToken($r->input('token'), 'verify');
            Database::exec('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [Repo::now(), $uid]);
            return $uid;
        });
        Security::event($uid, 'email_verified');
        return ['ok' => true, 'loggedIn' => Security::userId() === $uid];
    }

    public static function resendVerification(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('verify-resend:' . $uid, 5, 3600);
        $r = self::sendVerification($uid);
        if (!$r['sent']) { throw self::mailFailure(); }
        return ['ok' => true, 'testMode' => Mailer::testMode(), 'devLink' => $r['link']];
    }

    public static function changePassword(Request $r): array
    {
        $uid = (int) Security::userId();
        $v = new Validator($r->json());
        $current = $v->str('current', 1, 200, true, null, 'Senha atual');
        $password = $v->str('password', 10, 200, true, null, 'Nova senha');
        $v->check();
        Security::rateLimit('chpass:' . $uid, 10);
        $u = Database::one('SELECT password_hash FROM users WHERE id = ?', [$uid]);
        if (!$u || !password_verify((string) $current, $u['password_hash'])) {
            throw HttpException::rule('INVALID_CREDENTIALS', 'Senha atual incorreta.');
        }
        Database::exec('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
            [password_hash((string) $password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT), Repo::now(), Repo::now(), $uid]);
        Security::event($uid, 'password_changed');
        self::establish($uid, !empty($_SESSION['remember']));
        return ['ok' => true];
    }

    /** Exclusão da conta e de todos os dados (LGPD). Exige a senha. Irreversível. */
    public static function deleteAccount(Request $r): array
    {
        $uid = (int) Security::userId();
        $v = new Validator($r->json());
        $password = $v->str('password', 1, 200, true, null, 'Senha');
        $v->check();
        Security::rateLimit('delete-acct:' . $uid, 5);
        $u = Database::one('SELECT password_hash FROM users WHERE id = ?', [$uid]);
        if (!$u || !password_verify((string) $password, $u['password_hash'])) {
            throw HttpException::rule('INVALID_CREDENTIALS', 'Senha incorreta.');
        }
        Database::transaction(function () use ($uid) {
            // ordem respeita as chaves estrangeiras RESTRICT (cópias → fichários/locais)
            Database::exec('DELETE FROM card_copies WHERE owner_id = ?', [$uid]);
            Database::exec('UPDATE binders SET location_id = NULL WHERE owner_id = ?', [$uid]);
            Database::exec('UPDATE decks SET location_id = NULL WHERE owner_id = ?', [$uid]);
            Database::exec('UPDATE storage_locations SET parent_id = NULL WHERE owner_id = ?', [$uid]);
            Database::exec('DELETE FROM storage_locations WHERE owner_id = ?', [$uid]);
            Database::exec('DELETE FROM binders WHERE owner_id = ?', [$uid]);
            Database::exec('DELETE FROM decks WHERE owner_id = ?', [$uid]);
            Database::exec('UPDATE users SET avatar_asset_id = NULL, banner_asset_id = NULL WHERE id = ?', [$uid]);
            Database::exec('DELETE FROM card_snapshots WHERE owner_id = ?', [$uid]);
            Database::exec('DELETE FROM users WHERE id = ?', [$uid]); // demais tabelas: ON DELETE CASCADE
        });
        // arquivos de imagem do usuário
        $dir = Mailer::storageDir() . '/uploads/' . $uid;
        if (is_dir($dir)) {
            foreach (glob($dir . '/*') ?: [] as $f) { @unlink($f); }
            @rmdir($dir);
        }
        Security::event(null, 'account_deleted');
        $_SESSION = [];
        session_destroy();
        return ['ok' => true];
    }
}
