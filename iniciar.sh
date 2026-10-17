#!/bin/sh
# Mac/Linux: prepara o .env, cria/atualiza o banco e liga o servidor em http://127.0.0.1:8080
cd "$(dirname "$0")" || exit 1
php backend/bin/setup.php && php backend/bin/migrate.php || exit 1
echo "Abrindo http://127.0.0.1:8080 (Ctrl+C para desligar)"
( sleep 1; (xdg-open http://127.0.0.1:8080 || open http://127.0.0.1:8080) >/dev/null 2>&1 ) &
exec php -S 127.0.0.1:8080 server.php
