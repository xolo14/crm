<?php
/**
 * Check: why do some members show "Form Leads" they never collected?
 * Prints each member's staff code and the leads carrying it, plus a preview of the repair
 * (syncpediaFixRecycledStaffCodes). Changes nothing unless --fix is passed.
 *
 * CLI:  php /var/www/crm/api/diag_staff_codes.php "Amajala" "Sai Hemanth" ...         (preview)
 *       php /var/www/crm/api/diag_staff_codes.php --fix "Amajala" "Sai Hemanth" ...   (apply)
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';
$db = (new Database())->getConnection();
$args = array_slice($argv ?? [], 1);
$apply = in_array('--fix', $args, true);
$names = array_values(array_filter($args, static fn($a) => $a !== '--fix'));

// Staff accounts created in the last 30 days whose code is on leads older than the account.
echo ($apply ? 'REPAIR (applied):' : 'REPAIR PREVIEW (nothing changed; add --fix to apply):') . "\n";
$lines = syncpediaFixRecycledStaffCodes($db, $apply);
echo $lines === [] ? "   nothing to repair\n" : '   ' . implode("\n   ", $lines) . "\n";
echo "\n";
if ($names === []) {
    $names = ['Amajala', 'Datti', 'Maddela', 'Sai Hemanth'];
}

try {
    ensureDeletedUsersTable($db);
    echo 'deleted_users rows: ' . (int) $db->query('SELECT COUNT(*) FROM deleted_users')->fetchColumn() . "\n";
} catch (Throwable $e) {
    echo 'deleted_users error: ' . $e->getMessage() . "\n";
}
echo "\n";

$u = $db->prepare('SELECT id, org_id, full_name, role, referral_code, created_at FROM users WHERE full_name LIKE ? ORDER BY created_at');
$cnt = $db->prepare('SELECT COUNT(*) c, MIN(created_at) first_lead, MAX(created_at) last_lead,
        SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) before_join
    FROM leads WHERE referred_by = ?');
$src = $db->prepare('SELECT source, COUNT(*) c FROM leads WHERE referred_by = ? GROUP BY source ORDER BY c DESC LIMIT 5');
$asg = $db->prepare('SELECT COUNT(*) FROM leads WHERE referred_by = ? AND assigned_to = ?');
$del = $db->prepare('SELECT full_name, deleted_at FROM deleted_users WHERE UPPER(referral_code) = UPPER(?)');
$frm = $db->prepare('SELECT f.name FROM lead_form_assignments a JOIN lead_forms f ON f.id = a.form_id WHERE a.member_id = ?');
$own = $db->prepare('SELECT name FROM lead_forms WHERE created_by = ?');

foreach ($names as $n) {
    $u->execute(['%' . $n . '%']);
    foreach ($u->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $code = (string) $row['referral_code'];
        echo "== {$row['full_name']} ({$row['role']}) code={$code} joined={$row['created_at']}\n";
        $cnt->execute([$row['created_at'], $code]);
        $c = $cnt->fetch(PDO::FETCH_ASSOC);
        echo "   leads with this code: {$c['c']}  first={$c['first_lead']}  last={$c['last_lead']}  before_join={$c['before_join']}\n";
        $asg->execute([$code, $row['id']]);
        echo '   of those assigned to this member: ' . (int) $asg->fetchColumn() . "\n";
        $src->execute([$code]);
        foreach ($src->fetchAll(PDO::FETCH_ASSOC) as $s) {
            echo "   source {$s['source']}: {$s['c']}\n";
        }
        try {
            $del->execute([$code]);
            foreach ($del->fetchAll(PDO::FETCH_ASSOC) as $d) {
                echo "   code was held by deleted member: {$d['full_name']} (deleted {$d['deleted_at']})\n";
            }
        } catch (Throwable $e) {
            echo '   deleted_users lookup error: ' . $e->getMessage() . "\n";
        }
        try {
            $frm->execute([$row['id']]);
            foreach ($frm->fetchAll(PDO::FETCH_COLUMN) as $f) {
                echo "   assigned form: {$f}\n";
            }
            $own->execute([$row['id']]);
            foreach ($own->fetchAll(PDO::FETCH_COLUMN) as $f) {
                echo "   created form: {$f}\n";
            }
        } catch (Throwable $e) {
            echo '   forms lookup error: ' . $e->getMessage() . "\n";
        }
    }
}
