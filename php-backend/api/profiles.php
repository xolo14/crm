<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

if ($method === 'GET') {
    // If requesting dashboard data
    if (!empty($_GET['action']) && $_GET['action'] === 'dashboard') {
        $result = [];

        $orgId = tenantListOrgId($db, $tokenData);
        $useOrg = $orgId !== null && $orgId !== '';
        $normRole = syncpediaNormalizeRoleKey((string) ($role ?? ''));
        $managerVisibleIds = ($normRole === 'manager') ? hierarchyGetVisibleUserIds($db, $tokenData) : [];

        // Leads (tenant + hierarchy)
        $leadScope = tenantLeadsScopeSql($db, $tokenData, '');
        $where = '1=1' . $leadScope['sql'];
        $params = $leadScope['params'];
        $stmt = $db->prepare("SELECT id, status, source, referred_by, assigned_to, created_at FROM leads WHERE $where ORDER BY created_at DESC LIMIT 1000");
        $stmt->execute($params);
        $result['leads'] = $stmt->fetchAll();

        // Counts — managers see students tied to their downline leads / mentors
        if ($normRole === 'manager' && !empty($managerVisibleIds)) {
            $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
            $orgClause = $useOrg ? ' AND (s.org_id = ? OR l.org_id = ?)' : ' AND (s.org_id IS NULL OR l.org_id IS NULL)';
            $stmt = $db->prepare("
                SELECT COUNT(*) as total, SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) as active
                FROM students s
                LEFT JOIN leads l ON l.id = s.lead_id
                WHERE (
                    (l.id IS NOT NULL AND (l.assigned_to IN ($inUsers) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ($inUsers))))
                    OR (l.id IS NULL AND (s.mentor_id IN ($inUsers) OR s.user_id IN ($inUsers)))
                ){$orgClause}
            ");
            $params = array_merge($managerVisibleIds, $managerVisibleIds, $managerVisibleIds, $managerVisibleIds);
            if ($useOrg) {
                $params[] = $orgId;
                $params[] = $orgId;
            }
            $stmt->execute($params);
        } elseif ($useOrg) {
            $tenant = orgFilterStudentsTenantSql($orgId);
            $stmt = $db->prepare("
                SELECT COUNT(*) as total, SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) as active
                FROM students s
                LEFT JOIN leads l ON l.id = s.lead_id
                LEFT JOIN leads l2 ON (
                    (s.lead_id IS NULL OR l.id IS NULL)
                    AND s.email IS NOT NULL AND TRIM(s.email) <> ''
                    AND l2.id = (
                        SELECT le.id FROM leads le
                        WHERE le.email = s.email AND TRIM(le.email) <> ''
                        ORDER BY le.created_at DESC
                        LIMIT 1
                    )
                )
                WHERE 1=1{$tenant['sql']}
            ");
            $stmt->execute($tenant['params']);
        } elseif (tenantIsMasterView($tokenData)) {
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM students");
            $stmt->execute();
        } else {
            $students = ['total' => 0, 'active' => 0];
            $stmt = null;
        }
        if ($stmt) {
            $students = $stmt->fetch();
        }
        $result['students_count'] = (int)$students['total'];
        $result['active_students'] = (int)$students['active'];

        if ($useOrg) {
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM courses WHERE org_id = ?");
            $stmt->execute([$orgId]);
        } elseif (tenantIsMasterView($tokenData)) {
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM courses");
            $stmt->execute();
        } else {
            $courses = ['total' => 0, 'active' => 0];
            $stmt = null;
        }
        if ($stmt) {
            $courses = $stmt->fetch();
        }
        $result['courses_count'] = (int)$courses['total'];
        $result['active_courses'] = (int)$courses['active'];

        if ($useOrg) {
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('active','upcoming') THEN 1 ELSE 0 END) as active FROM batches WHERE org_id = ?");
            $stmt->execute([$orgId]);
        } elseif (tenantIsMasterView($tokenData)) {
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('active','upcoming') THEN 1 ELSE 0 END) as active FROM batches");
            $stmt->execute();
        } else {
            $batches = ['total' => 0, 'active' => 0];
            $stmt = null;
        }
        if ($stmt) {
            $batches = $stmt->fetch();
        }
        $result['batches_count'] = (int)$batches['total'];
        $result['active_batches'] = (int)$batches['active'];

        if ($normRole === 'manager' && !empty($managerVisibleIds)) {
            $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
            $orgClause = $useOrg ? ' AND s.org_id = ? AND (p.org_id IS NULL OR p.org_id = s.org_id)' : ' AND (s.org_id IS NULL) AND (p.org_id IS NULL OR p.org_id = s.org_id)';
            $stmt = $db->prepare("
                SELECT COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) as paid,
                    COALESCE(SUM(CASE WHEN p.status='pending' THEN p.amount ELSE 0 END),0) as pending
                FROM payments p
                INNER JOIN students s ON s.id = p.student_id
                LEFT JOIN leads l ON l.id = s.lead_id
                WHERE (
                    (l.id IS NOT NULL AND (l.assigned_to IN ($inUsers) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ($inUsers))))
                    OR (l.id IS NULL AND (s.mentor_id IN ($inUsers) OR s.user_id IN ($inUsers)))
                ){$orgClause}
            ");
            $params = array_merge($managerVisibleIds, $managerVisibleIds, $managerVisibleIds, $managerVisibleIds);
            if ($useOrg) {
                $params[] = $orgId;
            }
            $stmt->execute($params);
        } elseif ($useOrg) {
            $stmt = $db->prepare("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid, COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) as pending FROM payments WHERE org_id = ?");
            $stmt->execute([$orgId]);
        } elseif (tenantIsMasterView($tokenData)) {
            $stmt = $db->prepare("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid, COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) as pending FROM payments");
            $stmt->execute();
        } else {
            $payments = ['paid' => 0, 'pending' => 0];
            $stmt = null;
        }
        if ($stmt) {
            $payments = $stmt->fetch();
        }
        $result['total_revenue'] = (float)$payments['paid'];
        $result['pending_revenue'] = (float)$payments['pending'];

        // Users with referral codes (mapped as profiles) — same org as dashboard
        if ($normRole === 'manager' && !empty($managerVisibleIds)) {
            $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
            if ($useOrg) {
                $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users WHERE referral_code IS NOT NULL AND org_id = ? AND id IN ($inUsers)");
                $stmt->execute(array_merge([$orgId], $managerVisibleIds));
            } else {
                $result['profiles'] = [];
                $stmt = null;
            }
        } elseif ($useOrg) {
            $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users WHERE referral_code IS NOT NULL AND org_id = ?");
            $stmt->execute([$orgId]);
        } elseif (tenantIsMasterView($tokenData)) {
            $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users WHERE referral_code IS NOT NULL");
            $stmt->execute();
        } else {
            $result['profiles'] = [];
            $stmt = null;
        }
        if ($stmt) {
            $result['profiles'] = $stmt->fetchAll();
        }

        respond($result);
    }

    // List profiles for team/settings - scoped by org & hierarchy for non-super-admin users
    $orgScope = orgFilter($tokenData, 'u');
    $where = $orgScope['where'];
    $params = $orgScope['params'];

    if ($role !== 'super_admin') {
        $where .= " AND u.role <> 'super_admin'";
        if (hierarchyRoleUsesDownlineScope($tokenData)) {
            $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
            $scope = hierarchyBuildInClause('u.id', $visibleIds);
            $where .= $scope['sql'];
            $params = array_merge($params, $scope['params']);
        }
    }

    $stmt = $db->prepare("SELECT u.id as user_id, u.id, u.full_name, u.email, u.phone, u.avatar_url, u.referral_code, u.role, u.created_at, u.updated_at FROM users u WHERE $where ORDER BY u.full_name");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    // Users can update own profile; admins can update users in their org only
    if ($id !== $userId) {
        if (!in_array($role, ['admin', 'super_admin', 'org'], true)) {
            respond(['error' => 'Forbidden'], 403);
        }
        syncpediaAssertTargetUserEditable($db, $tokenData, $id);
    }

    $fields = [];
    $params = [];
    foreach (['full_name', 'phone', 'avatar_url'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE users SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Profile updated']);
}
