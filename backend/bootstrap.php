<?php
declare(strict_types=1);

// Autoload: usa o do Composer se existir; senão, um autoloader PSR-4 equivalente (projeto sem dependências externas).
$composer = __DIR__ . '/vendor/autoload.php';
if (is_file($composer)) {
    require $composer;
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'DuskDex\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }
        $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
    });
}

\DuskDex\Kernel\Env::load(dirname(__DIR__) . '/.env');
if (PHP_SAPI !== 'cli') {
    // avisos do PHP nunca vão para a resposta (vazariam caminhos e quebrariam o JSON): só para o log do servidor
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
}
date_default_timezone_set('UTC');
