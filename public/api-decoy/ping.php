<?php
/**
 * DECOY-ONLY health — Neon Postgres (not CRM MySQL).
 */
header('Content-Type: application/json; charset=UTF-8');

$configPath = is_file(__DIR__ . '/config.php')
    ? (__DIR__ . '/config.php')
    : (__DIR__ . '/config.example.php');
if (!is_file($configPath)) {
    http_response_code(503);
    echo json_encode([
        'status' => 'setup_required',
        'layer' => 'decoy',
        'database' => 'not_configured',
        'driver' => 'pgsql',
        'message' => 'Set Neon DECOY_DATABASE_URL + DECOY_JWT_SECRET in config.example.php',
    ]);
    exit;
}

require_once $configPath;
require_once __DIR__ . '/db.php';

$pgsqlLoaded = extension_loaded('pdo_pgsql');
$url = defined('DECOY_DATABASE_URL') ? trim((string) DECOY_DATABASE_URL) : '';
$host = defined('DECOY_DB_HOST') ? trim((string) DECOY_DB_HOST) : '';
$hasUrl = $url !== '' && stripos($url, 'ep-xxxx') === false;
$hasParts = $host !== '' && stripos($host, 'ep-xxxx') === false && stripos($host, 'localhost') === false;

$dbOk = false;
$reason = null;
$detail = null;
try {
    if (!$pgsqlLoaded) {
        throw new RuntimeException('PHP extension pdo_pgsql is not enabled on this host');
    }
    if (!$hasUrl && !$hasParts) {
        throw new RuntimeException('Neon credentials not set in config.example.php (DECOY_DATABASE_URL or DECOY_DB_*)');
    }
    $pdo = decoyCreatePdo();
    $pdo->query('SELECT 1');
    $dbOk = true;
} catch (Throwable $e) {
    $dbOk = false;
    $msg = $e->getMessage();
    if (stripos($msg, 'could not find driver') !== false || stripos($msg, 'pdo_pgsql') !== false) {
        $reason = 'pdo_pgsql_missing';
    } elseif (stripos($msg, 'credentials not set') !== false) {
        $reason = 'config_empty';
    } elseif (stripos($msg, 'password authentication failed') !== false || stripos($msg, 'fe_sendauth') !== false) {
        $reason = 'bad_password_or_user';
    } elseif (stripos($msg, 'could not translate host') !== false || stripos($msg, 'Name or service not known') !== false) {
        $reason = 'bad_host';
    } elseif (stripos($msg, 'SSL') !== false || stripos($msg, 'certificate') !== false) {
        $reason = 'ssl_required';
    } elseif (stripos($msg, 'timeout') !== false || stripos($msg, 'timed out') !== false) {
        $reason = 'connection_timeout';
    } else {
        $reason = 'connect_failed';
    }
    if (defined('DECOY_APP_DEBUG') && DECOY_APP_DEBUG) {
        $detail = $msg;
    }
}

$hints = [
    'pdo_pgsql_missing' => 'Hostinger → Advanced → PHP Configuration → enable pdo_pgsql (and pgsql), save, retry',
    'config_empty' => 'Edit api-decoy/config.example.php on the server: set DECOY_DATABASE_URL from Neon Console (sslmode=require)',
    'bad_password_or_user' => 'Check Neon user/password; URL-encode special chars in the password if using DECOY_DATABASE_URL',
    'bad_host' => 'Use the Neon hostname ending in .neon.tech (not localhost)',
    'ssl_required' => 'Keep sslmode=require on the Neon URI',
    'connection_timeout' => 'Neon project may be paused — open Neon Console to wake it, then retry',
    'connect_failed' => 'Verify Neon URI in api-decoy/config.example.php; temporarily set DECOY_APP_DEBUG true for detail',
];

http_response_code($dbOk ? 200 : 503);
$payload = [
    'status' => $dbOk ? 'ok' : 'error',
    'layer' => 'decoy',
    'api' => 'reachable',
    'database' => $dbOk ? 'connected' : 'failed',
    'driver' => 'pgsql',
    'provider' => 'neon',
    'pdo_pgsql' => $pgsqlLoaded,
    'config_file' => basename($configPath),
    'has_database_url' => $hasUrl,
    'has_db_parts' => $hasParts,
];
if ($reason) {
    $payload['reason'] = $reason;
    $payload['hint'] = $hints[$reason] ?? null;
}
if ($detail) {
    $payload['detail'] = $detail;
}
echo json_encode($payload, JSON_UNESCAPED_UNICODE);
