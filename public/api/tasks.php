<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $role = $tokenData['role'] ?? '';
    $effRole = syncpediaNormalizeRoleKey((string) $role);
    if ($effRole === 'super_admin') {
        $stmt = $db->prepare("SELECT * FROM tasks ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
        $stmt->execute();
    } elseif (in_array($effRole, ['admin', 'org'], true)) {
        $orgId = getOrgId($tokenData);
        if ($orgId) {
            $stmt = $db->prepare("SELECT * FROM tasks WHERE (org_id = ? OR assigned_to IN (SELECT id FROM users WHERE org_id = ?) OR created_by IN (SELECT id FROM users WHERE org_id = ?)) ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
            $stmt->execute([$orgId, $orgId, $orgId]);
        } else {
            $stmt = $db->prepare("SELECT * FROM tasks ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
            $stmt->execute();
        }
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $scope = hierarchyTaskListScopeSql($visibleIds);
        $stmt = $db->prepare("SELECT * FROM tasks WHERE 1=1" . $scope['sql'] . " ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
        $stmt->execute($scope['params']);
    } else {
        $stmt = $db->prepare("SELECT * FROM tasks WHERE assigned_to = ? OR created_by = ? ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
        $stmt->execute([$userId, $userId]);
    }
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();

    $stmt = $db->prepare("INSERT INTO tasks (id, title, description, due_date, priority, assigned_to, lead_id, contact_id, deal_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id, $input['title'], $input['description'] ?? null, $input['due_date'] ?? null,
        $input['priority'] ?? 'medium', $input['assigned_to'] ?? $userId,
        $input['lead_id'] ?? null, $input['contact_id'] ?? null, $input['deal_id'] ?? null, $userId,
    ]);
    respond(['id' => $id, 'message' => 'Task created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $fields = [];
    $params = [];
    foreach (['title', 'description', 'due_date', 'priority', 'status', 'assigned_to'] as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE tasks SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Task updated']);
}

if ($method === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);
    $sel = $db->prepare('SELECT * FROM tasks WHERE id = ? AND (assigned_to = ? OR created_by = ?) LIMIT 1');
    $sel->execute([$id, $userId, $userId]);
    $taskRow = $sel->fetch(PDO::FETCH_ASSOC);
    if ($taskRow) {
        trashArchivePayload($db, 'task', $taskRow, $tokenData);
    }
    $stmt = $db->prepare("DELETE FROM tasks WHERE id = ? AND (assigned_to = ? OR created_by = ?)");
    $stmt->execute([$id, $userId, $userId]);
    respond(['message' => 'Task deleted']);
}
