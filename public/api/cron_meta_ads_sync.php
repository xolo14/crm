<?php
/**
 * Hourly Meta Ads insights sync (campaigns / daily).
 *
 * Hostinger cron (hourly):
 *   wget -q -O - "https://YOUR_DOMAIN/api/cron_meta_ads_sync.php?key=YOUR_CRON_SECRET" >/dev/null 2>&1
 * Or CLI:
 *   php /home/.../public_html/api/cron_meta_ads_sync.php
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/meta_ads_service.php';

$cli = (PHP_SAPI === 'cli');
if (!$cli) {
    $key = (string) ($_GET['key'] ?? $_SERVER['HTTP_X_CRON_KEY'] ?? '');
    $expected = '';
    if (defined('CRON_SECRET')) {
        $expected = (string) CRON_SECRET;
    } elseif (defined('WHATSAPP_CRON_SECRET')) {
        $expected = (string) WHATSAPP_CRON_SECRET;
    }
    if ($expected === '' || !hash_equals($expected, $key)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
}

$db = (new Database())->getConnection();
$lookback = 30;
if ($cli && isset($argv[1]) && ctype_digit((string) $argv[1])) {
    $lookback = max(1, (int) $argv[1]);
} elseif (isset($_GET['days']) && ctype_digit((string) $_GET['days'])) {
    $lookback = max(1, (int) $_GET['days']);
}

try {
    $result = metaAdsRunHourlySync($db, $lookback);
    $payload = [
        'success' => true,
        'data' => $result,
    ];
    if ($cli) {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL;
        exit(0);
    }
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('[cron_meta_ads_sync] ' . $e->getMessage());
    if ($cli) {
        fwrite(STDERR, $e->getMessage() . PHP_EOL);
        exit(1);
    }
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Sync failed']);
}
