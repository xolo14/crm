<?php
/**
 * Permanently empty trash_items for the caller's scope.
 * Separate endpoint so Clear Trash works even if an old trash.php (restore-only) is still on the host.
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    respond(['ok' => true]);
}

if ($method !== 'POST' && $method !== 'DELETE') {
    respond(['error' => 'Method not allowed'], 405);
}

requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager']);

@set_time_limit(120);

if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
    if (!empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
        $where = 'org_id = ?';
        $params = [(string) $_GET['org_id']];
    } else {
        $where = '1=1';
        $params = [];
    }
} else {
    $org = orgFilter($tokenData);
    $where = '(' . $org['where'] . ')';
    $params = $org['params'];
}

$deleted = 0;
if (hierarchyRoleUsesDownlineScope($tokenData)) {
    $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
    $sel = $db->prepare("SELECT id, entity_type, entity_id, org_id, deleted_by, payload FROM trash_items WHERE $where");
    $sel->execute($params);
    $ids = [];
    while ($r = $sel->fetch(PDO::FETCH_ASSOC)) {
        if (is_array($r) && trashRowVisibleToDownline($r, $visibleIds)) {
            $ids[] = (string) $r['id'];
        }
    }
    if ($ids !== []) {
        $del = $db->prepare('DELETE FROM trash_items WHERE id = ?');
        foreach ($ids as $tid) {
            $del->execute([$tid]);
            $deleted += $del->rowCount();
        }
    }
} else {
    $stmt = $db->prepare("DELETE FROM trash_items WHERE $where");
    $stmt->execute($params);
    $deleted = (int) $stmt->rowCount();
}

syncpediaAuditLog($db, $tokenData, 'deleted', 'trash', null, "Cleared trash ({$deleted} item(s) permanently deleted)");
respond([
    'message' => 'Trash cleared',
    'deleted' => $deleted,
    'handler' => 'trash_clear',
]);
