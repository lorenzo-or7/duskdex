<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Roteador simples: padrões com {param}. */
final class Router
{
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler, bool $auth = true): void
    {
        $regex = '#^' . preg_replace('#\{([a-zA-Z]+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
        $this->routes[] = compact('method', 'regex', 'handler', 'auth');
    }

    /** @return array{handler: callable, auth: bool}|null */
    public function match(Request $req): ?array
    {
        $allowed = false;
        foreach ($this->routes as $r) {
            if (preg_match($r['regex'], $req->path, $m)) {
                if ($r['method'] !== $req->method) {
                    $allowed = true;
                    continue;
                }
                $req->params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
                return $r;
            }
        }
        if ($allowed) {
            throw new HttpException(405, 'METHOD_NOT_ALLOWED', 'Método não permitido nesta rota.');
        }
        return null;
    }
}
