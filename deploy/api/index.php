<?php
declare(strict_types=1);

// Ponto de entrada da API no pacote de hospedagem (o .htaccess encaminha /api/v1/* para cá).
if (!is_file(dirname(__DIR__) . '/.env')) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['code' => 'NOT_INSTALLED', 'message' => 'O DuskDex ainda não foi instalado neste servidor. Abra instalar.php.']], JSON_UNESCAPED_UNICODE);
    exit;
}
require dirname(__DIR__) . '/backend/bootstrap.php';

\DuskDex\App::handle();
