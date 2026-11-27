<?php
/**
 * Clear everything credited to recently created members so their Sales Tracker rows start empty:
 * daily reports (Calls / Follow-ups / Reports), call log, lead assignments (Assigned / New /
 * Contacted / Enroll / Lost) and form-lead credit (Form Leads). Leads themselves are NOT deleted,
 * only unassigned and un-credited.
 *
 * Only accounts created in the last 30 days can be reset. Without --reset nothing changes (preview).
 * With --reset, a JSON backup of every affected row is written to storage/tmp first.
 *
 * CLI:  php /var/www/crm/api/reset_new_member_activity.php "Sai Hemanth" "Maddela"            (preview)
 *       php /var/www/crm/api/reset_new_member_activity.php --reset "Sai Hemanth" "Maddela"    (apply)
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';
$db = (new Database())->getConnection();
$args = array_slice($argv ?? [], 1);
$apply = in_array('--reset', $args, true);
$names = array_values(array_filter($args, static fn($a) => $a !== '--reset' && trim($a) !== ''));
if ($names === []) {
    fwrite(STDERR, "Name at least one member, e.g. \"Sai Hemanth\"\n");
    exit(1);
}
$since = (new DateTimeImmutable('-30 days'))->format('Y-m-d H:i:s');
echo $apply ? "RESET (applied)\n" : "PREVIEW (nothing changed; add --reset to apply)\n";

$find = $db->prepare('SELECT id, full_name, email, role, referral_code, created_at FROM users WHERE full_name LIKE ? ORDER BY created_at');
$backupDir = dirname(__DIR__) . '/storage/tmp';
if ($apply && !is_dir($backupDir)) {
    @mkdir($backupDir, 0750, true);
}

foreach ($names as $n) {
    $find->execute(['%' . $n . '%']);
    $rows = $find->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        echo "\n== \"{$n}\": no member found\n";
        continue;
    }
    foreach ($rows as $u) {
        $id = (string) $u['id'];
        $code = (string) ($u['referral_code'] ?? '');
        echo "\n== {$u['full_name']} <{$u['email']}> ({$u['role']}) joined {$u['created_at']}\n";
        if ((string) $u['created_at'] < $since) {
            echo "   skipped: account is older than 30 days (not a new member)\n";
            continue;
        }
        $q = static function (string $sql, array $p) use ($db): array {
            $st = $db->prepare($sql);
            $st->execute($p);
            return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        };
        $reports = $q('SELECT * FROM daily_reports WHERE user_id = ?', [$id]);
        $calls = $q('SELECT * FROM call_logs WHERE sales_rep_id = ?', [$id]);
        $assigned = $q('SELECT id, name, status, created_at FROM leads WHERE assigned_to = ?', [$id]);
        $assignRows = $q('SELECT * FROM lead_assignments WHERE user_id = ?', [$id]);
        $credited = $code !== '' ? $q('SELECT id, name, status, created_at FROM leads WHERE referred_by = ?', [$code]) : [];
        echo '   daily reports: ' . count($reports) . "\n";
        foreach ($reports as $r) {
            echo "      {$r['report_date']}: calls={$r['total_calls']} followups={$r['total_followups']}\n";
        }
        echo '   call log entries: ' . count($calls) . "\n";
        echo '   leads assigned: ' . count($assigned) . ' (+' . count($assignRows) . " assignment rows)\n";
        foreach (array_slice($assigned, 0, 10) as $l) {
            echo "      {$l['name']} [{$l['status']}] created {$l['created_at']}\n";
        }
        echo '   leads credited to code ' . ($code ?: '-') . ': ' . count($credited) . "\n";
        if (!$apply) {
            continue;
        }
        $file = $backupDir . '/reset_' . preg_replace('/[^a-z0-9]+/i', '_', (string) $u['full_name']) . '_' . date('Ymd_His') . '.json';
        $ok = @file_put_contents($file, json_encode([
            'user' => $u, 'daily_reports' => $reports, 'call_logs' => $calls,
            'leads_assigned' => $assigned, 'lead_assignments' => $assignRows, 'leads_credited' => $credited,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        if ($ok === false) {
            echo "   NOT reset: could not write backup {$file}\n";
            continue;
        }
        $db->beginTransaction();
        try {
            $db->prepare('DELETE FROM daily_reports WHERE user_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM call_logs WHERE sales_rep_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM lead_assignments WHERE user_id = ?')->execute([$id]);
            $db->prepare('UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?')->execute([$id]);
            if ($code !== '') {
                $db->prepare('UPDATE leads SET referred_by = NULL WHERE referred_by = ?')->execute([$code]);
            }
            $db->commit();
            echo "   reset done; backup: {$file}\n";
            error_log("[reset member] {$u['full_name']} ({$id}) activity cleared; backup {$file}");
        } catch (Throwable $e) {
            $db->rollBack();
            echo '   reset FAILED (nothing changed): ' . $e->getMessage() . "\n";
        }
    }
}
