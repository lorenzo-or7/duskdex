<?php
declare(strict_types=1);

// Front controller da API (aponte o servidor web para esta pasta em /api/v1, ou use server.php na raiz em desenvolvimento).
require dirname(__DIR__) . '/bootstrap.php';

\DuskDex\App::handle();
