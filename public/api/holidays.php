<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $year = $_GET['year'] ?? date('Y');
    $stmt = $db->prepare("SELECT * FROM holidays WHERE YEAR(date) = ? ORDER BY date ASC");
    $stmt->execute([$year]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $id = generateUUID();

    $stmt = $db->prepare("INSERT INTO holidays (id, name, date, type, notes, is_approved) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id,
        $input['name'],
        $input['date'],
        $input['type'] ?? 'public',
        $input['notes'] ?? null,
        in_array($tokenData['role'], ['admin', 'super_admin']) ? 1 : 0,
    ]);
    respond(['id' => $id, 'message' => 'Holiday created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

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
        $fields[] = "approved_by = ?";
        $params[] = $userId;
        $fields[] = "approved_at = NOW()";
    }

    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE holidays SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Holiday updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    trashArchiveRow($db, 'holiday', 'holidays', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM holidays WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Holiday deleted']);
}

respond(['error' => 'Method not allowed'], 405);
