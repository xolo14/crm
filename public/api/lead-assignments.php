<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    if ($action === 'my_leads') {
        $status = trim((string)($_GET['status'] ?? ''));
        $search = trim((string)($_GET['search'] ?? ''));

        $where = "l.assigned_to = ?";
        $params = [$userId];

        // Assigned leads endpoint is user-scoped (assigned_to = current user).
        // Do not apply org filter here; legacy records can have null/mismatched org_id
        // while still being legitimately assigned and visible to the assignee.

        if ($status !== '' && strtolower($status) !== 'all') {
            $where .= " AND l.status = ?";
            $params[] = $status;
        }
        if ($search !== '') {
            $where .= " AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.company LIKE ? OR l.college LIKE ?)";
            $like = '%' . $search . '%';
            array_push($params, $like, $like, $like, $like, $like);
        }

        $stmt = $db->prepare("
            SELECT l.*, la.created_at AS assigned_at, u.full_name AS assigned_user_name
            FROM leads l
            LEFT JOIN (
                SELECT lead_id, MAX(created_at) AS latest_assigned_at
                FROM lead_assignments
                WHERE user_id = ?
                GROUP BY lead_id
            ) mx ON mx.lead_id = l.id
            LEFT JOIN lead_assignments la
                ON la.lead_id = mx.lead_id
               AND la.created_at = mx.latest_assigned_at
               AND la.user_id = ?
            LEFT JOIN users u ON u.id = la.user_id
            WHERE $where
            ORDER BY COALESCE(la.created_at, l.created_at) DESC
            LIMIT 500
        ");
        $stmt->execute(array_merge([$userId, $userId], $params));
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($action === 'my_form_leads') {
        $status = trim((string)($_GET['status'] ?? ''));
        $search = trim((string)($_GET['search'] ?? ''));

        $where = "l.referred_by = (SELECT referral_code FROM users WHERE id = ? LIMIT 1)";
        $params = [$userId];

        $org = orgFilter($tokenData, 'l');
        if (($org['where'] ?? '') !== '1=1') {
            $where .= " AND (" . $org['where'] . ")";
            $params = array_merge($params, $org['params'] ?? []);
        }
        if ($status !== '' && strtolower($status) !== 'all') {
            $where .= " AND l.status = ?";
            $params[] = $status;
        }
        if ($search !== '') {
            $where .= " AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.company LIKE ? OR l.college LIKE ?)";
            $like = '%' . $search . '%';
            array_push($params, $like, $like, $like, $like, $like);
        }

        $stmt = $db->prepare("
            SELECT l.*
            FROM leads l
            WHERE $where
            ORDER BY l.created_at DESC
            LIMIT 500
        ");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }

    $leadId = $_GET['lead_id'] ?? '';
    if ($leadId) {
        $stmt = $db->prepare("
            SELECT la.*, u.full_name as user_name, u.email as user_email 
            FROM lead_assignments la 
            LEFT JOIN users u ON la.user_id = u.id 
            WHERE la.lead_id = ? 
            ORDER BY la.created_at DESC
        ");
        $stmt->execute([$leadId]);
    } elseif (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $stmt = $db->prepare("
            SELECT la.*, u.full_name as user_name, l.name as lead_name
            FROM lead_assignments la
            LEFT JOIN users u ON la.user_id = u.id
            LEFT JOIN leads l ON la.lead_id = l.id
            WHERE la.user_id = ?
               OR l.assigned_to = ?
               OR l.created_by = ?
               OR l.referred_by = (SELECT referral_code FROM users WHERE id = ? LIMIT 1)
            ORDER BY la.created_at DESC LIMIT 500
        ");
        $stmt->execute([$userId, $userId, $userId, $userId]);
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $scope = hierarchyLeadAssignmentDownlineScopeSql(hierarchyGetVisibleUserIds($db, $tokenData));
        if ($scope['sql'] === ' AND 1=0') {
            respond(['data' => []]);
        }
        $stmt = $db->prepare("
            SELECT la.*, u.full_name as user_name, l.name as lead_name
            FROM lead_assignments la
            LEFT JOIN users u ON la.user_id = u.id
            LEFT JOIN leads l ON la.lead_id = l.id
            WHERE 1=1{$scope['sql']}
            ORDER BY la.created_at DESC LIMIT 500
        ");
        $stmt->execute($scope['params']);
    } else {
        $orgId = getOrgId($tokenData);
        $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
        if ($orgId && in_array($effRole, ['admin', 'org', 'finance'], true)) {
            $stmt = $db->prepare("
                SELECT la.*, u.full_name as user_name, l.name as lead_name
                FROM lead_assignments la
                LEFT JOIN users u ON la.user_id = u.id
                LEFT JOIN leads l ON la.lead_id = l.id
                WHERE l.org_id = ? OR l.org_id IS NULL
                ORDER BY la.created_at DESC LIMIT 500
            ");
            $stmt->execute([$orgId]);
        } else {
            $stmt = $db->prepare("
                SELECT la.*, u.full_name as user_name, l.name as lead_name 
                FROM lead_assignments la 
                LEFT JOIN users u ON la.user_id = u.id 
                LEFT JOIN leads l ON la.lead_id = l.id 
                ORDER BY la.created_at DESC LIMIT 500
            ");
            $stmt->execute();
        }
    }
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();

    $action = $_GET['action'] ?? 'assign';

    if ($action === 'bulk') {
        $leadIds = $input['lead_ids'] ?? [];
        $assignTo = $input['user_id'] ?? '';
        if (empty($leadIds) || !$assignTo) respond(['error' => 'lead_ids and user_id required'], 400);

        $assignStmt = $db->prepare("INSERT INTO lead_assignments (id, lead_id, user_id) VALUES (?, ?, ?)");
        $updateStmt = $db->prepare("UPDATE leads SET assigned_to = ? WHERE id = ?");

        foreach ($leadIds as $leadId) {
            $assignStmt->execute([generateUUID(), $leadId, $assignTo]);
            $updateStmt->execute([$assignTo, $leadId]);
        }

        respond(['message' => count($leadIds) . ' leads assigned'], 201);
    }

    $id = generateUUID();
    $stmt = $db->prepare("INSERT INTO lead_assignments (id, lead_id, user_id) VALUES (?, ?, ?)");
    $stmt->execute([$id, $input['lead_id'], $input['user_id']]);

    $db->prepare("UPDATE leads SET assigned_to = ? WHERE id = ?")->execute([$input['user_id'], $input['lead_id']]);

    respond(['id' => $id, 'message' => 'Lead assigned'], 201);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    trashArchiveRow($db, 'lead_assignment', 'lead_assignments', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM lead_assignments WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Assignment removed']);
}

respond(['error' => 'Method not allowed'], 405);
