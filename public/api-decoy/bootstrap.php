<?php
/**
 * DECOY-ONLY bootstrap — Neon Postgres + DECOY_JWT_SECRET.
 * Isolated from public/api/bootstrap.php (Hostinger MySQL CRM).
 */
if (!function_exists('decoy_json_die')) {
    function decoy_json_die(array $data, int $status = 500): void
    {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=UTF-8');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// Prefer config.php if present; otherwise use config.example.php (no rename required).
$configPath = is_file(__DIR__ . '/config.php')
    ? (__DIR__ . '/config.php')
    : (__DIR__ . '/config.example.php');
if (!is_file($configPath)) {
    decoy_json_die([
        'error' => 'Decoy not configured',
        'message' => 'Set Neon DECOY_DATABASE_URL (or DECOY_DB_*) + DECOY_JWT_SECRET in api-decoy/config.example.php.',
    ], 503);
}

require_once $configPath;

if (!defined('DECOY_JWT_SECRET')) {
    decoy_json_die(['error' => "Missing define('DECOY_JWT_SECRET') in api-decoy/config.example.php"], 503);
}

if (strlen((string) DECOY_JWT_SECRET) < 32
    || stripos((string) DECOY_JWT_SECRET, 'replace-with') !== false
    || stripos((string) DECOY_JWT_SECRET, 'not-prod') !== false
) {
    decoy_json_die([
        'error' => 'Insecure DECOY_JWT_SECRET',
        'message' => 'Set DECOY_JWT_SECRET to a random string of at least 32 characters (different from real JWT_SECRET).',
    ], 503);
}

$url = defined('DECOY_DATABASE_URL') ? trim((string) DECOY_DATABASE_URL) : '';
$host = defined('DECOY_DB_HOST') ? trim((string) DECOY_DB_HOST) : '';
$user = defined('DECOY_DB_USER') ? trim((string) DECOY_DB_USER) : '';
$pass = defined('DECOY_DB_PASS') ? (string) DECOY_DB_PASS : '';
$name = defined('DECOY_DB_NAME') ? trim((string) DECOY_DB_NAME) : '';

$hasUrl = $url !== ''
    && stripos($url, 'ep-xxxx') === false
    && stripos($url, 'change-me') === false
    && (stripos($url, 'neon.tech') !== false || stripos($url, 'postgresql://') === 0 || stripos($url, 'postgres://') === 0);

$hasParts = $host !== ''
    && $user !== ''
    && $pass !== ''
    && $name !== ''
    && stripos($host, 'ep-xxxx') === false
    && stripos($host, 'localhost') === false
    && $pass !== 'change-me-neon-password'
    && $pass !== 'change-me-decoy-only';

if (!$hasUrl && !$hasParts) {
    decoy_json_die([
        'error' => 'Decoy Neon database not configured',
        'message' => 'Create a Neon project and set DECOY_DATABASE_URL (or DECOY_DB_HOST/USER/PASS/NAME) in api-decoy/config.example.php. Do not use the Syncpedia Hostinger MySQL database.',
        'hint' => 'Neon Console → Connection string → copy URI with sslmode=require',
    ], 503);
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/lib/decoyAlert.php';
require_once __DIR__ . '/lib/maskPii.php';
require_once __DIR__ . '/lib/jwt.php';

if (!defined('DECOY_TOKEN_EXPIRY')) {
    define('DECOY_TOKEN_EXPIRY', 3600);
}
if (!defined('DECOY_COOKIE_NAME')) {
    define('DECOY_COOKIE_NAME', 'syncpedia_decoy_session');
}
if (!defined('DECOY_FRONTEND_PATH')) {
    define('DECOY_FRONTEND_PATH', '/legacy');
}
if (!defined('DECOY_ALERT_WEBHOOK_URL')) {
    define('DECOY_ALERT_WEBHOOK_URL', '');
}
if (!defined('DECOY_APP_DEBUG')) {
    define('DECOY_APP_DEBUG', false);
}
if (!defined('DECOY_DB_SSLMODE')) {
    define('DECOY_DB_SSLMODE', 'require');
}
