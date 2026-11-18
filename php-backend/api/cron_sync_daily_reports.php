<?php
/**
 * Nightly backfill: rebuild daily_reports rows from call_logs for every active sales rep.
 *
 * This used to run as a side effect of opening Sales Tracker, Rep Performance and
 * Daily Reports Analytics (POST call_logs.php?action=sync_daily_reports&days=90 on every
 * page view). Logging a call already syncs that day's report, so pages now only read and
 * this job catches anything missed.
 *
 * CLI:  php /var/www/crm/api/cron_sync_daily_reports.php [--days=7]
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';

$days = 7;
foreach ($argv ?? [] as $arg) {
    if (preg_match('/^--days=(\d+)$/', (string) $arg, $m)) {
        $days = max(1, min(730, (int) $m[1]));
    }
}
$from = (new DateTimeImmutable('today'))->modify('-' . ($days - 1) . ' days')->format('Y-m-d');

$db = (new Database())->getConnection();
$st = $db->prepare(
    'SELECT DISTINCT cl.sales_rep_id AS rep, cl.call_date AS d
       FROM call_logs cl
       JOIN users u ON u.id = cl.sales_rep_id AND u.is_active = 1
      WHERE cl.call_date >= ?'
);
$st->execute([$from]);

$synced = 0;
$failed = 0;
foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
    $rep = trim((string) ($row['rep'] ?? ''));
    $d = substr((string) ($row['d'] ?? ''), 0, 10);
    if ($rep === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
        continue;
    }
    try {
        syncpediaSyncDailyReportFromCallLogs($db, $rep, $d, null);
        $synced++;
    } catch (Throwable $e) {
        $failed++;
        error_log('[cron_sync_daily_reports] ' . $rep . ' ' . $d . ': ' . $e->getMessage());
    }
}
echo date('c') . " daily_reports synced: {$synced}, failed: {$failed} (since {$from})\n";
