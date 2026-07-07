<?php
/**
 * Deploy check — visit /api/ping.php after upload.
 * Always returns JSON (works before database is configured).
 */
header('Content-Type: application/json; charset=UTF-8');

$configPath = __DIR__ . '/config.php';

if (!is_file($configPath)) {
    http_response_code(503);
    echo json_encode([
        'status' => 'setup_required',
        'php' => PHP_VERSION,
        'api' => 'reachable',
        'database' => 'not_configured',
        'message' => 'Create api/config.php on Hostinger (copy from config.example.php).',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!is_file(__DIR__ . '/db.php')) {
    http_response_code(503);
    echo json_encode([
        'status' => 'error',
        'php' => PHP_VERSION,
        'api' => 'reachable',
        'database' => 'not_configured',
        'message' => 'Missing api/db.php — re-upload the full api/ folder from the latest dist build.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

require_once $configPath;
require_once __DIR__ . '/db.php';

$dbOk = false;
$dbMessage = 'Database connection failed — verify DB_HOST/DB_NAME/DB_USER/DB_PASS in api/config.php (Hostinger: use localhost + MySQL user from hPanel).';
if (defined('DB_HOST') && defined('DB_NAME') && defined('DB_USER') && defined('DB_PASS')) {
    try {
        $pdo = syncpediaCreatePdo();
        $pdo->query('SELECT 1');
        $dbOk = true;
    } catch (Throwable $e) {
        $dbMessage = 'Database connection failed — import database.mysql.sql in phpMyAdmin and check credentials in api/config.php.';
    }
} else {
    $dbMessage = 'api/config.php is missing DB_* defines.';
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? '';
$site = (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '')
    ? rtrim((string) CRM_PUBLIC_URL, '/')
    : ($host !== '' ? $scheme . '://' . $host : '');

require_once __DIR__ . '/document_storage.php';
$invoiceStorage = syncpediaDocumentStorageHealth('payment_invoices');

$debug = defined('APP_DEBUG') && APP_DEBUG === true;
http_response_code($dbOk ? 200 : 503);
if ($debug) {
    echo json_encode([
        'status' => $dbOk ? 'ok' : 'error',
        'php' => PHP_VERSION,
        'api' => 'reachable',
        'database' => $dbOk ? 'connected' : 'failed',
        'storage' => [
            'payment_invoices' => $invoiceStorage['writable'] ? 'writable' : 'not_writable',
        ],
        'message' => $dbOk ? 'Syncpedia CRM API is ready' : $dbMessage,
    ], JSON_UNESCAPED_UNICODE);
} else {
    echo json_encode([
        'status' => $dbOk ? 'ok' : 'error',
        'api' => 'reachable',
        'database' => $dbOk ? 'connected' : 'failed',
    ], JSON_UNESCAPED_UNICODE);
}
