<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
requireRole($tokenData, ['admin']);

$method = $_SERVER['REQUEST_METHOD'];

// Team management
if ($method === 'GET') {
    $stmt = $db->prepare("SELECT id, email, full_name, phone, role, is_active, created_at FROM users ORDER BY created_at DESC");
    $stmt->execute();
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $fields = [];
    $params = [];
    foreach (['role', 'is_active', 'full_name'] as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE users SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'User updated']);
}

// Pipeline stages
if ($method === 'POST' && isset($_GET['action']) && $_GET['action'] === 'stages') {
    $input = getInput();
    $stmt = $db->prepare("SELECT * FROM pipeline_stages ORDER BY position");
    $stmt->execute();
    respond(['data' => $stmt->fetchAll()]);
}

respond(['error' => 'Invalid request'], 400);
