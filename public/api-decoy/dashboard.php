<?php
/**
 * DECOY-ONLY dashboard stats.
 */
require_once __DIR__ . '/helpers.php';
decoyCors();

$db = (new DecoyDatabase())->getConnection();
decoyEnsureSchema($db);
$user = decoyRequireAuth($db);

decoyAlert('dashboard_view', [
    'decoy_user' => (string) ($user['email'] ?? ''),
    'session_id' => null,
]);

$total = (int) $db->query('SELECT COUNT(*) FROM decoy_leads')->fetchColumn();
$new = (int) $db->query("SELECT COUNT(*) FROM decoy_leads WHERE status = 'new'")->fetchColumn();
$pipeline = (int) $db->query(
    "SELECT COUNT(*) FROM decoy_leads WHERE status IN ('contacted','qualified','interested','demo_scheduled')"
)->fetchColumn();
$enrolled = (int) $db->query("SELECT COUNT(*) FROM decoy_leads WHERE status IN ('enrolled','converted')")->fetchColumn();
$lost = (int) $db->query("SELECT COUNT(*) FROM decoy_leads WHERE status IN ('lost','not_interested')")->fetchColumn();

$bySource = [];
$st = $db->query('SELECT source, COUNT(*) AS c FROM decoy_leads GROUP BY source ORDER BY c DESC LIMIT 12');
while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
    $bySource[] = ['source' => (string) ($r['source'] ?? ''), 'count' => (int) ($r['c'] ?? 0)];
}

decoyRespond([
    'data' => [
        'total' => $total,
        'new' => $new,
        'pipeline' => $pipeline,
        'enrolled' => $enrolled,
        'lost' => $lost,
        'by_source' => $bySource,
        'user' => [
            'full_name' => (string) ($user['full_name'] ?? ''),
            'email' => (string) ($user['email'] ?? ''),
        ],
    ],
]);
