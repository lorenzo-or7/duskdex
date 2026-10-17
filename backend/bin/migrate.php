<?php
declare(strict_types=1);

// Aplica migrações SQL versionadas (backend/migrations/NNN_nome.sql) em ordem.
// Uso: php backend/bin/migrate.php [--fresh]   (--fresh apaga TODAS as tabelas; bloqueado em produção)

require dirname(__DIR__) . '/bootstrap.php';

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;

$fresh = in_array('--fresh', $argv, true);
try {
    $pdo = Database::pdo();
} catch (\PDOException $e) {
    if ((int) ($e->errorInfo[1] ?? 0) !== 1049) {
        fwrite(STDERR, Database::diagnose($e) . "\n");
        exit(1);
    }
    // banco ainda não existe: cria e segue
    $name = (string) Env::get('DB_DATABASE', 'duskdex');
    if (!preg_match('/^[A-Za-z0-9_]+$/', $name)) { fwrite(STDERR, "Nome de banco inválido em DB_DATABASE.\n"); exit(1); }
    try {
        $server = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', Env::get('DB_HOST', '127.0.0.1'), Env::int('DB_PORT', 3306)),
            Env::get('DB_USERNAME', 'root'), Env::get('DB_PASSWORD', ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $server->exec("CREATE DATABASE IF NOT EXISTS `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        echo "Banco “{$name}” criado.\n";
        $pdo = Database::pdo();
    } catch (\PDOException $e2) {
        fwrite(STDERR, "O banco “{$name}” não existe e não foi possível criá-lo (" . Database::diagnose($e2) . "). Crie-o no phpMyAdmin e rode de novo.\n");
        exit(1);
    }
}

if ($fresh) {
    if (Env::get('APP_ENV') === 'production') {
        fwrite(STDERR, "Recusado: --fresh não é permitido com APP_ENV=production.\n");
        exit(1);
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $pdo->exec('DROP TABLE `' . str_replace('`', '', $t) . '`');
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    echo "Banco limpo.\n";
}

foreach (($applied = \DuskDex\Kernel\Migrator::run($pdo)) as $version) {
    echo "Aplicada: $version\n";
}
echo $applied ? count($applied) . " migração(ões) aplicada(s).\n" : "Nada a aplicar — banco atualizado.\n";
