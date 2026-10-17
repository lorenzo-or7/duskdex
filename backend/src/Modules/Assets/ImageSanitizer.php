<?php
declare(strict_types=1);

namespace DuskDex\Modules\Assets;

/**
 * Remove metadados de imagens SEM recomprimir (sem perda de qualidade):
 * - JPEG: segmentos APP1 (EXIF/XMP, inclui GPS), APP12–APP15 e COM. Mantém APP0 (JFIF), APP2 (perfil ICC) e APP14 (Adobe).
 * - PNG: blocos eXIf, tEXt, zTXt, iTXt, tIME.
 * - WebP: blocos EXIF e XMP (e o bit correspondente no cabeçalho VP8X).
 * Se o arquivo não tiver a estrutura esperada, devolve null (o upload é recusado).
 */
final class ImageSanitizer
{
    public static function clean(string $bytes, string $mime): ?string
    {
        return match ($mime) {
            'image/jpeg' => self::jpeg($bytes),
            'image/png' => self::png($bytes),
            'image/webp' => self::webp($bytes),
            default => null,
        };
    }

    private static function jpeg(string $b): ?string
    {
        if (substr($b, 0, 2) !== "\xFF\xD8") { return null; }
        $out = "\xFF\xD8";
        $i = 2; $n = strlen($b);
        while ($i + 4 <= $n) {
            if ($b[$i] !== "\xFF") { return null; }
            $marker = ord($b[$i + 1]);
            if ($marker === 0xD9) { return $out . substr($b, $i); }
            if ($marker === 0xDA) { return $out . substr($b, $i); } // início dos dados: copia o resto
            if ($marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) { $out .= substr($b, $i, 2); $i += 2; continue; }
            $len = unpack('n', substr($b, $i + 2, 2))[1];
            if ($len < 2 || $i + 2 + $len > $n) { return null; }
            $drop = $marker === 0xE1 || ($marker >= 0xEC && $marker <= 0xEF) || $marker === 0xFE;
            if (!$drop) { $out .= substr($b, $i, 2 + $len); }
            $i += 2 + $len;
        }
        return null;
    }

    private static function png(string $b): ?string
    {
        if (substr($b, 0, 8) !== "\x89PNG\r\n\x1a\n") { return null; }
        $out = substr($b, 0, 8);
        $i = 8; $n = strlen($b);
        while ($i + 12 <= $n) {
            $len = unpack('N', substr($b, $i, 4))[1];
            $type = substr($b, $i + 4, 4);
            if ($i + 12 + $len > $n) { return null; }
            if (!in_array($type, ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'], true)) { $out .= substr($b, $i, 12 + $len); }
            $i += 12 + $len;
            if ($type === 'IEND') { return $out; }
        }
        return null;
    }

    private static function webp(string $b): ?string
    {
        if (substr($b, 0, 4) !== 'RIFF' || substr($b, 8, 4) !== 'WEBP') { return null; }
        $body = ''; $i = 12; $n = strlen($b);
        while ($i + 8 <= $n) {
            $type = substr($b, $i, 4);
            $len = unpack('V', substr($b, $i + 4, 4))[1];
            $total = 8 + $len + ($len & 1);
            if ($i + 8 + $len > $n) { return null; }
            $chunk = substr($b, $i, min($total, $n - $i));
            if ($type === 'VP8X' && $len >= 10) {
                // limpa os bits de EXIF (0x08) e XMP (0x04) nos flags
                $flags = ord($chunk[8]) & ~0x0C;
                $chunk[8] = chr($flags);
            }
            if ($type !== 'EXIF' && $type !== 'XMP ') { $body .= $chunk; }
            $i += $total;
        }
        if ($body === '') { return null; }
        return 'RIFF' . pack('V', 4 + strlen($body)) . 'WEBP' . $body;
    }
}
