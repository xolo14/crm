<?php
/** Real audit trail — replaces the mock data previously shown on Settings → Audit Logs. */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

requireRole($tokenData, ['admin', 'super_admin', 'org']);
ensureAuditLogTable($db);

$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

if (($_GET['action'] ?? '') === 'users') {
    $orgId = $tokenData['org_id'] ?? null;
    if ($role === 'super_admin' && empty($orgId)) {
        $stmt = $db->query('SELECT DISTINCT user_id, user_name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name LIMIT 200');
    } else {
        $stmt = $db->prepare('SELECT DISTINCT user_id, user_name FROM audit_log WHERE org_id = ? AND user_id IS NOT NULL ORDER BY user_name LIMIT 200');
        $stmt->execute([$orgId]);
    }
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

$where = [];
$params = [];

$orgId = $tokenData['org_id'] ?? null;
if (!($role === 'super_admin' && !empty($_GET['all']))) {
    if ($orgId) {
        $where[] = 'org_id = ?';
        $params[] = $orgId;
    } elseif ($role !== 'super_admin') {
        respond(['data' => [], 'total' => 0]);
    }
}

if (!empty($_GET['user_id'])) {
    $where[] = 'user_id = ?';
    $params[] = (string) $_GET['user_id'];
}
if (!empty($_GET['action_type'])) {
    $where[] = 'action = ?';
    $params[] = (string) $_GET['action_type'];
}
if (!empty($_GET['date'])) {
    $where[] = 'DATE(created_at) = ?';
    $params[] = (string) $_GET['date'];
}
if (!empty($_GET['search'])) {
    $where[] = '(user_name LIKE ? OR details LIKE ? OR entity_type LIKE ? OR entity_id LIKE ?)';
    $s = '%' . $_GET['search'] . '%';
    $params[] = $s;
    $params[] = $s;
    $params[] = $s;
    $params[] = $s;
}

$limit = max(1, min(200, (int) ($_GET['limit'] ?? 100)));

$sql = 'SELECT id, org_id, user_id, user_name, action, entity_type, entity_id, details, ip_address, created_at FROM audit_log';
if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY created_at DESC LIMIT ' . $limit;

$stmt = $db->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

respond(['data' => $rows, 'total' => count($rows)]);
