<?php
/**
 * Send scheduled marketing campaign emails that are due.
 * Schedule via Hostinger cron every 5–10 minutes:
 *   php /home/.../public_html/api/cron_email_campaigns.php
 * Or:
 *   GET /api/cron_email_campaigns.php?key=YOUR_CRON_SECRET
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/MarketingEmailDispatch.php';

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
$out = array_merge(['ok' => true], marketingProcessDueEmailSends($db));

if ($cli) {
    echo json_encode($out) . PHP_EOL;
    exit(0);
}
header('Content-Type: application/json');
echo json_encode($out);
