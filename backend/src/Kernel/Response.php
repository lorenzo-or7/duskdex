<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Resposta JSON no formato padrão. */
final class Response
{
    /** Verdadeiro quando o handler já enviou a resposta (arquivos). */
    public static bool $sent = false;

    public static function json(mixed $data, int $status = 200, array $meta = []): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        $out = ['data' => $data];
        if ($meta) {
            $out['meta'] = $meta;
        }
        echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }

    public static function error(int $status, string $code, string $message, array $details = [], ?string $requestId = null): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => array_filter([
            'code' => $code, 'message' => $message, 'details' => $details ?: null, 'request_id' => $requestId,
        ], fn ($v) => $v !== null)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Envia um arquivo (imagem) com cabeçalhos seguros. `$private` = só o dono pode ver (sem cache compartilhado). */
    public static function file(string $path, string $mime, bool $private, ?string $etag = null): void
    {
        header_remove('Cache-Control');
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string) filesize($path));
        header('Content-Disposition: inline');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('Cache-Control: ' . ($private ? 'private, max-age=86400' : 'public, max-age=86400'));
        if ($etag) {
            header('ETag: "' . $etag . '"');
            if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), '"') === $etag) {
                http_response_code(304);
                self::$sent = true;
                return;
            }
        }
        http_response_code(200);
        readfile($path);
        self::$sent = true;
    }

    public static function securityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('X-Frame-Options: DENY');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
        header('Cache-Control: no-store');
    }
}
