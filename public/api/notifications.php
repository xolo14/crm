<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $stmt = $db->prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200");
    $stmt->execute([$userId]);
    respond($stmt->fetchAll());
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();
    $targetUserId = trim((string) ($input['user_id'] ?? $userId));
    $orgId = resolveWriteOrgId($db, $tokenData);

    // Only admins may create notifications for other users in the same org
    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($targetUserId !== $userId && !in_array($effRole, ['admin', 'super_admin', 'manager', 'org'], true)) {
        respond(['error' => 'Forbidden'], 403);
    }
    if ($targetUserId !== $userId && $orgId) {
        $chk = $db->prepare('SELECT id FROM users WHERE id = ? AND org_id = ? LIMIT 1');
        $chk->execute([$targetUserId, $orgId]);
        if (!$chk->fetch()) {
            respond(['error' => 'User not in your organization'], 403);
        }
    }

    try {
        $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $targetUserId,
            $input['title'],
            $input['message'] ?? null,
            $input['type'] ?? 'info',
            $input['link'] ?? null,
            $orgId,
        ]);
    } catch (Throwable $e) {
        $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $targetUserId,
            $input['title'],
            $input['message'] ?? null,
            $input['type'] ?? 'info',
            $input['link'] ?? null,
        ]);
    }

    respond(['id' => $id, 'message' => 'Notification created'], 201);
}

if ($method === 'PUT') {
    $action = $_GET['action'] ?? '';

    if ($action === 'mark_all_read') {
        $input = getInput();
        $ids = $input['ids'] ?? [];
        if (empty($ids)) respond(['error' => 'No IDs provided'], 400);

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $params = array_merge($ids, [$userId]);
        $stmt = $db->prepare("UPDATE notifications SET is_read = 1 WHERE id IN ($placeholders) AND user_id = ?");
        $stmt->execute($params);
        respond(['message' => count($ids) . ' notifications marked as read']);
    }

    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $input = getInput();
    $stmt = $db->prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    respond(['message' => 'Notification marked as read']);
}

if ($method === 'DELETE') {
    $action = $_GET['action'] ?? '';

    if ($action === 'bulk_delete') {
        $input = getInput();
        $ids = $input['ids'] ?? [];
        if (empty($ids)) respond(['error' => 'No IDs provided'], 400);

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $params = array_merge($ids, [$userId]);
        $stmt = $db->prepare("DELETE FROM notifications WHERE id IN ($placeholders) AND user_id = ?");
        $stmt->execute($params);
        respond(['message' => count($ids) . ' notifications deleted']);
    }

    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $stmt = $db->prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    respond(['message' => 'Notification deleted']);
}
