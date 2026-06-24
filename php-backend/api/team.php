<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

function normalizeRoleValue(string $value): string {
    $clean = strtolower(trim($value));
    if ($clean === 'sales_executive') {
        return 'sales_representative';
    }
    if ($clean === 'team_lead' || $clean === 'sales_manager') {
        return 'manager';
    }
    if (strpos($clean, 'marketing') === 0) {
        return 'marketing';
    }
    return $clean;
}

function teamEnsureReportsToColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $chk = $db->query("SHOW COLUMNS FROM `users` LIKE 'reports_to_id'");
        if ($chk && !$chk->fetch()) {
            $db->exec("ALTER TABLE `users` ADD COLUMN `reports_to_id` CHAR(36) DEFAULT NULL AFTER `org_id`");
            try {
                $db->exec("ALTER TABLE `users` ADD INDEX `idx_users_reports_to` (`reports_to_id`)");
            } catch (Exception $e) {
            }
        }
    } catch (Exception $e) {
    }
    $done = true;
}

teamEnsureReportsToColumn($db);

function teamNormalizeRoleForRead(array $tokenData): string {
    $r = strtolower(trim((string) ($tokenData['role'] ?? '')));
    if ($r === 'superadmin') {
        return 'super_admin';
    }
    if ($r === 'organisation') {
        return 'org';
    }
    if (in_array($r, ['team_lead', 'sales_manager'], true)) {
        return 'manager';
    }
    if (strpos($r, 'marketing') === 0) {
        return 'marketing';
    }
    return $r;
}

function teamResolveCallerOrgId(PDO $db, array $tokenData): ?string {
    $oid = isset($tokenData['org_id']) ? trim((string) $tokenData['org_id']) : '';
    if ($oid !== '') {
        return $oid;
    }
    $uid = $tokenData['user_id'] ?? null;
    if (!$uid || !is_string($uid)) {
        return null;
    }
    $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
    $st->execute([$uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $oid = isset($row['org_id']) ? trim((string) $row['org_id']) : '';
    return $oid !== '' ? $oid : null;
}

// GET - List team members (scoped by org when applicable)
if ($method === 'GET') {
    $effRole = teamNormalizeRoleForRead($tokenData);
    $allowedRead = ['admin', 'org', 'super_admin', 'manager', 'sales_representative', 'hr', 'marketing', 'sales_marketing'];
    if (!in_array($effRole, $allowedRead, true)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }

    /** Same-org roster for reps / HR / marketing (assign-to lists, read-only on Team page). */
    $orgPeerRoles = ['sales_representative', 'hr', 'marketing', 'sales_marketing'];

    if ($effRole === 'super_admin' && empty($_GET['org_id'])) {
        $where = '1=1';
        $params = [];
    } elseif (in_array($effRole, $orgPeerRoles, true)) {
        $orgId = teamResolveCallerOrgId($db, $tokenData);
        if ($orgId === null || $orgId === '') {
            respond(['data' => []]);
        }
        $where = "u.org_id = ? AND u.is_active = 1 AND LOWER(TRIM(u.role)) NOT IN ('super_admin')";
        $params = [$orgId];
    } elseif ($effRole === 'manager') {
        /** L2: read-only roster — direct/indirect reports only (assigned team). */
        $orgId = teamResolveCallerOrgId($db, $tokenData);
        if ($orgId === null || $orgId === '') {
            respond(['data' => []]);
        }
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $managerId = isset($tokenData['user_id']) ? (string) $tokenData['user_id'] : '';
        $visibleIds = array_values(array_filter($visibleIds, static function ($id) use ($managerId) {
            return is_string($id) && $id !== '' && $id !== $managerId;
        }));
        if (empty($visibleIds)) {
            respond(['data' => []]);
        }
        $in = implode(',', array_fill(0, count($visibleIds), '?'));
        $where = "u.org_id = ? AND u.is_active = 1 AND u.id IN ($in)";
        $params = array_merge([$orgId], $visibleIds);
    } else {
        // Super admin filtering one org, or tenant admins/managers/leads.
        if ($effRole === 'super_admin' && !empty($_GET['org_id'])) {
            $where = 'u.org_id = ?';
            $params = [(string) $_GET['org_id']];
        } else {
            $orgFilter = orgFilter($tokenData, 'u');
            $where = $orgFilter['where'];
            $params = $orgFilter['params'];
        }

        // L2 managers use dedicated org roster branch above; other non-admin roles use hierarchy subtree.
        if (!in_array($effRole, ['super_admin', 'admin'], true)) {
            $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
            $scope = hierarchyBuildInClause('u.id', $visibleIds);
            $where .= $scope['sql'];
            $params = array_merge($params, $scope['params']);
        }
    }

    $sql = "
        SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.referral_code, u.role, u.is_active, u.created_at, u.created_by, u.org_id, u.reports_to_id,
            tl.full_name AS reports_to_name,
            CASE
                WHEN LOWER(TRIM(u.role)) = 'super_admin' AND (o.name IS NULL OR TRIM(o.name) = '') THEN 'Syncpedia'
                ELSE o.name
            END AS org_name,
            adm.full_name AS org_admin_name,
            adm.email AS org_admin_email
        FROM users u
        LEFT JOIN users tl ON u.reports_to_id = tl.id
        LEFT JOIN organizations o ON u.org_id = o.id
        LEFT JOIN users adm ON o.owner_id = adm.id
        WHERE ($where)
        ORDER BY FIELD(u.role, 'super_admin', 'admin', 'manager', 'marketing', 'hr', 'sales_representative', 'trainer', 'finance', 'student'), u.full_name
    ";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

// POST - Create new team member
if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();

    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? 'Welcome@123';
    $fullName = trim($input['full_name'] ?? '');
    $phone = $input['phone'] ?? null;
    $memberRole = normalizeRoleValue($input['role'] ?? 'sales_representative');
    $sendWelcomeEmail = !empty($input['send_welcome_email']);
    $callerRole = normalizeRoleValue((string) $role);
    $isManagerCreator = $callerRole === 'manager';

    // Super_admin creates team members under the Syncpedia platform tenant — never under a switched-into tenant.
    if (($tokenData['role'] ?? '') === 'super_admin') {
        $orgId = syncpediaGetOrCreateOrgId($db, $userId);
    } else {
        $orgId = resolveCreatorOrgId($db, $tokenData);
    }
    $reportsToId = null;
    if ($isManagerCreator) {
        // L2 managers: new L1 members are always assigned to the creating manager.
        $reportsToId = $userId;
    } elseif (!empty($input['reports_to_id']) && is_string($input['reports_to_id'])) {
        $t = trim($input['reports_to_id']);
        $reportsToId = $t !== '' ? $t : null;
    }

    if (!$email || !$fullName) {
        respond(['error' => 'Email and name are required'], 400);
    }

    // Role hierarchy: L4/L3 may assign L3–L1; L2 may assign L1 operational roles only.
    $allowedRoles = [];
    if (in_array($callerRole, ['super_admin', 'admin'], true)) {
        $allowedRoles = array_merge(['admin', 'manager'], syncpediaL1AssignableRoles(), ['trainer', 'finance', 'student']);
    } elseif ($isManagerCreator) {
        $allowedRoles = syncpediaL1AssignableRoles();
    }

    if (!in_array($memberRole, $allowedRoles, true)) {
        respond(['error' => 'You cannot assign this role'], 403);
    }

    // Check duplicate
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        respond(['error' => 'Email already exists'], 409);
    }

    // One admin role user per organization (org-scoped).
    if ($memberRole === 'admin' && $orgId) {
        $cntStmt = $db->prepare("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND LOWER(TRIM(role)) = 'admin' AND is_active = 1");
        $cntStmt->execute([$orgId]);
        if ((int)($cntStmt->fetch()['c'] ?? 0) >= 1) {
            respond(['error' => 'This organization already has one admin. Use Control Panel → Organization row → Admin to change credentials.'], 409);
        }
    }

    if ($reportsToId) {
        $chk = $db->prepare("SELECT id, role, org_id FROM users WHERE id = ? AND is_active = 1");
        $chk->execute([$reportsToId]);
        $mgr = $chk->fetch();
        $mgrRole = $mgr ? normalizeRoleValue($mgr['role']) : '';
        $allowedParentRoles = ['manager'];
        if ($memberRole === 'manager') {
            $allowedParentRoles = ['admin', 'org', 'super_admin'];
        } elseif (in_array($memberRole, syncpediaL1AssignableRoles(), true)) {
            $allowedParentRoles = ['manager'];
        }
        if (!$mgr || !in_array($mgrRole, $allowedParentRoles, true)) {
            respond(['error' => 'Invalid parent for reports_to'], 400);
        }
        if ($orgId && ($mgr['org_id'] ?? null) !== $orgId) {
            respond(['error' => 'Manager must belong to the same organization'], 400);
        }
    }

    $id = generateUUID();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $refCode = generateUniqueSpReferralCode($db, $fullName);

    try {
        $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role, org_id, reports_to_id, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $email, $hash, $fullName, $phone, $memberRole, $orgId, $reportsToId, $refCode]);
    } catch (Exception $e) {
        $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role, org_id, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $email, $hash, $fullName, $phone, $memberRole, $orgId, $refCode]);
    }

    if ($memberRole === 'marketing') {
        try {
            $mStmt = $db->prepare("INSERT INTO marketing_members (id, user_id, name, email, phone, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)");
            $mStmt->execute([generateUUID(), $id, $fullName, $email, $phone, $userId, $orgId]);
        } catch (Exception $e) {
            $mStmt = $db->prepare("INSERT INTO marketing_members (id, user_id, name, email, phone, status, created_by) VALUES (?, ?, ?, ?, ?, 'active', ?)");
            $mStmt->execute([generateUUID(), $id, $fullName, $email, $phone, $userId]);
        }
    }

    if ($memberRole === 'hr') {
        try {
            $db->prepare('UPDATE users SET created_by = ? WHERE id = ?')->execute([$userId, $id]);
        } catch (Throwable $e) {
        }
    }

    if ($memberRole === 'sales_representative') {
        assignLeadFormsToSalesMember($db, $userId, $id, $orgId);
    }

    $emailSent = false;
    $emailError = null;
    if ($sendWelcomeEmail) {
        $phoneStr = is_string($phone) ? $phone : null;
        $welcomeHtml = syncpediaBuildTeamMemberWelcomeEmailHtml($fullName, $email, (string) $password, $memberRole, $phoneStr);
        $mailRes = syncpediaSendHtmlEmail($email, 'Your Syncpedia CRM login credentials', $welcomeHtml);
        if (($mailRes['ok'] ?? false) === true) {
            $emailSent = true;
        } else {
            $emailError = $mailRes['error'] ?? 'Email send failed';
        }
    }

    $payload = [
        'id' => $id,
        'message' => 'Team member created',
        'default_password' => $password,
        'email_sent' => $emailSent,
    ];
    if ($emailError !== null) {
        $payload['email_error'] = $emailError;
    }
    respond($payload, 201);
}

// PUT - Update team member
if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $input = getInput();
    $fields = [];
    $params = [];

    foreach (['full_name', 'phone', 'is_active'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (array_key_exists('role', $input)) {
        $newRole = normalizeRoleValue((string)$input['role']);
        $usrStmt = $db->prepare("SELECT org_id, role FROM users WHERE id = ? LIMIT 1");
        $usrStmt->execute([$id]);
        $uRow = $usrStmt->fetch();
        $targetOrgId = $uRow['org_id'] ?? null;
        $prevRole = normalizeRoleValue((string)($uRow['role'] ?? ''));
        if ($newRole === 'admin' && $targetOrgId && $prevRole !== 'admin') {
            $cstmt = $db->prepare("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND LOWER(TRIM(role)) = 'admin' AND is_active = 1 AND id != ?");
            $cstmt->execute([$targetOrgId, $id]);
            if ((int)($cstmt->fetch()['c'] ?? 0) >= 1) {
                respond(['error' => 'This organization already has one admin. Use Control Panel → Organization → Admin to update credentials.'], 409);
            }
        }
        $fields[] = 'role = ?';
        $params[] = $newRole;
    }
    if (array_key_exists('reports_to_id', $input)) {
        $assignerRole = normalizeRoleValue((string) ($tokenData['role'] ?? ''));
        if (!in_array($assignerRole, ['super_admin', 'admin'], true)) {
            respond(['error' => 'Only Super Admin or Admin can assign team members to a manager'], 403);
        }
        $rawRt = $input['reports_to_id'];
        $rt = is_string($rawRt) ? trim($rawRt) : '';
        if ($rawRt === null || $rt === '' || $rt === 'null') {
            $fields[] = 'reports_to_id = NULL';
        } else {
            $chk = $db->prepare("SELECT id, role, org_id FROM users WHERE id = ? AND is_active = 1");
            $chk->execute([$rt]);
            $mgr = $chk->fetch();

            $targetRoleForValidation = null;
            if (array_key_exists('role', $input)) {
                $targetRoleForValidation = normalizeRoleValue((string)$input['role']);
            } else {
                try {
                    $tstmt = $db->prepare("SELECT role FROM users WHERE id = ? LIMIT 1");
                    $tstmt->execute([$id]);
                    $trow = $tstmt->fetch();
                    $targetRoleForValidation = normalizeRoleValue((string)($trow['role'] ?? ''));
                } catch (Throwable $ignored) {
                    $targetRoleForValidation = null;
                }
            }

            $allowedParentRoles = ['manager'];
            if ($targetRoleForValidation === 'manager') {
                $allowedParentRoles = ['admin', 'org', 'super_admin'];
            } elseif (in_array($targetRoleForValidation, syncpediaL1AssignableRoles(), true)) {
                $allowedParentRoles = ['manager'];
            }

            if (!$mgr || !in_array(normalizeRoleValue($mgr['role']), $allowedParentRoles, true)) {
                respond(['error' => 'Invalid parent for reports_to'], 400);
            }
            $orgId = $tokenData['org_id'] ?? null;
            if ($orgId && ($mgr['org_id'] ?? null) !== $orgId) {
                respond(['error' => 'Manager must belong to the same organization'], 400);
            }
            $fields[] = 'reports_to_id = ?';
            $params[] = $rt;
        }
    }
    if (!empty($input['password'])) {
        $fields[] = 'password_hash = ?';
        $params[] = password_hash($input['password'], PASSWORD_DEFAULT);
    }

    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $params[] = $id;
    $stmt = $db->prepare("UPDATE users SET " . implode(', ', $fields) . " WHERE id = ?");
    try {
        $stmt->execute($params);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'reports_to_id') !== false) {
            respond(['error' => 'Database missing reports_to_id column; run migrations or re-import schema.'], 500);
        }
        throw $e;
    }

    respond(['message' => 'Team member updated']);
}

// DELETE - Remove team member (archive to trash, then hard delete)
if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    if ($id === $userId) {
        respond(['error' => 'You cannot remove your own account'], 400);
    }

    $chk = $db->prepare("SELECT id, role, org_id FROM users WHERE id = ? LIMIT 1");
    $chk->execute([$id]);
    $target = $chk->fetch();
    if (!$target) {
        respond(['error' => 'User not found'], 404);
    }
    if (($target['role'] ?? '') === 'super_admin') {
        respond(['error' => 'Super admin cannot be removed from Team'], 403);
    }
    // Org admins can remove only members in their own organization.
    if ($role === 'admin') {
        $adminOrg = $tokenData['org_id'] ?? null;
        $targetOrg = $target['org_id'] ?? null;
        if (!$adminOrg || !$targetOrg || $adminOrg !== $targetOrg) {
            respond(['error' => 'You can remove members only from your own organization'], 403);
        }
    }

    // Archive full user payload to trash before deletion.
    trashArchiveRow($db, 'team_member', 'users', $id, $tokenData);

    // Clean reporting relationships for downline users.
    try {
        $clr = $db->prepare("UPDATE users SET reports_to_id = NULL WHERE reports_to_id = ?");
        $clr->execute([$id]);
    } catch (Throwable $e) {
        // Continue; this can fail on older schemas without reports_to_id.
    }

    // Remove optional side-table links if present.
    try {
        $db->prepare("DELETE FROM marketing_members WHERE user_id = ?")->execute([$id]);
    } catch (Throwable $e) {
    }

    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Team member removed and moved to trash']);
}

respond(['error' => 'Method not allowed'], 405);
