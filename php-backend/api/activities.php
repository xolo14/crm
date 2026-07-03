<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if (in_array($role, ['admin', 'super_admin', 'manager'], true)) {
        $stmt = $db->prepare("SELECT * FROM activities ORDER BY occurred_at DESC LIMIT 100");
        $stmt->execute();
    } else {
        $stmt = $db->prepare("SELECT * FROM activities WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100");
        $stmt->execute([$userId]);
    }
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();

    $stmt = $db->prepare("INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id, $input['type'], $input['subject'], $input['description'] ?? null,
        $input['lead_id'] ?? null, $input['contact_id'] ?? null, $input['deal_id'] ?? null,
        $userId, $input['duration_minutes'] ?? null,
    ]);
    respond(['id' => $id, 'message' => 'Activity logged'], 201);
}

respond(['error' => 'Method not allowed'], 405);
