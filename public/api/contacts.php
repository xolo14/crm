<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

if ($method === 'GET') {
    $where = "1=1";
    $params = [];

    if ($role === 'sales_representative') {
        $where .= " AND owner_id = ?";
        $params[] = $userId;
    }

    $stmt = $db->prepare("SELECT * FROM contacts WHERE $where ORDER BY created_at DESC LIMIT 500");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();

    $stmt = $db->prepare("INSERT INTO contacts (id, name, email, phone, company, position, lead_id, owner_id, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id, $input['name'], $input['email'] ?? null, $input['phone'] ?? null,
        $input['company'] ?? null, $input['position'] ?? null, $input['lead_id'] ?? null,
        $input['owner_id'] ?? $userId, $input['notes'] ?? null, json_encode($input['tags'] ?? []),
    ]);
    respond(['id' => $id, 'message' => 'Contact created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $fields = [];
    $params = [];
    foreach (['name', 'email', 'phone', 'company', 'position', 'notes'] as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE contacts SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Contact updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);
    trashArchiveRow($db, 'contact', 'contacts', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM contacts WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Contact deleted']);
}
