<?php
declare(strict_types=1);

// Concede (ou remove) o papel de moderação a um usuário.
// Uso: php backend/bin/make-admin.php <username> [--remove]

require dirname(__DIR__) . '/bootstrap.php';

use DuskDex\Kernel\Database;

$username = strtolower((string) ($argv[1] ?? ''));
if ($username === '') {
    fwrite(STDERR, "Uso: php backend/bin/make-admin.php <username> [--remove]\n");
    exit(1);
}
$role = in_array('--remove', $argv, true) ? 'user' : 'admin';
$n = Database::exec('UPDATE users SET role = ? WHERE username = ?', [$role, $username]);
echo $n ? "@$username agora tem o papel “$role”.\n" : "Usuário @$username não encontrado (ou já tinha esse papel).\n";
