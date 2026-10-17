<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Sessão segura, CSRF, rate limiting e registro de eventos de segurança. */
final class Security
{
    public static function startSession(bool $remember = false): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $secureCfg = Env::get('SESSION_SECURE', 'auto');
        $secure = $secureCfg === 'auto' ? $https : Env::bool('SESSION_SECURE');
        session_name(Env::get('SESSION_NAME', 'DDSESSID'));
        session_set_cookie_params([
            'lifetime' => $remember ? Env::int('SESSION_REMEMBER_DAYS', 30) * 86400 : 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) (Env::int('SESSION_REMEMBER_DAYS', 30) * 86400));
        session_start();
        // Expiração por inatividade (2h) quando não há "manter conectado".
        $now = time();
        if (!empty($_SESSION['uid']) && empty($_SESSION['remember']) && isset($_SESSION['last']) && $now - $_SESSION['last'] > 7200) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['last'] = $now;
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf'];
    }

    public static function verifyCsrf(Request $req): void
    {
        if (in_array($req->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }
        $sent = (string) $req->header('x-csrf-token');
        if ($sent === '' || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
            throw new HttpException(403, 'CSRF', 'Token CSRF ausente ou inválido. Recarregue a página e tente de novo.');
        }
    }

    /**
     * Encerra a sessão se a conta foi suspensa/excluída ou se a senha mudou depois do login
     * (redefinição em outro dispositivo invalida as sessões antigas).
     */
    public static function validateSession(): void
    {
        if (empty($_SESSION['uid'])) {
            return;
        }
        $u = Database::one('SELECT status, password_changed_at FROM users WHERE id = ?', [(int) $_SESSION['uid']]);
        $changed = $u && $u['password_changed_at'] !== null ? (float) (new \DateTimeImmutable($u['password_changed_at'], new \DateTimeZone('UTC')))->format('U.u') : 0.0;
        if (!$u || $u['status'] !== 'active' || $changed > (float) ($_SESSION['auth_at'] ?? 0) + 0.001) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
    }

    public static function isAdmin(): bool
    {
        $uid = self::userId();
        return $uid !== null && (Database::one('SELECT role FROM users WHERE id = ?', [$uid])['role'] ?? '') === 'admin';
    }

    public static function userId(): ?int
    {
        return isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : null;
    }

    /** Limita tentativas por chave em uma janela (padrão 15 min). Lança 429 se exceder. */
    public static function rateLimit(string $bucket, int $max, int $windowSeconds = 900): void
    {
        $window = intdiv(time(), $windowSeconds) * $windowSeconds;
        if (random_int(1, 200) === 1) {
            // limpeza ocasional: janelas com mais de 2 dias não servem para nada
            Database::exec('DELETE FROM rate_limits WHERE window_start < ?', [time() - 2 * 86400]);
        }
        Database::exec('INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1', [$bucket, $window]);
        $row = Database::one('SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?', [$bucket, $window]);
        $prev = Database::one('SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?', [$bucket, $window - $windowSeconds]);
        // Janela deslizante aproximada: a janela anterior pesa proporcionalmente ao tempo que ainda a cobre.
        // Evita rajadas de até 2× o limite na virada de uma janela fixa.
        $weight = 1 - ((time() - $window) / $windowSeconds);
        $estimate = (int) ($row['hits'] ?? 0) + (int) floor((int) ($prev['hits'] ?? 0) * $weight);
        if ($estimate > $max) {
            self::event(null, 'rate_limited', ['bucket' => $bucket]);
            throw new HttpException(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
        }
    }

    public static function clearRate(string $bucket, int $windowSeconds = 900): void
    {
        $window = intdiv(time(), $windowSeconds) * $windowSeconds;
        Database::exec('DELETE FROM rate_limits WHERE bucket = ? AND window_start >= ?', [$bucket, $window - $windowSeconds]);
    }

    public static function ipHash(): string
    {
        return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . Env::get('DB_DATABASE', ''));
    }

    /** Registra evento de segurança (nunca senhas ou tokens). */
    public static function event(?int $userId, string $type, array $meta = []): void
    {
        try {
            Database::exec('INSERT INTO security_events (user_id, type, ip_hash, meta, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))',
                [$userId, $type, self::ipHash(), json_encode($meta, JSON_UNESCAPED_UNICODE)]);
        } catch (\Throwable) {
            // não interrompe o fluxo se o log falhar
        }
    }
}
