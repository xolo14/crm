<?php
/**
 * One-time status migration: leads marked "enrolled" whose student row has no course
 * and no batch only paid the registration fee. Move them to the new "registered" status.
 *
 * Direct SQL on purpose: changing status through the API would treat "leaving enrolled"
 * as un-enrolling and delete the student row. Student rows are untouched here.
 *
 * CLI only (safe to re-run):
 *   php /var/www/crm/api/migrate_registered_status.php            # dry run
 *   php /var/www/crm/api/migrate_registered_status.php --apply    # writes changes
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';

$apply = in_array('--apply', $argv ?? [], true);
$db = (new Database())->getConnection();

// Make sure the column can hold the new value (VARCHAR, or ENUM including 'registered').
ensureLeadsStatusColumn($db, true);

$sql = "SELECT l.id, l.name, l.email, l.org_id
          FROM leads l
          JOIN students s ON s.lead_id = l.id
         WHERE LOWER(TRIM(l.status)) IN ('enrolled', 'converted')
           AND (s.course_id IS NULL OR s.course_id = '')
           AND (s.batch_id IS NULL OR s.batch_id = '')";
$rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

foreach ($rows as $r) {
    echo ($apply ? 'registered ' : 'would mark registered ') . $r['id'] . '  ' . ($r['name'] ?? '') . ' <' . ($r['email'] ?? '') . ">\n";
}

if ($apply && $rows) {
    $upd = $db->prepare("UPDATE leads SET status = 'registered', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND LOWER(TRIM(status)) IN ('enrolled', 'converted')");
    $done = 0;
    foreach ($rows as $r) {
        $upd->execute([$r['id']]);
        $done += $upd->rowCount();
    }
    $check = $db->prepare('SELECT status FROM leads WHERE id = ?');
    $check->execute([$rows[0]['id']]);
    if ((string) $check->fetchColumn() !== 'registered') {
        echo "WARNING: status column did not accept 'registered' — nothing usable was written. Check the leads.status column type.\n";
    }
    echo "updated {$done} lead(s)\n";
} else {
    echo ($apply ? 'nothing to update' : 'would update ' . count($rows) . ' lead(s) (dry run; pass --apply to write)') . "\n";
}
