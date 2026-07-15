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
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        respond(['error' => 'Title is required'], 400);
    }
    $assignedTo = trim((string) ($input['assigned_to'] ?? ''));
    if ($assignedTo === '') {
        $assignedTo = (string) $userId;
    }

    try {
        $stmt = $db->prepare('INSERT INTO tasks (id, title, description, due_date, priority, assigned_to, lead_id, contact_id, deal_id, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $title,
            $input['description'] ?? null,
            $input['due_date'] ?? null,
            $input['priority'] ?? 'medium',
            $assignedTo,
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
                $title,
                $input['description'] ?? null,
                $input['due_date'] ?? null,
                $input['priority'] ?? 'medium',
                $assignedTo,
                $input['lead_id'] ?? null,
                $input['contact_id'] ?? null,
                $input['deal_id'] ?? null,
                $userId,
            ]);
        } else {
            throw $e;
        }
    }

    syncpediaNotifyTaskAssignee($db, $assignedTo, (string) $userId, $title, $orgId);
    syncpediaAuditLog($db, $tokenData, 'created', 'task', $id, 'Created task: ' . $title . ' → ' . $assignedTo);

    respond(['id' => $id, 'message' => 'Task created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    $existing = taskFetchIfAccessible($db, $tokenData, $id);
    if (!$existing) {
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

    if (array_key_exists('assigned_to', $input)) {
        $newAssignee = trim((string) ($input['assigned_to'] ?? ''));
        $oldAssignee = trim((string) ($existing['assigned_to'] ?? ''));
        if ($newAssignee !== '' && $newAssignee !== $oldAssignee) {
            $taskTitle = trim((string) ($input['title'] ?? $existing['title'] ?? 'Untitled'));
            $orgId = $existing['org_id'] ?? resolveWriteOrgId($db, $tokenData);
            syncpediaNotifyTaskAssignee($db, $newAssignee, (string) $userId, $taskTitle, $orgId ? (string) $orgId : null);
        }
    }

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
