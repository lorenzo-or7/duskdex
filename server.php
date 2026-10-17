<?php
// Roteador para o servidor embutido do PHP (somente desenvolvimento):
//   php -S 127.0.0.1:8080 server.php
// /api/v1/* → backend PHP; demais caminhos → arquivos estáticos de frontend/.

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (str_starts_with($path, '/api/v1')) {
    require __DIR__ . '/backend/public/index.php';
    return true;
}

$root = realpath(__DIR__ . '/frontend');
$file = realpath($root . ($path === '/' ? '/index.html' : $path));
if ($file === false || !str_starts_with($file, $root) || is_dir($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Não encontrado';
    return true;
}

$types = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'webp' => 'image/webp', 'jpg' => 'image/jpeg', 'json' => 'application/json',
    'webmanifest' => 'application/manifest+json', 'ico' => 'image/x-icon',
];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-cache'); // sempre confere a versão nova dos arquivos
if ($ext === 'html') {
    // mesma Content-Security-Policy do pacote de hospedagem (o script inline do tema entra pelo hash)
    preg_match_all('#<script>(.*?)</script>#s', (string) file_get_contents($file), $m);
    $hashes = implode(' ', array_map(static fn ($s) => "'sha256-" . base64_encode(hash('sha256', $s, true)) . "'", $m[1]));
    header("Content-Security-Policy: default-src 'self'; script-src 'self' $hashes; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://assets.tcgdex.net https://images.pokemontcg.io https://images.scrydex.com; connect-src 'self' blob: data: https://api.tcgdex.net; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()');
}
readfile($file);
return true;
