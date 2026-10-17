<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Gera ULIDs (26 caracteres, Crockford base32, ordenáveis por tempo) para IDs públicos. */
final class Ulid
{
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public static function generate(): string
    {
        $time = (int) floor(microtime(true) * 1000);
        $timeChars = '';
        for ($i = 9; $i >= 0; $i--) {
            $timeChars = self::ALPHABET[$time % 32] . $timeChars;
            $time = intdiv($time, 32);
        }
        $rand = '';
        $bytes = random_bytes(16);
        for ($i = 0; $i < 16; $i++) {
            $rand .= self::ALPHABET[ord($bytes[$i]) % 32];
        }
        return $timeChars . $rand;
    }

    public static function isValid(string $v): bool
    {
        return (bool) preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/', $v);
    }
}
