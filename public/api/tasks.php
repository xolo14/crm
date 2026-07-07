<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $scope = tenantTaskListScopeSql($db, $tokenData);
    $stmt = $db->prepare("SELECT * FROM tasks WHERE 1=1" . $scope['sql'] . " ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_date ASC LIMIT 500");
    $stmt->execute($scope['params']);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);

    try {
        $stmt = $db->prepare('INSERT INTO tasks (id, title, description, due_date, priority, assigned_to, lead_id, contact_id, deal_id, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $input['title'],
            $input['description'] ?? null,
            $input['due_date'] ?? null,
            $input['priority'] ?? 'medium',
            $input['assigned_to'] ?? $userId,
            $input['lead_id'] ?? null,
            $input['contact_id'] ?? null,
            $input['deal_id'] ?? null,
            $userId,
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare('INSERT INTO tasks (id, title, description, due_date, priority, assigned_to, lead_id, contact_id, deal_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([
                $id,
                $input['title'],
                $input['description'] ?? null,
                $input['due_date'] ?? null,
                $input['priority'] ?? 'medium',
                $input['assigned_to'] ?? $userId,
                $input['lead_id'] ?? null,
                $input['contact_id'] ?? null,
                $input['deal_id'] ?? null,
                $userId,
            ]);
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Task created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    if (!taskFetchIfAccessible($db, $tokenData, $id)) {
        respond(['error' => 'Task not found'], 404);
    }

    $fields = [];
    $params = [];
    foreach (['title', 'description', 'due_date', 'priority', 'status', 'assigned_to'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $params[] = $id;
    $stmt = $db->prepare('UPDATE tasks SET ' . implode(', ', $fields) . ' WHERE id = ?');
    $stmt->execute($params);
    respond(['message' => 'Task updated']);
}

if ($method === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    $taskRow = taskFetchIfAccessible($db, $tokenData, $id);
    if (!$taskRow) {
        respond(['error' => 'Task not found'], 404);
    }
    trashArchivePayload($db, 'task', $taskRow, $tokenData);
    $stmt = $db->prepare('DELETE FROM tasks WHERE id = ?');
    $stmt->execute([$id]);
    respond(['message' => 'Task deleted']);
}

respond(['error' => 'Method not allowed'], 405);
