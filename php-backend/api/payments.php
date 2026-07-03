<?php
/**
 * Student / batch payment records (CRM payments table — not Razorpay payment links).
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

if ($method === 'GET') {
    $where = '1=1';
    $params = [];

    $of = orgFilter($tokenData, 'p');
    $where .= ' AND (' . $of['where'] . ')';
    $params = array_merge($params, $of['params']);

    if (!empty($_GET['date_from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date_from'])) {
        $where .= ' AND (p.paid_date >= ? OR (p.paid_date IS NULL AND p.created_at >= ?))';
        $params[] = $_GET['date_from'];
        $params[] = $_GET['date_from'] . ' 00:00:00';
    }
    if (!empty($_GET['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date_to'])) {
        $where .= ' AND (p.paid_date <= ? OR (p.paid_date IS NULL AND p.created_at <= ?))';
        $params[] = $_GET['date_to'];
        $params[] = $_GET['date_to'] . ' 23:59:59';
    }
    if (!empty($_GET['status'])) {
        $where .= ' AND p.status = ?';
        $params[] = $_GET['status'];
    }

    if ($role === 'sales_representative') {
        $where .= ' AND p.student_id IN (
            SELECT s.id FROM students s
            LEFT JOIN leads l ON s.lead_id = l.id
            WHERE l.assigned_to = ? OR l.referred_by = ?
        )';
        $uid = (string) ($tokenData['user_id'] ?? '');
        $params[] = $uid;
        $params[] = $uid;
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $scope = hierarchyBuildInClause('l.assigned_to', $visibleIds);
        $where .= ' AND p.student_id IN (
            SELECT s.id FROM students s
            LEFT JOIN leads l ON s.lead_id = l.id
            WHERE 1=1' . $scope['sql'] . '
        )';
        $params = array_merge($params, $scope['params']);
    }

    $sql = "SELECT p.*, s.name AS student_name, b.name AS batch_name
            FROM payments p
            LEFT JOIN students s ON p.student_id = s.id
            LEFT JOIN batches b ON p.batch_id = b.id
            WHERE $where
            ORDER BY p.created_at DESC
            LIMIT 500";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager', 'finance']);
    $input = getInput();
    $id = generateUUID();
    $orgId = getOrgId($tokenData);
    if ($role === 'super_admin' && !empty($input['org_id'])) {
        $orgId = $input['org_id'];
    }

    $stmt = $db->prepare(
        'INSERT INTO payments (id, student_id, batch_id, amount, payment_type, payment_method, status, due_date, paid_date, notes, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    $stmt->execute([
        $id,
        $input['student_id'] ?? '',
        $input['batch_id'] ?? null,
        $input['amount'] ?? 0,
        $input['payment_type'] ?? 'full',
        $input['payment_method'] ?? null,
        $input['status'] ?? 'pending',
        $input['due_date'] ?? null,
        $input['paid_date'] ?? null,
        $input['notes'] ?? null,
        $orgId,
    ]);
    respond(['id' => $id, 'message' => 'Payment created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager', 'finance']);
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if ($id === '') {
        respond(['error' => 'ID required'], 400);
    }

    $fields = [];
    $params = [];
    foreach (['amount', 'payment_type', 'payment_method', 'status', 'due_date', 'paid_date', 'notes', 'batch_id'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if ($fields === []) {
        respond(['error' => 'Nothing to update'], 400);
    }
    $params[] = $id;
    $stmt = $db->prepare('UPDATE payments SET ' . implode(', ', $fields) . ' WHERE id = ?');
    $stmt->execute($params);
    respond(['message' => 'Payment updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if ($id === '') {
        respond(['error' => 'ID required'], 400);
    }
    $stmt = $db->prepare('DELETE FROM payments WHERE id = ?');
    $stmt->execute([$id]);
    respond(['message' => 'Payment deleted']);
}

respond(['error' => 'Method not allowed'], 405);
