<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $year = $_GET['year'] ?? date('Y');
    $org = orgFilter($tokenData, 'h', $db);
    $params = array_merge([$year], $org['params']);
    $stmt = $db->prepare("SELECT * FROM holidays h WHERE YEAR(h.date) = ? AND {$org['where']} ORDER BY h.date ASC");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);

    try {
        $stmt = $db->prepare("INSERT INTO holidays (id, name, date, type, notes, is_approved, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'],
            $input['date'],
            $input['type'] ?? 'public',
            $input['notes'] ?? null,
            in_array(syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')), ['admin', 'super_admin'], true) ? 1 : 0,
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare("INSERT INTO holidays (id, name, date, type, notes, is_approved) VALUES (?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $input['name'],
                $input['date'],
                $input['type'] ?? 'public',
                $input['notes'] ?? null,
                in_array(syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')), ['admin', 'super_admin'], true) ? 1 : 0,
            ]);
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Holiday created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $input = getInput();
    $fields = [];
    $params = [];

    foreach (['name', 'date', 'type', 'notes', 'is_approved'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }

    if (!empty($input['is_approved']) && $input['is_approved']) {
        $fields[] = 'approved_by = ?';
        $params[] = $userId;
        $fields[] = 'approved_at = NOW()';
    }

    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'h', $db);
    $params = array_merge($params, [$id], $orgAnd['params']);
    $stmt = $db->prepare('UPDATE holidays h SET ' . implode(', ', $fields) . ' WHERE h.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    if ($stmt->rowCount() === 0) {
        respond(['error' => 'Holiday not found'], 404);
    }
    respond(['message' => 'Holiday updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'h', $db);
    $params = array_merge([$id], $orgAnd['params']);
    $chk = $db->prepare('SELECT id FROM holidays h WHERE h.id = ?' . $orgAnd['sql'] . ' LIMIT 1');
    $chk->execute($params);
    if (!$chk->fetch()) {
        respond(['error' => 'Holiday not found'], 404);
    }

    trashArchiveRow($db, 'holiday', 'holidays', $id, $tokenData);
    $stmt = $db->prepare('DELETE FROM holidays h WHERE h.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    respond(['message' => 'Holiday deleted']);
}

respond(['error' => 'Method not allowed'], 405);
