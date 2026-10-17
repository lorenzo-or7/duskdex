<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/**
 * Envio de e-mail transacional (recuperação de senha, confirmação de e-mail).
 * MAIL_DRIVER:
 *   log  (padrão) — grava o e-mail em storage/mail/*.eml; útil em desenvolvimento/XAMPP sem SMTP.
 *   smtp — cliente SMTP mínimo com STARTTLS/SSL e AUTH LOGIN (MAIL_HOST, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD, MAIL_ENCRYPTION=tls|ssl|none).
 *   mail — função mail() do PHP (sendmail do sistema).
 * Remetente: MAIL_FROM / MAIL_FROM_NAME.
 */
final class Mailer
{
    /** Motivo da última falha de envio (sem senhas), para mensagens de diagnóstico. */
    public static ?string $lastError = null;

    public static function driver(): string
    {
        return strtolower((string) Env::get('MAIL_DRIVER', 'log'));
    }

    /** Modo de teste: os e-mails só são gravados em storage/mail (não chegam a ninguém). */
    public static function testMode(): bool
    {
        return !in_array(self::driver(), ['smtp', 'mail'], true);
    }

    public static function send(string $to, string $subject, string $text): bool
    {
        $driver = self::driver();
        self::$lastError = null;
        $from = (string) Env::get('MAIL_FROM', 'no-reply@duskdex.local');
        // SMTP com conta pessoal (ex.: Gmail): o remetente precisa ser o próprio e-mail autenticado
        $user = (string) Env::get('MAIL_USERNAME', '');
        if ($driver === 'smtp' && ($from === '' || $from === 'no-reply@duskdex.local') && filter_var($user, FILTER_VALIDATE_EMAIL)) {
            $from = $user;
        }
        $fromName = (string) Env::get('MAIL_FROM_NAME', 'DuskDex');
        $headers = [
            'From' => self::encodeName($fromName) . " <$from>",
            'To' => $to,
            'Subject' => '=?UTF-8?B?' . base64_encode($subject) . '?=',
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Content-Transfer-Encoding' => 'base64',
            'Date' => gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID' => '<' . bin2hex(random_bytes(12)) . '@' . (parse_url((string) Env::get('APP_URL', 'http://localhost'), PHP_URL_HOST) ?: 'localhost') . '>',
        ];
        $body = rtrim(chunk_split(base64_encode($text), 76, "\r\n"));
        try {
            return match ($driver) {
                'smtp' => self::smtp($from, $to, $headers, $body),
                'mail' => mail($to, $headers['Subject'], $body, array_diff_key($headers, ['To' => 1, 'Subject' => 1]))
                    ?: throw new \RuntimeException('a função mail() do PHP recusou o envio (servidor sem sendmail configurado).'),
                default => self::log($headers, $body, $text),
            };
        } catch (\Throwable $e) {
            self::$lastError = $e->getMessage();
            error_log('[DuskDex mail] ' . $e->getMessage());
            return false;
        }
    }

    public static function storageDir(): string
    {
        return rtrim((string) Env::get('STORAGE_PATH', dirname(__DIR__, 3) . '/storage'), '/\\');
    }

    private static function encodeName(string $n): string
    {
        return preg_match('/^[\x20-\x7e]*$/', $n) ? '"' . addcslashes($n, '"\\') . '"' : '=?UTF-8?B?' . base64_encode($n) . '?=';
    }

    private static function raw(array $headers, string $body): string
    {
        $out = '';
        foreach ($headers as $k => $v) { $out .= "$k: $v\r\n"; }
        return $out . "\r\n" . $body . "\r\n";
    }

    private static function log(array $headers, string $body, string $text): bool
    {
        $dir = self::storageDir() . '/mail';
        if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
            return false;
        }
        $file = $dir . '/' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.eml';
        file_put_contents($file, self::raw($headers, $body));
        // cópia legível ao lado (o .eml usa base64, como um e-mail real)
        file_put_contents(substr($file, 0, -4) . '.txt', "Para: {$headers['To']}\n\n$text\n");
        return true;
    }

    private static function smtp(string $from, string $to, array $headers, string $body): bool
    {
        $host = (string) Env::get('MAIL_HOST', '');
        if ($host === '') { throw new \RuntimeException('MAIL_HOST não configurado.'); }
        $port = Env::int('MAIL_PORT', 587);
        $enc = strtolower((string) Env::get('MAIL_ENCRYPTION', $port === 465 ? 'ssl' : 'tls'));
        $ssl = ['verify_peer' => true, 'verify_peer_name' => true];
        if ($ca = Http::caBundle()) { $ssl['cafile'] = $ca; }
        $ctx = stream_context_create(['ssl' => $ssl]);
        $fp = @stream_socket_client(($enc === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) { throw new \RuntimeException("não consegui conectar a $host:$port ($errstr)."); }
        stream_set_timeout($fp, 15);
        $read = function () use ($fp): string {
            $data = '';
            while (($line = fgets($fp, 515)) !== false) {
                $data .= $line;
                if (strlen($line) < 4 || $line[3] === ' ') { break; }
            }
            return $data;
        };
        $cmd = function (string $c, array $ok) use ($fp, $read): string {
            if ($c !== '') { fwrite($fp, $c . "\r\n"); }
            $r = $read();
            if (!in_array((int) substr($r, 0, 3), $ok, true)) { throw new \RuntimeException('SMTP: resposta inesperada ' . trim($r)); }
            return $r;
        };
        $me = parse_url((string) Env::get('APP_URL', 'http://localhost'), PHP_URL_HOST) ?: 'localhost';
        $cmd('', [220]);
        $cmd("EHLO $me", [250]);
        if ($enc === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new \RuntimeException('falha na conexão segura (STARTTLS). No Windows/XAMPP isso costuma ser falta do arquivo de certificados: defina MAIL_CA_FILE no .env (ex.: C:\\xampp\\apache\\bin\\curl-ca-bundle.crt).');
            }
            $cmd("EHLO $me", [250]);
        }
        $user = (string) Env::get('MAIL_USERNAME', '');
        if ($user !== '') {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($user), [334]);
            try {
                $cmd(base64_encode((string) Env::get('MAIL_PASSWORD', '')), [235]);
            } catch (\RuntimeException $e) {
                throw new \RuntimeException('o servidor de e-mail recusou o usuário/senha (MAIL_USERNAME/MAIL_PASSWORD). No Gmail, use uma “senha de app”, não a senha normal da conta.');
            }
        }
        $cmd("MAIL FROM:<$from>", [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);
        $data = preg_replace('/^\./m', '..', self::raw($headers, $body));
        $cmd($data . '.', [250]);
        $cmd('QUIT', [221]);
        fclose($fp);
        return true;
    }
}
