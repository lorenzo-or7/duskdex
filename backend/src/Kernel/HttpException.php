<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Erro de domínio/HTTP com formato padrão {error:{code,message,details}}. */
final class HttpException extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message, $status);
    }

    public static function validation(string $message, array $details = []): self { return new self(422, 'VALIDATION', $message, $details); }
    public static function notFound(string $message = 'Recurso não encontrado.'): self { return new self(404, 'NOT_FOUND', $message); }
    public static function conflict(string $message, array $details = []): self { return new self(409, 'CONFLICT', $message, $details); }
    public static function unauthenticated(): self { return new self(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.'); }
    public static function rule(string $code, string $message): self { return new self(422, $code, $message); }
}
