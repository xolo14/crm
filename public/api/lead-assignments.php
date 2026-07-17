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

        $where = "(l.assigned_to = ? OR EXISTS (SELECT 1 FROM lead_assignments la_own WHERE la_own.lead_id = l.id AND la_own.user_id = ?))";
        $params = [$userId, $userId];

        // Assigned leads endpoint is user-scoped (primary assignee OR multi-assign row).
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
        syncpediaAssertLeadInScope($db, $tokenData, $leadId);
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
    } elseif (tenantIsMasterView($tokenData)) {
        $stmt = $db->prepare("
            SELECT la.*, u.full_name as user_name, l.name as lead_name
            FROM lead_assignments la
            LEFT JOIN users u ON la.user_id = u.id
            LEFT JOIN leads l ON la.lead_id = l.id
            ORDER BY la.created_at DESC LIMIT 500
        ");
        $stmt->execute();
    } else {
        $orgId = resolveCreatorOrgId($db, $tokenData);
        $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
        if ($orgId && in_array($effRole, ['admin', 'org', 'finance', 'super_admin', 'manager'], true)) {
            $stmt = $db->prepare("
                SELECT la.*, u.full_name as user_name, l.name as lead_name
                FROM lead_assignments la
                LEFT JOIN users u ON la.user_id = u.id
                LEFT JOIN leads l ON la.lead_id = l.id
                WHERE l.org_id = ?
                ORDER BY la.created_at DESC LIMIT 500
            ");
            $stmt->execute([$orgId]);
        } else {
            respond(['data' => []]);
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
        syncpediaAssertUserInCallerOrg($db, $tokenData, $assignTo);

        $assignStmt = $db->prepare("INSERT INTO lead_assignments (id, lead_id, user_id) VALUES (?, ?, ?)");
        $existsStmt = $db->prepare('SELECT id FROM lead_assignments WHERE lead_id = ? AND user_id = ? LIMIT 1');
        $updateStmt = $db->prepare("UPDATE leads SET assigned_to = ? WHERE id = ?");

        foreach ($leadIds as $leadId) {
            syncpediaAssertLeadInScope($db, $tokenData, (string) $leadId);
            $existsStmt->execute([(string) $leadId, $assignTo]);
            if (!$existsStmt->fetch()) {
                try {
                    $assignStmt->execute([generateUUID(), $leadId, $assignTo]);
                } catch (Throwable $e) {
                    if (!isMysqlDuplicateKey($e)) {
                        throw $e;
                    }
                }
            }
            $updateStmt->execute([$assignTo, $leadId]);
        }

        respond(['message' => count($leadIds) . ' leads assigned'], 201);
    }

    $leadId = trim((string) ($input['lead_id'] ?? ''));
    $assignTo = trim((string) ($input['user_id'] ?? ''));
    if ($leadId === '' || $assignTo === '') {
        respond(['error' => 'lead_id and user_id required'], 400);
    }
    syncpediaAssertLeadInScope($db, $tokenData, $leadId);
    syncpediaAssertUserInCallerOrg($db, $tokenData, $assignTo);

    $id = generateUUID();
    $stmt = $db->prepare("INSERT INTO lead_assignments (id, lead_id, user_id) VALUES (?, ?, ?)");
    $stmt->execute([$id, $leadId, $assignTo]);

    $db->prepare("UPDATE leads SET assigned_to = ? WHERE id = ?")->execute([$assignTo, $leadId]);

    respond(['id' => $id, 'message' => 'Lead assigned'], 201);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $chk = $db->prepare('SELECT la.id, la.lead_id, la.user_id FROM lead_assignments la WHERE la.id = ? LIMIT 1');
    $chk->execute([$id]);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Assignment not found'], 404);
    }
    syncpediaAssertLeadInScope($db, $tokenData, (string) ($row['lead_id'] ?? ''));

    trashArchiveRow($db, 'lead_assignment', 'lead_assignments', $id, $tokenData);
    $leadIdForSync = (string) ($row['lead_id'] ?? '');
    $removedUserId = trim((string) ($row['user_id'] ?? ''));

    $stmt = $db->prepare("DELETE FROM lead_assignments WHERE id = ?");
    $stmt->execute([$id]);

    // Keep leads.assigned_to aligned with remaining assignments.
    if ($leadIdForSync !== '') {
        $leadSt = $db->prepare('SELECT assigned_to FROM leads WHERE id = ? LIMIT 1');
        $leadSt->execute([$leadIdForSync]);
        $leadRow = $leadSt->fetch(PDO::FETCH_ASSOC);
        $primary = is_array($leadRow) ? trim((string) ($leadRow['assigned_to'] ?? '')) : '';

        $next = $db->prepare('SELECT user_id FROM lead_assignments WHERE lead_id = ? ORDER BY created_at ASC LIMIT 1');
        $next->execute([$leadIdForSync]);
        $nextUser = $next->fetchColumn();
        if ($nextUser) {
            if ($primary === '' || ($removedUserId !== '' && $primary === $removedUserId)) {
                $db->prepare('UPDATE leads SET assigned_to = ? WHERE id = ?')->execute([(string) $nextUser, $leadIdForSync]);
            }
        } elseif ($primary === '' || $primary === $removedUserId) {
            $db->prepare('UPDATE leads SET assigned_to = NULL WHERE id = ?')->execute([$leadIdForSync]);
        }
    }
    respond(['message' => 'Assignment removed']);
}

respond(['error' => 'Method not allowed'], 405);
