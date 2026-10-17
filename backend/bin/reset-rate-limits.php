<?php
declare(strict_types=1);

// Zera os contadores de rate limit (somente desenvolvimento/testes). Uso: php backend/bin/reset-rate-limits.php

require dirname(__DIR__) . '/bootstrap.php';

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;

if (Env::get('APP_ENV') === 'production') {
    fwrite(STDERR, "Recusado em produção.\n");
    exit(1);
}
Database::exec('DELETE FROM rate_limits');
echo "Contadores de rate limit zerados.\n";
