<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Utilitários de conexões de saída: arquivo de certificados para TLS (também no Windows/XAMPP). */
final class Http
{
    /** Arquivo de certificados para TLS: MAIL_CA_FILE, o do php.ini, ou o que acompanha o XAMPP no Windows. */
    public static function caBundle(): ?string
    {
        foreach ([Env::get('MAIL_CA_FILE'), ini_get('openssl.cafile') ?: null, ini_get('curl.cainfo') ?: null] as $f) {
            if ($f && is_file($f)) { return $f; }
        }
        if (PHP_OS_FAMILY === 'Windows') {
            $php = dirname(PHP_BINARY);
            foreach ([$php . '\\extras\\ssl\\cacert.pem', dirname($php) . '\\apache\\bin\\curl-ca-bundle.crt', 'C:\\xampp\\apache\\bin\\curl-ca-bundle.crt', 'C:\\xampp\\php\\extras\\ssl\\cacert.pem'] as $f) {
                if (is_file($f)) { return $f; }
            }
        }
        return null; // certificados do sistema (Linux/hospedagem)
    }
}
