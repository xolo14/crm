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
        if (!syncpediaColumnExists($db, 'users', 'reports_to_id')) {
            $db->exec('ALTER TABLE users ADD COLUMN reports_to_id CHAR(36) DEFAULT NULL');
            try {
                $db->exec('CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users (reports_to_id)');
            } catch (Exception $e) {
            }
        }
    } catch (Exception $e) {
    }
    $done = true;
}

teamEnsureReportsToColumn($db);
syncpediaEnsureLoginPasswordColumn($db);
ensureUsersPageAccessColumn($db);

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
    $allowedRead = ['admin', 'org', 'super_admin', 'manager', 'sales_representative', 'hr', 'marketing'];
    if (!in_array($effRole, $allowedRead, true)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }

    /** Same-org roster for reps / HR / marketing (assign-to lists, read-only on Team page). */
    $orgPeerRoles = ['sales_representative', 'hr', 'marketing'];

    // Super Admin: no ?org_id → all tenants (ignore JWT switch_org). Explicit ?org_id → that tenant only.
    if ($effRole === 'super_admin' && empty($_GET['org_id'])) {
        $where = '1=1';
        $params = [];
    } elseif ($effRole === 'super_admin' && !empty($_GET['org_id'])) {
        $where = 'u.org_id = ?';
        $params = [(string) $_GET['org_id']];
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
        // Tenant admins (admin / org) and other roles — org-scoped roster.
        $orgFilter = orgFilter($tokenData, 'u');
        $where = $orgFilter['where'];
        $params = $orgFilter['params'];

        // L2 managers use dedicated org roster branch above; other non-admin roles use hierarchy subtree.
        if (!in_array($effRole, ['super_admin', 'admin'], true)) {
            $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
            $scope = hierarchyBuildInClause('u.id', $visibleIds);
            $where .= $scope['sql'];
            $params = array_merge($params, $scope['params']);
        }
    }

    $sql = "
        SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.referral_code, u.role, u.is_active, u.created_at, u.created_by, u.org_id, u.reports_to_id, u.page_access_json,
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
    try {
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // Older schema without page_access_json
        $sqlFallback = str_replace(', u.page_access_json', '', $sql);
        $stmt = $db->prepare($sqlFallback);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    foreach ($rows as &$row) {
        if (is_array($row)) {
            userAttachPageAccess($row);
        }
    }
    unset($row);
    respond(['data' => $rows]);
}

/** Whether the caller may send welcome email to an existing team member. */
function teamCallerCanSendWelcomeTo(PDO $db, array $tokenData, array $targetUser): bool
{
    $callerRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $targetId = trim((string) ($targetUser['id'] ?? ''));
    if ($targetId === '') {
        return false;
    }
    if ($callerRole === 'super_admin') {
        return true;
    }

    $callerOrg = teamResolveCallerOrgId($db, $tokenData);
    $targetOrg = trim((string) ($targetUser['org_id'] ?? ''));
    if ($callerOrg === null || $callerOrg === '' || $targetOrg === '' || $callerOrg !== $targetOrg) {
        return false;
    }

    if ($callerRole === 'admin') {
        return true;
    }

    if ($callerRole === 'manager') {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return in_array($targetId, $visibleIds, true);
    }

    return false;
}

function teamWantsWelcomeEmail(array $input): bool
{
    if (!array_key_exists('send_welcome_email', $input)) {
        return false;
    }
    $v = $input['send_welcome_email'];
    if ($v === true || $v === 1 || $v === '1') {
        return true;
    }
    if (is_string($v) && strtolower(trim($v)) === 'true') {
        return true;
    }
    return false;
}

// POST - Create new team member / send welcome email
if ($method === 'POST') {
    $postAction = trim((string) ($_GET['action'] ?? ''));

    if ($postAction === 'send_welcome_email') {
        requireRole($tokenData, ['admin', 'super_admin', 'manager']);
        $input = getInput();
        $targetId = trim((string) ($input['user_id'] ?? $input['id'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        if ($targetId === '' || trim($password) === '') {
            respond(['error' => 'user_id and password are required'], 400);
        }

        $stmt = $db->prepare(
            'SELECT id, email, full_name, phone, role, org_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        );
        $stmt->execute([$targetId]);
        $target = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$target || !is_array($target)) {
            respond(['error' => 'Team member not found'], 404);
        }
        if (!teamCallerCanSendWelcomeTo($db, $tokenData, $target)) {
            respond(['error' => 'You cannot send welcome email to this member'], 403);
        }

        $memberRole = normalizeRoleValue((string) ($target['role'] ?? ''));
        $welcomeResult = syncpediaSendMemberWelcomeEmail(
            (string) ($target['full_name'] ?? ''),
            (string) ($target['email'] ?? ''),
            $password,
            $memberRole,
            is_string($target['phone'] ?? null) ? (string) $target['phone'] : null,
        );

        $payload = [
            'id' => $targetId,
            'message' => 'Welcome email processed',
            'email_sent' => $welcomeResult['email_sent'],
            'email_from' => $welcomeResult['from'],
        ];
        if ($welcomeResult['email_error'] !== null) {
            $payload['email_error'] = $welcomeResult['email_error'];
        }
        respond($payload);
    }

    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();

    $email = trim($input['email'] ?? '');
    $password = trim((string) ($input['password'] ?? ''));
    if ($password === '' || $password === 'Welcome@123') {
        $password = syncpediaGenerateTempPassword();
    }
    $fullName = trim($input['full_name'] ?? '');
    $phone = $input['phone'] ?? null;
    $memberRole = normalizeRoleValue($input['role'] ?? 'sales_representative');
    $callerRole = normalizeRoleValue((string) $role);
    $isManagerCreator = $callerRole === 'manager';

    // Super_admin creates team members under the Syncpedia platform tenant — never under a switched-into tenant.
    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
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

    // Role hierarchy: L4/L3 may assign L2–L1 staff. Org admins are provisioned via Organizations, not Team.
    $allowedRoles = [];
    if (in_array($callerRole, ['super_admin', 'admin'], true)) {
        $allowedRoles = array_merge(['manager'], syncpediaL1AssignableRoles(), ['trainer', 'finance', 'student']);
    } elseif ($isManagerCreator) {
        $allowedRoles = syncpediaL1AssignableRoles();
    }

    if (in_array($memberRole, ['admin', 'org'], true)) {
        respond([
            'error' => 'Organization admins are created when the org is provisioned, or via Organizations → Admin credentials. They cannot be added from Team.',
        ], 403);
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
    syncpediaStoreUserLoginPassword($db, $id, (string) $password);

    $pageAccess = userNormalizePageAccessInput($input['page_access'] ?? null, $memberRole);
    try {
        userSavePageAccess($db, $id, $pageAccess);
    } catch (Throwable $e) {
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

    syncpediaAuditLog($db, $tokenData, 'created', 'team_member', $id, 'Created team member: ' . $fullName . ' (' . $memberRole . ')');

    $emailSent = false;
    $emailFrom = null;
    $emailError = null;
    if (teamWantsWelcomeEmail($input)) {
        $welcomeResult = syncpediaSendMemberWelcomeEmail(
            $fullName,
            $email,
            (string) $password,
            $memberRole,
            is_string($phone) ? $phone : null,
        );
        $emailSent = $welcomeResult['email_sent'];
        $emailFrom = $welcomeResult['from'];
        $emailError = $welcomeResult['email_error'];
    }

    $payload = [
        'id' => $id,
        'message' => 'Team member created',
        'default_password' => $password,
        'email_sent' => $emailSent,
        'email_from' => $emailFrom,
    ];
    if ($emailError !== null) {
        $payload['email_error'] = $emailError;
    }
    respond($payload, 201);
}

// PUT - Update team member
if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    $callerRole = normalizeRoleValue((string) ($tokenData['role'] ?? ''));
    $isManagerCaller = $callerRole === 'manager';

    if ($isManagerCaller) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        if (!in_array($id, $visibleIds, true) || $id === (string) $userId) {
            respond(['error' => 'You can only update members on your team'], 403);
        }
        $input = getInput();
        // Managers may only change page-access toggles on their L1 reports.
        if (!array_key_exists('page_access', $input)) {
            respond(['error' => 'Managers can only update page access toggles for team members'], 403);
        }
        $target = $db->prepare('SELECT id, role FROM users WHERE id = ? LIMIT 1');
        $target->execute([$id]);
        $targetRow = $target->fetch(PDO::FETCH_ASSOC);
        if (!$targetRow) {
            respond(['error' => 'User not found'], 404);
        }
        $targetRole = normalizeRoleValue((string) ($targetRow['role'] ?? ''));
        if (!in_array($targetRole, syncpediaL1AssignableRoles(), true)) {
            respond(['error' => 'Managers can only update page access for Sales Rep / HR / Marketing'], 403);
        }
        $pageAccess = userNormalizePageAccessInput($input['page_access'], $targetRole);
        userSavePageAccess($db, $id, $pageAccess);
        syncpediaAuditLog($db, $tokenData, 'updated', 'team_member', $id, 'Updated page access toggles');
        respond(['message' => 'Page access updated', 'page_access' => $pageAccess]);
    }

    syncpediaAssertTargetUserEditable($db, $tokenData, $id);

    $input = getInput();
    $fields = [];
    $params = [];

    foreach (['full_name', 'phone', 'email', 'is_active'] as $f) {
        if (array_key_exists($f, $input)) {
            if ($f === 'email') {
                $email = strtolower(trim((string) $input['email']));
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    respond(['error' => 'Valid email is required'], 400);
                }
                $dup = $db->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ? LIMIT 1');
                $dup->execute([$email, $id]);
                if ($dup->fetch()) {
                    respond(['error' => 'Email already exists'], 409);
                }
                $fields[] = 'email = ?';
                $params[] = $email;
                continue;
            }
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (array_key_exists('role', $input)) {
        $newRole = normalizeRoleValue((string) $input['role']);
        $usrStmt = $db->prepare('SELECT org_id, role FROM users WHERE id = ? LIMIT 1');
        $usrStmt->execute([$id]);
        $uRow = $usrStmt->fetch();
        $prevRole = normalizeRoleValue((string) ($uRow['role'] ?? ''));
        $callerRole = normalizeRoleValue((string) ($tokenData['role'] ?? ''));

        if ($prevRole === 'super_admin' && $callerRole !== 'super_admin') {
            respond(['error' => 'Cannot modify Super Admin accounts'], 403);
        }

        // Platform / org admin roles are never assignable from Team (same rules as POST create).
        if ($newRole === 'super_admin') {
            respond(['error' => 'Super Admin role cannot be assigned from Team.'], 403);
        }
        if (in_array($newRole, ['admin', 'org'], true) && $prevRole !== $newRole) {
            respond([
                'error' => 'Organization admins are managed from Organizations → Admin credentials, not Team role changes.',
            ], 403);
        }

        $allowedRoles = [];
        if (in_array($callerRole, ['super_admin', 'admin'], true)) {
            $allowedRoles = array_merge(['manager'], syncpediaL1AssignableRoles(), ['trainer', 'finance', 'student']);
        } elseif ($callerRole === 'manager') {
            $allowedRoles = syncpediaL1AssignableRoles();
        }

        if (!in_array($newRole, $allowedRoles, true)) {
            respond(['error' => 'You cannot assign this role'], 403);
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
        syncpediaStoreUserLoginPassword($db, $id, null);
    }

    $pageAccessSaved = null;
    if (array_key_exists('page_access', $input)) {
        $roleForAccess = array_key_exists('role', $input)
            ? normalizeRoleValue((string) $input['role'])
            : null;
        if ($roleForAccess === null) {
            $rr = $db->prepare('SELECT role FROM users WHERE id = ? LIMIT 1');
            $rr->execute([$id]);
            $roleForAccess = normalizeRoleValue((string) ($rr->fetchColumn() ?: ''));
        }
        $pageAccessSaved = userNormalizePageAccessInput($input['page_access'], $roleForAccess);
        userSavePageAccess($db, $id, $pageAccessSaved);
    }

    if (empty($fields) && $pageAccessSaved === null) {
        respond(['error' => 'Nothing to update'], 400);
    }

    if (!empty($fields)) {
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
    }

    $changedFields = array_key_exists('role', $input) ? 'role → ' . normalizeRoleValue((string) $input['role']) : implode(', ', array_keys($input));
    syncpediaAuditLog($db, $tokenData, 'updated', 'team_member', $id, 'Updated team member (' . $changedFields . ')');

    $resp = ['message' => 'Team member updated'];
    if ($pageAccessSaved !== null) {
        $resp['page_access'] = $pageAccessSaved;
    }
    respond($resp);
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

    $chk = $db->prepare("SELECT id, role, org_id, full_name FROM users WHERE id = ? LIMIT 1");
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
        $adminOrg = resolveCreatorOrgId($db, $tokenData);
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
    syncpediaAuditLog($db, $tokenData, 'deleted', 'team_member', $id, 'Removed team member: ' . ($target['full_name'] ?? $id));
    respond(['message' => 'Team member removed and moved to trash']);
}

respond(['error' => 'Method not allowed'], 405);
