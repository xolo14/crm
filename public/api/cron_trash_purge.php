<?php
/**
 * Permanently delete trash_items older than the 30-day retention window.
 * This used to run as a side effect of simply opening the Trash page (a GET request),
 * which meant a permanent, unconfirmed delete could be triggered by just loading a page —
 * including via a cross-site top-level navigation, since a GET is exempt from SameSite=Lax's
 * cross-site block. Moved here so the purge only ever runs on a schedule.
 *
 * Schedule via Hostinger/VPS cron every hour or so:
 *   php /home/.../public_html/api/cron_trash_purge.php
 * Or:
 *   GET /api/cron_trash_purge.php?key=YOUR_CRON_SECRET
 */
require_once __DIR__ . '/helpers.php';

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
$purged = trashPurgeExpired($db, 30);

if ($cli) {
    echo "trash_items purged: {$purged}\n";
} else {
    header('Content-Type: application/json');
    echo json_encode(['purged' => $purged]);
}
