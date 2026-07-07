<?php
/**
 * Hostinger / shared-hosting bootstrap — always respond with JSON on setup failures.
 * No server env vars required; configuration lives in api/config.php only.
 */

if (!function_exists('syncpedia_json_die')) {
    function syncpedia_json_die(array $data, int $status = 500): void
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

register_shutdown_function(static function (): void {
    if (defined('SYNCPIEDIA_API_DONE')) {
        return;
    }
    $err = error_get_last();
    if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_COMPILE_ERROR, E_CORE_ERROR], true)) {
        return;
    }
    syncpedia_json_die([
        'error' => 'PHP fatal error',
        'message' => 'Check Hostinger → Advanced → Error Logs. Common causes: missing api/config.php, wrong PHP version (use 8.1+), or syntax error in config.php.',
        'detail' => isset($err['message'])
            ? preg_replace('#(/[^\s:]+)+/#', '', (string) $err['message'])
            : null,
    ], 500);
});

$configPath = __DIR__ . '/config.php';
$examplePath = __DIR__ . '/config.example.php';

if (!is_file($configPath)) {
    syncpedia_json_die([
        'error' => 'Server not configured',
        'message' => 'Create api/config.php on Hostinger (copy from config.example.php in the same folder).',
        'hint' => 'Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASS from Hostinger → Databases (MySQL).',
    ], 503);
}

require_once $configPath;
require_once __DIR__ . '/db.php';

foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 'JWT_SECRET'] as $constant) {
    if (!defined($constant)) {
        syncpedia_json_die([
            'error' => 'Incomplete api/config.php',
            'message' => "Missing define('$constant', ...) in api/config.php.",
        ], 503);
    }
}

$placeholderDbNames = ['your_database_name', 'your_db_name', 'database_name', ''];
$placeholderDbUsers = ['your_database_user', 'your_db_user', 'database_user', ''];
if (in_array((string) DB_NAME, $placeholderDbNames, true) || in_array((string) DB_USER, $placeholderDbUsers, true)) {
    syncpedia_json_die([
        'error' => 'Database not configured',
        'message' => 'Edit api/config.php with Hostinger MySQL credentials (then import database.mysql.sql in phpMyAdmin).',
        'hint' => 'DB_HOST is usually localhost on Hostinger.',
    ], 503);
}

$weakJwtSecrets = ['change-this-to-a-random-secret-key-at-least-32-chars', 'your-jwt-secret', ''];
if (strlen((string) JWT_SECRET) < 32 || in_array((string) JWT_SECRET, $weakJwtSecrets, true)) {
    syncpedia_json_die([
        'error' => 'Insecure JWT_SECRET',
        'message' => 'Set JWT_SECRET in api/config.php to a random string of at least 32 characters.',
    ], 503);
}

if (!defined('APP_DEBUG')) {
    define('APP_DEBUG', false);
}
if (!defined('SIGNUP_ENABLED')) {
    define('SIGNUP_ENABLED', false);
}

if (!defined('FRONTEND_URL')) {
    define('FRONTEND_URL', '*');
}
if (!defined('TOKEN_EXPIRY')) {
    define('TOKEN_EXPIRY', 86400);
}
if (!defined('CRM_PUBLIC_URL')) {
    define('CRM_PUBLIC_URL', '');
}

function syncpediaCorsOrigin(): string
{
    if (defined('FRONTEND_URL') && FRONTEND_URL !== '' && FRONTEND_URL !== '*') {
        return (string) FRONTEND_URL;
    }
    if (!empty($_SERVER['HTTP_ORIGIN']) && is_string($_SERVER['HTTP_ORIGIN'])) {
        return $_SERVER['HTTP_ORIGIN'];
    }
    if (!empty($_SERVER['HTTP_HOST']) && is_string($_SERVER['HTTP_HOST'])) {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        return $scheme . '://' . $_SERVER['HTTP_HOST'];
    }
    return '*';
}

function syncpediaPublicSiteUrl(): string
{
    if (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '') {
        return rtrim((string) CRM_PUBLIC_URL, '/');
    }
    return syncpediaCorsOrigin() !== '*' ? syncpediaCorsOrigin() : (
        ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http')
        . '://'
        . ($_SERVER['HTTP_HOST'] ?? 'localhost')
    );
}
