<?php
/**
 * Manual payment submissions with proof upload + approval workflow.
 *
 * GET  ?action=list&status=approved|pending|rejected|all
 * GET  ?action=approvals   — all rows in reviewer scope (pending/approved/rejected)
 * POST multipart create    — amount, optional fields + proof file
 * POST ?action=approve&id= — approve (manager/admin/super_admin per rules)
 * POST ?action=reject&id=  — reject with optional review_notes
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$userId = trim((string) ($tokenData['user_id'] ?? ''));
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$orgId = resolveCreatorOrgId($db, $tokenData);

manualPaymentsEnsureSchema($db);

if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $status = strtolower(trim((string) ($_GET['status'] ?? 'approved')));
    if (!in_array($status, ['approved', 'pending', 'rejected', 'all'], true)) {
        $status = 'approved';
    }
    $scope = manualPaymentsListScope($db, $tokenData);
    $where = '1=1' . $scope['sql'];
    $params = $scope['params'];
    if ($status !== 'all') {
        $where .= ' AND mp.status = ?';
        $params[] = $status;
    }
    $sql = "
        SELECT mp.*,
            u.full_name AS submitted_by_name,
            u.email AS submitted_by_email,
            u.referral_code AS submitted_by_referral,
            u.role AS submitted_by_role,
            rv.full_name AS reviewed_by_name
        FROM manual_payments mp
        LEFT JOIN users u ON u.id = mp.submitted_by
        LEFT JOIN users rv ON rv.id = mp.reviewed_by
        WHERE {$where}
        ORDER BY mp.created_at DESC
        LIMIT 500
    ";
    $st = $db->prepare($sql);
    $st->execute($params);
    respond(['data' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
}

if ($method === 'GET' && $action === 'approvals') {
    if (!manualPaymentsIsApproverRole($role)) {
        respond(['error' => 'Forbidden'], 403);
    }
    $rows = manualPaymentsFetchAllForApprover($db, $tokenData);
    respond(['data' => $rows]);
}

if ($method === 'POST' && ($action === '' || $action === 'create')) {
    // Super admin does not use manual entry on Payment Records.
    if ($role === 'super_admin') {
        respond(['error' => 'Super admin cannot submit manual payments from Payment Records'], 403);
    }
    if ($userId === '') {
        respond(['error' => 'Unauthorized'], 401);
    }

    $ct = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
    $multipart = stripos($ct, 'multipart/form-data') !== false;
    $input = $multipart ? $_POST : getInput();

    $amount = (float) ($input['amount'] ?? 0);
    if ($amount <= 0) {
        respond(['error' => 'Amount must be greater than zero'], 400);
    }

    $customerName = trim((string) ($input['customer_name'] ?? ''));
    $customerEmail = trim((string) ($input['customer_email'] ?? ''));
    $customerPhone = trim((string) ($input['customer_phone'] ?? ''));
    $paymentMethod = trim((string) ($input['payment_method'] ?? ''));
    $paidAt = trim((string) ($input['paid_at'] ?? ''));

    if ($customerName === '') {
        respond(['error' => 'Customer name is required'], 400);
    }
    if ($customerEmail === '') {
        respond(['error' => 'Customer email is required'], 400);
    }
    if ($customerPhone === '') {
        respond(['error' => 'Customer phone is required'], 400);
    }
    if ($paidAt === '') {
        respond(['error' => 'Paid on date is required'], 400);
    }
    if ($paymentMethod === '') {
        respond(['error' => 'Payment mode is required'], 400);
    }

    $proofPath = null;
    if ($multipart) {
        foreach (['proof', 'file', 'image', 'attachment'] as $fk) {
            if (!empty($_FILES[$fk]) && is_array($_FILES[$fk])) {
                $proofPath = savePaymentProofUpload($_FILES[$fk]);
                if ($proofPath) {
                    break;
                }
            }
        }
    }
    if ($proofPath === null || $proofPath === '') {
        respond(['error' => 'Payment proof image is required'], 400);
    }

    // Admin / org: auto-approve into payment records. Others: pending approval.
    $needsApproval = !in_array($role, ['admin', 'org'], true);
    $status = $needsApproval ? 'pending' : 'approved';
    $reviewedBy = $needsApproval ? null : $userId;
    $reviewedAt = $needsApproval ? null : date('Y-m-d H:i:s');

    $id = generateUUID();
    $st = $db->prepare("
        INSERT INTO manual_payments (
            id, org_id, submitted_by, amount, currency, payment_method,
            customer_name, customer_email, customer_phone, paid_at, notes, proof_path,
            status, reviewed_by, reviewed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ");
    $st->execute([
        $id,
        $orgId,
        $userId,
        round($amount, 2),
        strtoupper(trim((string) ($input['currency'] ?? 'INR'))) ?: 'INR',
        $paymentMethod,
        $customerName,
        $customerEmail,
        $customerPhone,
        $paidAt,
        null,
        $proofPath,
        $status,
        $reviewedBy,
        $reviewedAt,
    ]);

    $row = manualPaymentsFetchById($db, $id);
    respond([
        'data' => $row,
        'message' => $needsApproval
            ? 'Submitted for approval'
            : 'Payment added to records',
    ], 201);
}

if ($method === 'POST' && in_array($action, ['approve', 'reject'], true)) {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        $body = getInput();
        $id = trim((string) ($body['id'] ?? ''));
    }
    if ($id === '') {
        respond(['error' => 'id is required'], 400);
    }
    $row = manualPaymentsFetchById($db, $id);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    if (($row['status'] ?? '') !== 'pending') {
        respond(['error' => 'Only pending payments can be reviewed'], 400);
    }
    if (!manualPaymentsCanApprove($db, $tokenData, $row)) {
        respond(['error' => 'You cannot approve this payment'], 403);
    }

    $body = getInput();
    $notes = trim((string) ($body['review_notes'] ?? ''));
    $newStatus = $action === 'approve' ? 'approved' : 'rejected';
    $st = $db->prepare("
        UPDATE manual_payments
        SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ? AND status = 'pending'
    ");
    $st->execute([
        $newStatus,
        $userId,
        $notes !== '' ? $notes : null,
        $id,
    ]);
    if ($st->rowCount() < 1) {
        respond(['error' => 'Payment was already reviewed'], 409);
    }
    respond([
        'data' => manualPaymentsFetchById($db, $id),
        'message' => $newStatus === 'approved' ? 'Payment approved' : 'Payment rejected',
    ]);
}

if ($method === 'DELETE' && $action === 'delete') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id is required'], 400);
    }
    if (!in_array($role, ['admin', 'super_admin'], true)) {
        respond(['error' => 'Only admin/super_admin can delete approved records'], 403);
    }
    $row = manualPaymentsFetchById($db, $id);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    if ((string) ($row['status'] ?? '') !== 'approved') {
        respond(['error' => 'Only approved records can be deleted'], 400);
    }
    if ($role !== 'super_admin') {
        $callerOrg = resolveCreatorOrgId($db, $tokenData);
        $rowOrg = trim((string) ($row['org_id'] ?? ''));
        if ($callerOrg === null || $callerOrg === '' || ($rowOrg !== '' && $rowOrg !== $callerOrg)) {
            respond(['error' => 'Forbidden'], 403);
        }
    }
    $st = $db->prepare('DELETE FROM manual_payments WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    if ($st->rowCount() < 1) {
        respond(['error' => 'Delete failed'], 400);
    }
    deletePaymentProofIfExists((string) ($row['proof_path'] ?? ''));
    respond(['message' => 'Payment record deleted']);
}

respond(['error' => 'Not found'], 404);

// ─── helpers ───────────────────────────────────────────────────────────────

function manualPaymentsEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS manual_payments (
              id CHAR(36) NOT NULL,
              org_id CHAR(36) DEFAULT NULL,
              submitted_by CHAR(36) NOT NULL,
              amount DECIMAL(12,2) NOT NULL,
              currency VARCHAR(3) NOT NULL DEFAULT 'INR',
              payment_method VARCHAR(80) DEFAULT NULL,
              customer_name VARCHAR(200) DEFAULT NULL,
              customer_email VARCHAR(255) DEFAULT NULL,
              customer_phone VARCHAR(40) DEFAULT NULL,
              paid_at DATE DEFAULT NULL,
              notes TEXT DEFAULT NULL,
              proof_path VARCHAR(500) DEFAULT NULL,
              status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
              reviewed_by CHAR(36) DEFAULT NULL,
              reviewed_at DATETIME DEFAULT NULL,
              review_notes TEXT DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              INDEX idx_mp_org (org_id),
              INDEX idx_mp_submitted (submitted_by),
              INDEX idx_mp_status (status),
              INDEX idx_mp_org_status (org_id, status),
              INDEX idx_mp_paid_at (paid_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $e) {
        error_log('manual_payments ensureSchema: ' . $e->getMessage());
    }
}

function manualPaymentsIsApproverRole(string $role): bool
{
    return in_array($role, ['super_admin', 'admin', 'org', 'manager'], true);
}

/**
 * Visibility for list:
 * - admin/org/super_admin(org): org
 * - manager: self + downline
 * - L1 / others: self only
 *
 * @return array{sql: string, params: array}
 */
function manualPaymentsListScope(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = resolveCreatorOrgId($db, $tokenData);

    if ($role === 'super_admin' && ($orgId === null || $orgId === '')) {
        return ['sql' => '', 'params' => []];
    }
    if (in_array($role, ['admin', 'org', 'super_admin'], true) && $orgId) {
        return ['sql' => ' AND mp.org_id = ?', 'params' => [$orgId]];
    }
    if ($role === 'manager') {
        $visible = hierarchyGetVisibleUserIds($db, $tokenData);
        if (empty($visible)) {
            $visible = $userId !== '' ? [$userId] : ['__none__'];
        }
        $in = implode(',', array_fill(0, count($visible), '?'));
        $sql = " AND mp.submitted_by IN ({$in})";
        $params = array_values($visible);
        if ($orgId) {
            $sql .= ' AND (mp.org_id = ? OR mp.org_id IS NULL)';
            $params[] = $orgId;
        }
        return ['sql' => $sql, 'params' => $params];
    }
    // L1 and everyone else: own submissions only
    return ['sql' => ' AND mp.submitted_by = ?', 'params' => [$userId !== '' ? $userId : '__none__']];
}

function manualPaymentsFetchById(PDO $db, string $id): ?array
{
    $st = $db->prepare("
        SELECT mp.*,
            u.full_name AS submitted_by_name,
            u.email AS submitted_by_email,
            u.referral_code AS submitted_by_referral,
            u.role AS submitted_by_role,
            rv.full_name AS reviewed_by_name
        FROM manual_payments mp
        LEFT JOIN users u ON u.id = mp.submitted_by
        LEFT JOIN users rv ON rv.id = mp.reviewed_by
        WHERE mp.id = ?
        LIMIT 1
    ");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function manualPaymentsCanApprove(PDO $db, array $tokenData, array $row): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $submitterId = trim((string) ($row['submitted_by'] ?? ''));
    if ($userId === '' || $submitterId === '' || $submitterId === $userId) {
        return false;
    }

    $callerOrg = resolveCreatorOrgId($db, $tokenData);
    $rowOrg = trim((string) ($row['org_id'] ?? ''));
    if ($role !== 'super_admin') {
        if ($callerOrg === null || $callerOrg === '' || ($rowOrg !== '' && $rowOrg !== $callerOrg)) {
            return false;
        }
    }

    $submitterRole = syncpediaNormalizeRoleKey((string) ($row['submitted_by_role'] ?? ''));
    if ($submitterRole === '') {
        try {
            $st = $db->prepare('SELECT role FROM users WHERE id = ? LIMIT 1');
            $st->execute([$submitterId]);
            $submitterRole = syncpediaNormalizeRoleKey((string) ($st->fetchColumn() ?: ''));
        } catch (Throwable $e) {
            $submitterRole = '';
        }
    }

    // Manager submissions need admin/org/super_admin only.
    if ($submitterRole === 'manager') {
        return in_array($role, ['admin', 'org', 'super_admin'], true);
    }

    // L1 (and similar): assigned manager (downline) OR admin/org/super_admin.
    if (in_array($role, ['admin', 'org', 'super_admin'], true)) {
        return true;
    }
    if ($role === 'manager') {
        $visible = hierarchyGetVisibleUserIds($db, $tokenData);
        return in_array($submitterId, $visible, true);
    }
    return false;
}

function manualPaymentsFetchPendingForApprover(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $where = "mp.status = 'pending'";
    $params = [];

    if ($role === 'super_admin' && ($orgId === null || $orgId === '')) {
        // all pending
    } elseif (in_array($role, ['admin', 'org', 'super_admin'], true) && $orgId) {
        $where .= ' AND mp.org_id = ?';
        $params[] = $orgId;
    } elseif ($role === 'manager') {
        $visible = hierarchyGetVisibleUserIds($db, $tokenData);
        $userId = trim((string) ($tokenData['user_id'] ?? ''));
        // Exclude self; only downline L1 pending (not other managers).
        $visible = array_values(array_filter($visible, static function ($id) use ($userId) {
            return (string) $id !== $userId;
        }));
        if (empty($visible)) {
            return [];
        }
        $in = implode(',', array_fill(0, count($visible), '?'));
        $where .= " AND mp.submitted_by IN ({$in})";
        $params = array_merge($params, $visible);
        if ($orgId) {
            $where .= ' AND (mp.org_id = ? OR mp.org_id IS NULL)';
            $params[] = $orgId;
        }
    } else {
        return [];
    }

    $sql = "
        SELECT mp.*,
            u.full_name AS submitted_by_name,
            u.email AS submitted_by_email,
            u.referral_code AS submitted_by_referral,
            u.role AS submitted_by_role
        FROM manual_payments mp
        LEFT JOIN users u ON u.id = mp.submitted_by
        WHERE {$where}
        ORDER BY mp.created_at ASC
        LIMIT 500
    ";
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    // Managers must not see other managers' pending submissions.
    if ($role === 'manager') {
        $rows = array_values(array_filter($rows, static function ($r) {
            $sr = syncpediaNormalizeRoleKey((string) ($r['submitted_by_role'] ?? ''));
            return $sr !== 'manager' && $sr !== 'admin' && $sr !== 'org' && $sr !== 'super_admin';
        }));
    }

    return $rows;
}

function manualPaymentsFetchAllForApprover(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $where = '1=1';
    $params = [];

    if ($role === 'super_admin' && ($orgId === null || $orgId === '')) {
        // all
    } elseif (in_array($role, ['admin', 'org', 'super_admin'], true) && $orgId) {
        $where .= ' AND mp.org_id = ?';
        $params[] = $orgId;
    } elseif ($role === 'manager') {
        $visible = hierarchyGetVisibleUserIds($db, $tokenData);
        if (empty($visible)) {
            return [];
        }
        $in = implode(',', array_fill(0, count($visible), '?'));
        $where .= " AND mp.submitted_by IN ({$in})";
        $params = array_merge($params, $visible);
        if ($orgId) {
            $where .= ' AND (mp.org_id = ? OR mp.org_id IS NULL)';
            $params[] = $orgId;
        }
    } else {
        return [];
    }

    $sql = "
        SELECT mp.*,
            u.full_name AS submitted_by_name,
            u.email AS submitted_by_email,
            u.referral_code AS submitted_by_referral,
            u.role AS submitted_by_role,
            rv.full_name AS reviewed_by_name
        FROM manual_payments mp
        LEFT JOIN users u ON u.id = mp.submitted_by
        LEFT JOIN users rv ON rv.id = mp.reviewed_by
        WHERE {$where}
        ORDER BY mp.created_at DESC
        LIMIT 500
    ";
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    if ($role === 'manager') {
        $rows = array_values(array_filter($rows, static function ($r) {
            $sr = syncpediaNormalizeRoleKey((string) ($r['submitted_by_role'] ?? ''));
            return $sr !== 'manager' && $sr !== 'admin' && $sr !== 'org' && $sr !== 'super_admin';
        }));
    }

    return $rows;
}
