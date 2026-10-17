<?php
declare(strict_types=1);

// Testa o envio de e-mail com a configuração do .env.
// Uso: php backend/bin/test-mail.php seu@email.com

require dirname(__DIR__) . '/bootstrap.php';

use DuskDex\Kernel\Env;
use DuskDex\Kernel\Mailer;

$to = (string) ($argv[1] ?? '');
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Uso: php backend/bin/test-mail.php seu@email.com\n");
    exit(1);
}
$driver = Mailer::driver();
if (Mailer::testMode()) {
    echo "MAIL_DRIVER está em modo de teste (\"$driver\"): o e-mail é só gravado em storage/mail.\n";
    echo "Para enviar de verdade, configure MAIL_DRIVER=smtp no .env (veja “E-mail” no README).\n\n";
}
echo "Enviando para $to via " . ($driver === 'smtp' ? 'SMTP ' . Env::get('MAIL_HOST', '?') . ':' . Env::get('MAIL_PORT', '587') : $driver) . "…\n";
$ok = Mailer::send($to, 'Teste de e-mail do DuskDex', "Se você recebeu esta mensagem, o envio de e-mails do DuskDex está funcionando.\n\n— DuskDex");
if ($ok) {
    echo Mailer::testMode() ? "Gravado em " . Mailer::storageDir() . "/mail\n" : "Enviado! Confira a caixa de entrada (e o spam).\n";
    exit(0);
}
fwrite(STDERR, "Falhou: " . (Mailer::$lastError ?? 'motivo desconhecido') . "\n");
exit(1);
