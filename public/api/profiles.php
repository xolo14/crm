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
        @set_time_limit(120);
        $result = [
            'leads_total' => 0,
            'leads_by_status' => [],
            'leads' => [],
            'students_count' => 0,
            'active_students' => 0,
            'courses_count' => 0,
            'active_courses' => 0,
            'batches_count' => 0,
            'active_batches' => 0,
            'total_revenue' => 0.0,
            'pending_revenue' => 0.0,
            'profiles' => [],
        ];

        $orgId = tenantListOrgId($db, $tokenData);
        $useOrg = $orgId !== null && $orgId !== '';
        $normRole = syncpediaNormalizeRoleKey((string) ($role ?? ''));
        $managerVisibleIds = ($normRole === 'manager') ? hierarchyGetVisibleUserIds($db, $tokenData) : [];

        // Leads — accurate counts + capped sample for widgets (avoid 100k row timeouts)
        try {
            $leadScope = tenantLeadsScopeSql($db, $tokenData, '');
            $where = '1=1' . $leadScope['sql'];
            $params = $leadScope['params'];

            $countStmt = $db->prepare("SELECT COUNT(*) FROM leads WHERE $where");
            $countStmt->execute($params);
            $result['leads_total'] = (int) $countStmt->fetchColumn();

            $statusStmt = $db->prepare("SELECT status, COUNT(*) AS cnt FROM leads WHERE $where GROUP BY status");
            $statusStmt->execute($params);
            $byStatus = [];
            while ($sr = $statusStmt->fetch(PDO::FETCH_ASSOC)) {
                $byStatus[(string) ($sr['status'] ?? '')] = (int) ($sr['cnt'] ?? 0);
            }
            $result['leads_by_status'] = $byStatus;

            $stmt = $db->prepare("SELECT id, name, email, phone, status, source, referred_by, assigned_to, next_follow_up, created_at FROM leads WHERE $where ORDER BY created_at DESC LIMIT 5000");
            $stmt->execute($params);
            $result['leads'] = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $e) {
            error_log('dashboard leads: ' . $e->getMessage());
        }

        // Students — keep queries simple (no l2 alias; that broke manager KPI loads)
        try {
            $students = ['total' => 0, 'active' => 0];
            if (($normRole === 'manager' || $useOrg) && $useOrg) {
                $stmt = $db->prepare("
                    SELECT COUNT(*) as total,
                        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active
                    FROM students
                    WHERE org_id = ?
                ");
                $stmt->execute([$orgId]);
                $students = $stmt->fetch(PDO::FETCH_ASSOC) ?: $students;
            } elseif ($normRole === 'manager' && !empty($managerVisibleIds)) {
                $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
                $stmt = $db->prepare("
                    SELECT COUNT(*) as total, SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) as active
                    FROM students s
                    LEFT JOIN leads l ON l.id = s.lead_id
                    WHERE (
                        (l.id IS NOT NULL AND (l.assigned_to IN ($inUsers) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ($inUsers))))
                        OR (l.id IS NULL AND (s.mentor_id IN ($inUsers) OR s.user_id IN ($inUsers)))
                    )
                ");
                $stmt->execute(array_merge($managerVisibleIds, $managerVisibleIds, $managerVisibleIds, $managerVisibleIds));
                $students = $stmt->fetch(PDO::FETCH_ASSOC) ?: $students;
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM students");
                $stmt->execute();
                $students = $stmt->fetch(PDO::FETCH_ASSOC) ?: $students;
            }
            $result['students_count'] = (int) ($students['total'] ?? 0);
            $result['active_students'] = (int) ($students['active'] ?? 0);
        } catch (Throwable $e) {
            error_log('dashboard students: ' . $e->getMessage());
        }

        try {
            $courses = ['total' => 0, 'active' => 0];
            if ($useOrg) {
                $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM courses WHERE org_id = ?");
                $stmt->execute([$orgId]);
                $courses = $stmt->fetch(PDO::FETCH_ASSOC) ?: $courses;
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM courses");
                $stmt->execute();
                $courses = $stmt->fetch(PDO::FETCH_ASSOC) ?: $courses;
            }
            $result['courses_count'] = (int) ($courses['total'] ?? 0);
            $result['active_courses'] = (int) ($courses['active'] ?? 0);
        } catch (Throwable $e) {
            error_log('dashboard courses: ' . $e->getMessage());
        }

        try {
            $batches = ['total' => 0, 'active' => 0];
            if ($useOrg) {
                $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('active','upcoming') THEN 1 ELSE 0 END) as active FROM batches WHERE org_id = ?");
                $stmt->execute([$orgId]);
                $batches = $stmt->fetch(PDO::FETCH_ASSOC) ?: $batches;
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('active','upcoming') THEN 1 ELSE 0 END) as active FROM batches");
                $stmt->execute();
                $batches = $stmt->fetch(PDO::FETCH_ASSOC) ?: $batches;
            }
            $result['batches_count'] = (int) ($batches['total'] ?? 0);
            $result['active_batches'] = (int) ($batches['active'] ?? 0);
        } catch (Throwable $e) {
            error_log('dashboard batches: ' . $e->getMessage());
        }

        try {
            $payments = ['paid' => 0, 'pending' => 0];
            if ($useOrg) {
                $stmt = $db->prepare("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid, COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) as pending FROM payments WHERE org_id = ?");
                $stmt->execute([$orgId]);
                $payments = $stmt->fetch(PDO::FETCH_ASSOC) ?: $payments;
            } elseif ($normRole === 'manager' && !empty($managerVisibleIds)) {
                $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
                $stmt = $db->prepare("
                    SELECT COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) as paid,
                        COALESCE(SUM(CASE WHEN p.status='pending' THEN p.amount ELSE 0 END),0) as pending
                    FROM payments p
                    INNER JOIN students s ON s.id = p.student_id
                    LEFT JOIN leads l ON l.id = s.lead_id
                    WHERE (
                        (l.id IS NOT NULL AND (l.assigned_to IN ($inUsers) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ($inUsers))))
                        OR (l.id IS NULL AND (s.mentor_id IN ($inUsers) OR s.user_id IN ($inUsers)))
                    )
                ");
                $stmt->execute(array_merge($managerVisibleIds, $managerVisibleIds, $managerVisibleIds, $managerVisibleIds));
                $payments = $stmt->fetch(PDO::FETCH_ASSOC) ?: $payments;
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid, COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) as pending FROM payments");
                $stmt->execute();
                $payments = $stmt->fetch(PDO::FETCH_ASSOC) ?: $payments;
            }
            $result['total_revenue'] = (float) ($payments['paid'] ?? 0);
            $result['pending_revenue'] = (float) ($payments['pending'] ?? 0);
        } catch (Throwable $e) {
            error_log('dashboard payments: ' . $e->getMessage());
        }

        // Include Razorpay payment-link collections (amount_paid is paise) for full org revenue.
        try {
            $linkPaid = 0.0;
            $linkPending = 0.0;
            $deletedSql = (function_exists('syncpediaColumnExists') && syncpediaColumnExists($db, 'payment_links', 'deleted_at'))
                ? ' AND deleted_at IS NULL'
                : '';
            if ($useOrg) {
                $stmt = $db->prepare("
                    SELECT
                        COALESCE(SUM(amount_paid), 0) AS paid_paise,
                        COALESCE(SUM(CASE
                            WHEN status IN ('created','partially_paid') AND amount > amount_paid
                            THEN (amount - amount_paid) ELSE 0 END), 0) AS pending_paise
                    FROM payment_links
                    WHERE org_id = ?{$deletedSql}
                ");
                $stmt->execute([$orgId]);
                $links = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
                $linkPaid = ((float) ($links['paid_paise'] ?? 0)) / 100.0;
                $linkPending = ((float) ($links['pending_paise'] ?? 0)) / 100.0;
            } elseif ($normRole === 'manager' && !empty($managerVisibleIds)) {
                $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
                $stmt = $db->prepare("
                    SELECT
                        COALESCE(SUM(amount_paid), 0) AS paid_paise,
                        COALESCE(SUM(CASE
                            WHEN status IN ('created','partially_paid') AND amount > amount_paid
                            THEN (amount - amount_paid) ELSE 0 END), 0) AS pending_paise
                    FROM payment_links
                    WHERE salesperson_id IN ($inUsers){$deletedSql}
                ");
                $stmt->execute($managerVisibleIds);
                $links = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
                $linkPaid = ((float) ($links['paid_paise'] ?? 0)) / 100.0;
                $linkPending = ((float) ($links['pending_paise'] ?? 0)) / 100.0;
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("
                    SELECT
                        COALESCE(SUM(amount_paid), 0) AS paid_paise,
                        COALESCE(SUM(CASE
                            WHEN status IN ('created','partially_paid') AND amount > amount_paid
                            THEN (amount - amount_paid) ELSE 0 END), 0) AS pending_paise
                    FROM payment_links
                    WHERE 1=1{$deletedSql}
                ");
                $stmt->execute();
                $links = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
                $linkPaid = ((float) ($links['paid_paise'] ?? 0)) / 100.0;
                $linkPending = ((float) ($links['pending_paise'] ?? 0)) / 100.0;
            }
            $result['total_revenue'] = (float) ($result['total_revenue'] ?? 0) + $linkPaid;
            $result['pending_revenue'] = (float) ($result['pending_revenue'] ?? 0) + $linkPending;
        } catch (Throwable $e) {
            error_log('dashboard payment_links revenue: ' . $e->getMessage());
        }

        // Include approved manual payments in org revenue.
        try {
            if ($useOrg) {
                $stmt = $db->prepare("
                    SELECT COALESCE(SUM(amount), 0) AS manual_paid
                    FROM manual_payments
                    WHERE org_id = ? AND status = 'approved'
                ");
                $stmt->execute([$orgId]);
                $result['total_revenue'] = (float) ($result['total_revenue'] ?? 0)
                    + (float) ($stmt->fetchColumn() ?: 0);
            } elseif ($normRole === 'manager' && !empty($managerVisibleIds)) {
                $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
                $stmt = $db->prepare("
                    SELECT COALESCE(SUM(amount), 0) AS manual_paid
                    FROM manual_payments
                    WHERE status = 'approved' AND submitted_by IN ($inUsers)
                ");
                $stmt->execute($managerVisibleIds);
                $result['total_revenue'] = (float) ($result['total_revenue'] ?? 0)
                    + (float) ($stmt->fetchColumn() ?: 0);
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("
                    SELECT COALESCE(SUM(amount), 0) FROM manual_payments WHERE status = 'approved'
                ");
                $stmt->execute();
                $result['total_revenue'] = (float) ($result['total_revenue'] ?? 0)
                    + (float) ($stmt->fetchColumn() ?: 0);
            }
        } catch (Throwable $e) {
            error_log('dashboard manual_payments revenue: ' . $e->getMessage());
        }

        try {
            if ($useOrg) {
                $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users WHERE org_id = ?");
                $stmt->execute([$orgId]);
                $result['profiles'] = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } elseif ($normRole === 'manager' && !empty($managerVisibleIds)) {
                $inUsers = implode(',', array_fill(0, count($managerVisibleIds), '?'));
                $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users WHERE id IN ($inUsers)");
                $stmt->execute($managerVisibleIds);
                $result['profiles'] = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } elseif (tenantIsMasterView($tokenData)) {
                $stmt = $db->prepare("SELECT id as user_id, full_name, referral_code FROM users");
                $stmt->execute();
                $result['profiles'] = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            }
        } catch (Throwable $e) {
            error_log('dashboard profiles: ' . $e->getMessage());
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
