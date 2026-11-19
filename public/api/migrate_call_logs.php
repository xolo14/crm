<?php
/**
 * One-time call-log clean-up (CLI only, dry run unless --apply):
 *   1. Duplicates: rows with the same rep, phone, date, time and duration — keep one (the one
 *      with a recording if any, else the oldest), delete the rest.
 *   2. Impossible durations (> 4 hours) set to 0.
 *   3. Phone numbers in +91 form.
 *   4. lead_id backfilled by matching the phone number to a lead in the same organization.
 *
 *   php /var/www/crm/api/migrate_call_logs.php            # report only
 *   php /var/www/crm/api/migrate_call_logs.php --apply    # write
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';

$apply = in_array('--apply', $argv ?? [], true);
$db = (new Database())->getConnection();
$maxDuration = 14400;

$normPhone = static function (string $raw): string {
    $raw = trim($raw);
    $d = preg_replace('/\D+/', '', $raw) ?? '';
    if (strlen($d) === 10) {
        return '+91' . $d;
    }
    if (strlen($d) === 11 && $d[0] === '0') {
        return '+91' . substr($d, 1);
    }
    if (strlen($d) === 12 && str_starts_with($d, '91')) {
        return '+' . $d;
    }
    return $raw;
};

// ── 1. Duplicates ────────────────────────────────────────────────────────
$rows = $db->query(
    "SELECT id, sales_rep_id, client_phone, call_date, call_time, COALESCE(duration_seconds, 0) AS dur,
            attachment_path
       FROM call_logs
      WHERE client_phone IS NOT NULL AND client_phone <> '' AND call_time IS NOT NULL
      ORDER BY id ASC"
)->fetchAll(PDO::FETCH_ASSOC) ?: [];
$groups = [];
foreach ($rows as $r) {
    $digits = preg_replace('/\D+/', '', (string) $r['client_phone']) ?? '';
    $key = implode('|', [$r['sales_rep_id'], substr($digits, -10), $r['call_date'], $r['call_time'], $r['dur']]);
    $groups[$key][] = $r;
}
$toDelete = [];
$dupGroups = 0;
foreach ($groups as $g) {
    if (count($g) < 2) {
        continue;
    }
    $dupGroups++;
    // Keep the row that has a recording; otherwise the oldest.
    $keep = $g[0];
    foreach ($g as $r) {
        if (!empty($r['attachment_path'])) {
            $keep = $r;
            break;
        }
    }
    foreach ($g as $r) {
        if ($r['id'] !== $keep['id'] && empty($r['attachment_path'])) {
            $toDelete[] = (int) $r['id'];
        }
    }
}
echo "1. Duplicates: {$dupGroups} group(s), " . count($toDelete) . " extra row(s) to delete\n";
if ($apply && $toDelete) {
    foreach (array_chunk($toDelete, 200) as $chunk) {
        $ph = implode(',', array_fill(0, count($chunk), '?'));
        $db->prepare("DELETE FROM call_logs WHERE id IN ($ph)")->execute($chunk);
    }
    echo "   deleted " . count($toDelete) . "\n";
}

// ── 2. Impossible durations ─────────────────────────────────────────────
$long = $db->query("SELECT id, client_phone, call_date, duration_seconds FROM call_logs WHERE duration_seconds > {$maxDuration}")->fetchAll(PDO::FETCH_ASSOC) ?: [];
echo "2. Durations over 4 hours: " . count($long) . "\n";
foreach ($long as $r) {
    echo "   id={$r['id']} {$r['call_date']} {$r['client_phone']} {$r['duration_seconds']}s\n";
}
if ($apply && $long) {
    $db->exec("UPDATE call_logs SET duration_seconds = 0 WHERE duration_seconds > {$maxDuration}");
    echo "   set to 0\n";
}

// ── 3 + 4. Phone format and lead links ─────────────────────────────────
$leadIdx = [];
foreach ($db->query("SELECT id, org_id, phone FROM leads WHERE phone IS NOT NULL AND phone <> '' ORDER BY created_at ASC")->fetchAll(PDO::FETCH_ASSOC) ?: [] as $l) {
    $d = preg_replace('/\D+/', '', (string) $l['phone']) ?? '';
    if (strlen($d) >= 10) {
        $leadIdx[(string) $l['org_id'] . '|' . substr($d, -10)] = (string) $l['id']; // newest wins
    }
}
$calls = $db->query("SELECT id, org_id, lead_id, client_phone FROM call_logs WHERE client_phone IS NOT NULL AND client_phone <> ''")->fetchAll(PDO::FETCH_ASSOC) ?: [];
$phoneFix = 0;
$linked = 0;
$updPhone = $db->prepare('UPDATE call_logs SET client_phone = ? WHERE id = ?');
$updLead = $db->prepare('UPDATE call_logs SET lead_id = ? WHERE id = ? AND (lead_id IS NULL OR lead_id = \'\')');
foreach ($calls as $c) {
    $p = (string) $c['client_phone'];
    $n = $normPhone($p);
    if ($n !== $p) {
        $phoneFix++;
        if ($apply) {
            $updPhone->execute([$n, $c['id']]);
        }
    }
    if (empty($c['lead_id'])) {
        $d = preg_replace('/\D+/', '', $n) ?? '';
        $lid = strlen($d) >= 10 ? ($leadIdx[(string) $c['org_id'] . '|' . substr($d, -10)] ?? null) : null;
        if ($lid !== null) {
            $linked++;
            if ($apply) {
                $updLead->execute([$lid, $c['id']]);
            }
        }
    }
}
echo "3. Phone numbers to normalise to +91: {$phoneFix}\n";
echo "4. Calls to link to a lead by phone: {$linked} of " . count($calls) . "\n";
// ── 5. Recordings that contain no sound ────────────────────────────────
$hasCol = false;
try {
    $hasCol = syncpediaColumnExists($db, 'call_logs', 'recording_status');
    if (!$hasCol && $apply) {
        $db->exec("ALTER TABLE call_logs ADD COLUMN recording_status VARCHAR(16) DEFAULT NULL");
        $hasCol = true;
    }
} catch (Throwable $e) {
    echo "   could not add recording_status: {$e->getMessage()}\n";
}
$ffmpegPath = function_exists('shell_exec') ? trim((string) @shell_exec('command -v ffmpeg 2>/dev/null')) : '';
echo '5. Recordings checked for sound (ffmpeg ' . ($ffmpegPath !== '' ? 'found' : 'NOT installed — only WAV files can be checked') . "):\n";
$recs = $db->query("SELECT id, call_date, client_phone, attachment_path FROM call_logs WHERE attachment_path IS NOT NULL AND attachment_path <> ''")->fetchAll(PDO::FETCH_ASSOC) ?: [];
$updRec = $hasCol ? $db->prepare('UPDATE call_logs SET recording_status = ? WHERE id = ?') : null;
foreach ($recs as $r) {
    $abs = callRecordingAbsolutePath((string) $r['attachment_path']);
    $audible = $abs !== null ? callRecordingIsAudible($abs) : null;
    $status = $audible === false ? 'no_audio' : 'ok';
    $label = $abs === null ? 'file missing' : ($audible === null ? 'could not check' : ($audible ? 'has sound' : 'SILENT'));
    echo "   id={$r['id']} {$r['call_date']} {$r['client_phone']}  " . basename((string) $r['attachment_path']) . "  -> {$label}\n";
    if ($apply && $updRec) {
        $updRec->execute([$status, $r['id']]);
    }
}

echo $apply ? "Done.\n" : "Dry run — nothing changed. Re-run with --apply to write.\n";
