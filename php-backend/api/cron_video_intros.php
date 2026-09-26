<?php
/**
 * Delete video-intro recordings older than VIDEO_INTRO_RETENTION_DAYS (90) from local storage.
 * Invitation rows are kept. Schedule daily, e.g.:
 *   php /var/www/crm/api/cron_video_intros.php
 * Or:
 *   GET /api/cron_video_intros.php?key=YOUR_CRON_SECRET
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/gcs_storage.php';
require_once __DIR__ . '/lib/VideoIntros.php';

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
videoIntroEnsureSchema($db);
$purged = videoIntroPurgeExpiredRecordings($db);
$out = [
    'ok' => true,
    'retention_days' => VIDEO_INTRO_RETENTION_DAYS,
    'purged_recordings' => $purged,
];

if ($cli) {
    echo json_encode($out) . PHP_EOL;
    exit(0);
}
header('Content-Type: application/json');
echo json_encode($out);
