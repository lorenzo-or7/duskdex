<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Requisição HTTP mínima (método, caminho, query, corpo JSON, cabeçalhos). */
final class Request
{
    public array $params = [];
    private ?array $jsonBody = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        private readonly string $rawBody,
        private readonly array $headers,
        public readonly string $ip,
    ) {}

    public static function fromGlobals(string $basePath = '/api/v1'): self
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $pos = strpos($uri, $basePath);
        $path = $pos === false ? $uri : substr($uri, $pos + strlen($basePath));
        $headers = [];
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = $_SERVER['CONTENT_TYPE'];
        }
        return new self(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), '/' . trim($path, '/'), $_GET, (string) file_get_contents('php://input'), $headers, $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public function header(string $name): ?string { return $this->headers[strtolower($name)] ?? null; }

    /** Corpo bruto (uploads binários). */
    public function raw(): string { return $this->rawBody; }

    public function json(int $maxBytes = 2_000_000): array
    {
        if ($this->jsonBody !== null) {
            return $this->jsonBody;
        }
        if ($this->rawBody === '') {
            return $this->jsonBody = [];
        }
        if (strlen($this->rawBody) > $maxBytes) {
            throw new HttpException(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.');
        }
        $data = json_decode($this->rawBody, true);
        if (!is_array($data)) {
            throw new HttpException(400, 'BAD_JSON', 'Corpo da requisição não é um JSON válido.');
        }
        return $this->jsonBody = $data;
    }

    public function input(string $key, mixed $default = null): mixed { return $this->json()[$key] ?? $default; }
}
