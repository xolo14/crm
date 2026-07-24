<?php
/**
 * Close expired WhatsApp 24h customer-care windows.
 * Schedule via Hostinger cron every 5 minutes:
 *   php /home/.../public_html/api/cron_wa_windows.php
 * Or hit (secured by CRON_SECRET if defined):
 *   GET /api/cron_wa_windows.php?key=YOUR_CRON_SECRET
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/WhatsAppInbox.php';

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
WhatsAppInbox::ensureTables($db);
$closed = WhatsAppInbox::closeExpiredWindows($db);

if ($cli) {
    echo "closed={$closed}\n";
    exit(0);
}

header('Content-Type: application/json');
echo json_encode(['ok' => true, 'closed' => $closed]);
