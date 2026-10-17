<?php
declare(strict_types=1);

// Preparação automática para rodar localmente (usado pelo iniciar.bat / iniciar.sh):
//  1. cria o .env a partir do .env.example, se ainda não existir;
//  2. confere se o MySQL responde na porta do .env; se não, procura nas portas comuns (3306, 3307, 3308)
//     e grava a porta encontrada no .env.
// Não mexe em senha nem em nada além de DB_PORT.

$root = dirname(__DIR__, 2);
$env = $root . '/.env';
$example = $root . '/.env.example';

if (!extension_loaded('pdo_mysql')) {
    fwrite(STDERR, "O PHP não está com a extensão pdo_mysql ativa. No XAMPP, abra php\\php.ini e tire o ';' da linha extension=pdo_mysql.\n");
    exit(1);
}

if (!is_file($env)) {
    if (!is_file($example) || !copy($example, $env)) {
        fwrite(STDERR, "Não consegui criar o arquivo .env.\n");
        exit(1);
    }
    echo "Arquivo .env criado.\n";
}

$text = (string) file_get_contents($env);
$read = static function (string $key, string $default) use ($text): string {
    if (preg_match('/^\s*' . $key . '\s*=\s*([^#\r\n]*)/m', $text, $m)) {
        $v = trim(trim($m[1]), "\"'");
        return $v === '' ? $default : $v;
    }
    return $default;
};
$host = $read('DB_HOST', '127.0.0.1');
$port = (int) $read('DB_PORT', '3306');

$open = static function (string $host, int $port): bool {
    $s = @fsockopen($host, $port, $errno, $errstr, 1.5);
    if ($s) { fclose($s); return true; }
    return false;
};

if ($open($host, $port)) {
    echo "MySQL encontrado na porta $port.\n";
    exit(0);
}

foreach (array_unique([3306, 3307, 3308, 3310]) as $p) {
    if ($p !== $port && $open($host, $p)) {
        $text = preg_match('/^\s*DB_PORT\s*=.*$/m', $text)
            ? (string) preg_replace('/^\s*DB_PORT\s*=.*$/m', 'DB_PORT=' . $p, $text, 1)
            : rtrim($text) . "\nDB_PORT=$p\n";
        file_put_contents($env, $text);
        echo "MySQL encontrado na porta $p (atualizei o .env).\n";
        exit(0);
    }
}

fwrite(STDERR, "Não encontrei o MySQL rodando (tentei as portas $port, 3306, 3307, 3308). Abra o painel do XAMPP e clique em Start no MySQL.\n");
exit(1);
