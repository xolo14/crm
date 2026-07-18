<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$input = getInput();
$method = $_SERVER['REQUEST_METHOD'];

function ensurePasswordResetsTable(PDO $db): void {
    static $ok = false;
    if ($ok) {
        return;
    }
    try {
        $db->exec("CREATE TABLE IF NOT EXISTS password_resets (
            id CHAR(36) NOT NULL,
            user_id CHAR(36) NOT NULL,
            token VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE (token)
        )");
        try {
            $db->exec('CREATE INDEX idx_password_resets_user ON password_resets (user_id)');
        } catch (Exception $e) {
            // Index may already exist
        }
        // Older installs may lack created_at or use a short token column
        try {
            $cols = $db->query('SHOW COLUMNS FROM password_resets')->fetchAll(PDO::FETCH_COLUMN);
            $colSet = array_map('strtolower', array_map('strval', $cols ?: []));
            if (!in_array('created_at', $colSet, true)) {
                $db->exec('ALTER TABLE password_resets ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
            }
            $db->exec('ALTER TABLE password_resets MODIFY token VARCHAR(255) NOT NULL');
        } catch (Exception $e) {
        }
    } catch (Exception $e) {
    }
    $ok = true;
}

/** Login page path for password-reset links, by account role. */
function syncpediaPasswordResetLoginPath(string $role): string
{
    $r = syncpediaNormalizeRoleKey($role);
    if ($r === 'super_admin') {
        return '/super_admin';
    }

    return '/login';
}

function normalizeRoleForPortal(string $role): string {
    $cleaned = strtolower(trim($role));
    if (strpos($cleaned, 'marketing') === 0 || $cleaned === 'sales_marketing') {
        return 'marketing';
    }
    if ($cleaned === 'superadmin' || $cleaned === 'super admin' || $cleaned === 'super-admin') {
        return 'super_admin';
    }
    if ($cleaned === 'organisation' || $cleaned === 'organization') {
        return 'org';
    }
    if ($cleaned === 'sales_manager' || $cleaned === 'team_lead') {
        return 'manager';
    }
    if ($cleaned === 'sales_executive') {
        return 'sales_representative';
    }
    return $cleaned;
}

/** @return array{email:string,sub?:string}|array{error:string} */
function verifyGoogleIdTokenForAuth(string $idToken, string $clientId): array {
    $clientId = trim($clientId);
    if ($clientId === '') {
        return ['error' => 'Google Sign-In is not configured on the server'];
    }
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($idToken);
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false || $raw === '') {
        return ['error' => 'Unable to reach Google to verify sign-in'];
    }
    $p = json_decode($raw, true);
    if (!is_array($p) || !empty($p['error'])) {
        return ['error' => 'Invalid or expired Google sign-in'];
    }
    if (($p['aud'] ?? '') !== $clientId) {
        return ['error' => 'Google client ID mismatch — check GOOGLE_CLIENT_ID in api/config.php'];
    }
    $iss = (string)($p['iss'] ?? '');
    if ($iss !== 'https://accounts.google.com' && $iss !== 'accounts.google.com') {
        return ['error' => 'Invalid Google token'];
    }
    $ev = $p['email_verified'] ?? '';
    if ($ev !== 'true' && $ev !== true && $ev !== '1' && $ev !== 1) {
        return ['error' => 'Google email is not verified'];
    }
    $email = trim((string)($p['email'] ?? ''));
    if ($email === '') {
        return ['error' => 'Google did not return an email address'];
    }
    return ['email' => $email, 'sub' => (string)($p['sub'] ?? '')];
}

/** Build login JSON (token, user, organization) from a users row including password_hash and is_active. */
function authLoginSuccessResponse(PDO $db, array $user): array {
    if (!(int)($user['is_active'] ?? 0)) {
        respond(['error' => 'This account is deactivated. Ask your administrator to re-enable it.'], 403);
    }

    $normalizedRole = normalizeRoleForPortal($user['role'] ?? '');
    if ($normalizedRole !== 'marketing' && $normalizedRole !== 'super_admin') {
        $mstmt = $db->prepare("SELECT id FROM marketing_members WHERE user_id = ? OR email = ? LIMIT 1");
        $mstmt->execute([$user['id'], $user['email']]);
        if ($mstmt->fetch()) {
            $normalizedRole = 'marketing';
        }
    }
    $user['role'] = $normalizedRole;

    // Attach page access toggles (payments / offer letters).
    ensureUsersPageAccessColumn($db);
    if (!array_key_exists('page_access_json', $user)) {
        try {
            $pa = $db->prepare('SELECT page_access_json FROM users WHERE id = ? LIMIT 1');
            $pa->execute([$user['id']]);
            $user['page_access_json'] = $pa->fetchColumn() ?: null;
        } catch (Throwable $e) {
            $user['page_access_json'] = null;
        }
    }
    userAttachPageAccess($user);

    // Super admin master panel: no org in JWT until switch_org selects a tenant.
    $tokenOrgId = $user['org_id'] ?? null;
    if ($normalizedRole === 'super_admin') {
        $tokenOrgId = null;
    }
    $token = createToken($user['id'], $user['role'], $tokenOrgId);
    unset($user['password_hash'], $user['is_active']);

    $org = null;
    if ($normalizedRole !== 'super_admin' && !empty($user['org_id'])) {
        $ostmt = $db->prepare("SELECT id, name, slug, logo_url, plan FROM organizations WHERE id = ? AND is_active = 1");
        $ostmt->execute([$user['org_id']]);
        $org = $ostmt->fetch();

        if ($org) {
            $fstmt = $db->prepare("SELECT feature, enabled FROM org_features WHERE org_id = ?");
            $fstmt->execute([$user['org_id']]);
            $features = [];
            foreach ($fstmt->fetchAll() as $f) {
                $features[$f['feature']] = (bool)$f['enabled'];
            }
            $org['features'] = $features;
        }
    }

    return [
        'token' => $token,
        'user' => $user,
        'organization' => $org,
    ];
}

if ($method === 'POST' && isset($_GET['action'])) {
    $action = $_GET['action'];

    if ($action === 'forgot_password') {
        syncpediaRateLimitConsume('auth_forgot', 5, 3600);
        $email = trim($input['email'] ?? '');
        if (!$email) {
            respond(['error' => 'Email is required'], 400);
        }
        ensurePasswordResetsTable($db);
        $stmt = $db->prepare("SELECT id, full_name, role, org_id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND is_active = 1");
        $stmt->execute([$email]);
        $u = $stmt->fetch();
        $genericMsg = 'If an account exists for this email, a one-time code has been sent from support@syncpedia.in.';
        if (!$u) {
            respond(['message' => $genericMsg]);
        }
        $otp = sprintf('%06d', random_int(0, 999999));
        $otpHash = password_hash($otp, PASSWORD_DEFAULT);
        $db->prepare("DELETE FROM password_resets WHERE user_id = ?")->execute([$u['id']]);
        $rid = generateUUID();
        // Store expiry in UTC so PHP/MySQL timezone skew does not expire codes immediately
        $exp = gmdate('Y-m-d H:i:s', time() + 600);
        $db->prepare("INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)")->execute([$rid, $u['id'], $otpHash, $exp]);
        $mailOrgId = trim((string) ($u['org_id'] ?? ''));
        if ($mailOrgId === '' && syncpediaNormalizeRoleKey((string) ($u['role'] ?? '')) === 'super_admin') {
            $syncOrg = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
            $mailOrgId = trim((string) ($syncOrg ? ($syncOrg->fetchColumn() ?: '') : ''));
        }
        syncpediaSetMailContext($mailOrgId !== '' ? $mailOrgId : null, 'password_reset');
        $mail = syncpediaSendPasswordResetOtpEmail($email, (string) ($u['full_name'] ?? ''), $otp);
        if (!($mail['email_sent'] ?? false)) {
            $db->prepare("DELETE FROM password_resets WHERE id = ?")->execute([$rid]);
            $detail = (string) ($mail['email_error'] ?? 'Email send failed');
            respond([
                'error' => 'Could not send the reset code email. ' . $detail,
                'email_error' => $detail,
            ], 503);
        }
        respond(['message' => $genericMsg]);
    }

    if ($action === 'verify_reset_otp') {
        $email = trim($input['email'] ?? '');
        syncpediaRateLimitConsume('auth_otp_' . strtolower($email), 5, 900);
        $otp = trim($input['otp'] ?? '');
        if (!$email || !preg_match('/^\d{6}$/', $otp)) {
            respond(['error' => 'Valid email and 6-digit code are required'], 400);
        }
        ensurePasswordResetsTable($db);
        $stmt = $db->prepare("
            SELECT pr.id AS reset_id, pr.token, pr.user_id
            FROM password_resets pr
            INNER JOIN users u ON u.id = pr.user_id
            WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(?))
              AND u.is_active = 1
              AND pr.expires_at > UTC_TIMESTAMP()
            ORDER BY pr.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([$email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !password_verify($otp, (string) ($row['token'] ?? ''))) {
            respond(['error' => 'Invalid or expired code. Request a new one from Forgot password.'], 400);
        }
        $resetToken = bin2hex(random_bytes(32));
        $exp = gmdate('Y-m-d H:i:s', time() + 900);
        $db->prepare("UPDATE password_resets SET token = ?, expires_at = ? WHERE id = ?")->execute([$resetToken, $exp, $row['reset_id']]);
        respond([
            'message' => 'Code verified. Choose a new password.',
            'reset_token' => $resetToken,
        ]);
    }

    if ($action === 'reset_password') {
        syncpediaRateLimitConsume('auth_reset', 10, 900);
        $token = trim($input['token'] ?? '');
        $newPass = $input['password'] ?? '';
        $minLen = syncpediaMinPasswordLength();
        if (!$token || strlen($newPass) < $minLen) {
            respond(['error' => "Valid verification and new password ({$minLen}+ characters) are required"], 400);
        }
        ensurePasswordResetsTable($db);
        $stmt = $db->prepare("SELECT user_id FROM password_resets WHERE token = ? AND expires_at > UTC_TIMESTAMP()");
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) {
            respond(['error' => 'Your session expired. Request a new code from Forgot password.'], 400);
        }
        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$hash, $row['user_id']]);
        syncpediaStoreUserLoginPassword($db, (string) $row['user_id'], null);
        $db->prepare("DELETE FROM password_resets WHERE token = ?")->execute([$token]);
        respond(['message' => 'Your password has been changed successfully. You can sign in now.']);
    }

    if ($action === 'login') {
        syncpediaRateLimitConsume('auth_login', 10, 900);
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';

        if (!$email || !$password) {
            respond(['error' => 'Email and password are required'], 400);
        }

        $stmt = $db->prepare("SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if (!$user) {
            respond(['error' => 'Invalid email or password'], 401);
        }
        if (!(int)($user['is_active'] ?? 0)) {
            respond(['error' => 'This account is deactivated. Ask your administrator to re-enable it.'], 403);
        }
        $hash = $user['password_hash'] ?? '';
        if ($hash === '' || !password_verify($password, $hash)) {
            respond(['error' => 'Invalid email or password'], 401);
        }

        syncpediaAuditLog($db, ['user_id' => $user['id'], 'org_id' => $user['org_id'] ?? null], 'logged_in', 'auth', (string) $user['id'], 'User logged in');
        respond(authLoginSuccessResponse($db, $user));
    }

    if ($action === 'google_login') {
        syncpediaRateLimitConsume('auth_google', 10, 900);
        $clientId = defined('GOOGLE_CLIENT_ID') ? (string)GOOGLE_CLIENT_ID : '';
        $credential = trim($input['credential'] ?? $input['id_token'] ?? '');
        if (!$credential) {
            respond(['error' => 'Google credential is required'], 400);
        }
        $google = verifyGoogleIdTokenForAuth($credential, $clientId);
        if (isset($google['error'])) {
            respond(['error' => $google['error']], 401);
        }
        $email = $google['email'];
        $stmt = $db->prepare("SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1");
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user) {
            respond(['error' => 'No CRM account for this Google email. Sign up first with the same email, or ask your administrator to create your user.'], 404);
        }
        respond(authLoginSuccessResponse($db, $user));
    }

    if ($action === 'signup') {
        if (!syncpediaPublicSignupEnabled()) {
            respond(['error' => 'Self-registration is disabled. Ask your administrator to create your account.'], 403);
        }
        syncpediaRateLimitConsume('auth_signup', 5, 3600);
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';
        $fullName = trim($input['full_name'] ?? '');
        $role = trim($input['role'] ?? 'sales_representative');
        $inviteCode = trim($input['invite_code'] ?? '');
        $orgSlug = trim($input['org_slug'] ?? '');

        if (!$email || !$password || !$fullName) {
            respond(['error' => 'Email, password, and name are required'], 400);
        }

        $minLen = syncpediaMinPasswordLength();
        if (strlen($password) < $minLen) {
            respond(['error' => "Password must be at least {$minLen} characters"], 400);
        }

        $allowedRoles = ['admin', 'manager', 'sales_representative'];
        if (!in_array($role, $allowedRoles, true)) {
            respond(['error' => 'Invalid role'], 400);
        }

        if (!syncpediaValidateSignupInvite($role, $inviteCode)) {
            respond(['error' => 'Valid invite code is required for registration'], 403);
        }

        if ($role === 'sales_representative' && $orgSlug === '') {
            respond(['error' => 'Organization slug (org_slug) is required for sales registration'], 400);
        }

        $stmt = $db->prepare("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            respond(['error' => 'Email already exists'], 409);
        }

        // Determine org_id
        $orgId = null;
        if ($orgSlug) {
            $ostmt = $db->prepare("SELECT id FROM organizations WHERE slug = ? AND is_active = 1");
            $ostmt->execute([$orgSlug]);
            $orgRow = $ostmt->fetch();
            if ($orgRow) $orgId = $orgRow['id'];
        }

        $id = generateUUID();
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $referralCode = generateUniqueSpReferralCode($db, $fullName);

        $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, role, referral_code, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $email, $hash, $fullName, $role, $referralCode, $orgId]);

        $token = createToken($id, $role, $orgId);

        respond([
            'token' => $token,
            'user' => [
                'id' => $id,
                'email' => $email,
                'full_name' => $fullName,
                'role' => $role,
                'referral_code' => $referralCode,
                'org_id' => $orgId,
            ],
        ], 201);
    }

    if ($action === 'change_password') {
        $tokenData = verifyToken();
        syncpediaRateLimitConsume('change_password_' . ($tokenData['user_id'] ?? ''), 5, 900);
        $current = $input['current_password'] ?? '';
        $newPass = $input['new_password'] ?? '';
        $minLen = syncpediaMinPasswordLength();
        if ($current === '' || strlen($newPass) < $minLen) {
            respond(['error' => "Current password and new password ({$minLen}+ characters) are required"], 400);
        }
        $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$tokenData['user_id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $hash = (string) ($row['password_hash'] ?? '');
        if ($hash === '' || !password_verify($current, $hash)) {
            respond(['error' => 'Current password is incorrect'], 401);
        }
        $newHash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$newHash, $tokenData['user_id']]);
        syncpediaStoreUserLoginPassword($db, (string) $tokenData['user_id'], null);
        respond(['message' => 'Password updated successfully']);
    }

    if ($action === 'update_profile') {
        $tokenData = verifyToken();
        syncpediaRateLimitConsume('update_profile_' . ($tokenData['user_id'] ?? ''), 20, 900);
        $userId = trim((string) ($tokenData['user_id'] ?? ''));
        $fullName = trim((string) ($_POST['full_name'] ?? ''));
        $email = strtolower(trim((string) ($_POST['email'] ?? '')));
        $phone = trim((string) ($_POST['phone'] ?? ''));
        $removeAvatar = (string) ($_POST['remove_avatar'] ?? '0') === '1';

        $nameLength = function_exists('mb_strlen') ? mb_strlen($fullName) : strlen($fullName);
        if ($nameLength < 2 || $nameLength > 100) {
            respond(['error' => 'Full name must contain 2 to 100 characters'], 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
            respond(['error' => 'Enter a valid email address'], 400);
        }
        $compactPhone = preg_replace('/[\s()-]+/', '', $phone) ?? '';
        if ($phone !== '' && !preg_match('/^\+?[0-9]{7,15}$/', $compactPhone)) {
            respond(['error' => 'Enter a valid phone number containing 7 to 15 digits'], 400);
        }

        $currentStmt = $db->prepare('SELECT avatar_url, email FROM users WHERE id = ? LIMIT 1');
        $currentStmt->execute([$userId]);
        $current = $currentStmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($current)) respond(['error' => 'User not found'], 404);

        $duplicateStmt = $db->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1');
        $duplicateStmt->execute([$email, $userId]);
        if ($duplicateStmt->fetchColumn()) {
            respond(['error' => 'This email address is already used by another account'], 409);
        }

        $oldAvatar = trim((string) ($current['avatar_url'] ?? ''));
        $oldEmail = strtolower(trim((string) ($current['email'] ?? '')));
        $avatarUrl = $removeAvatar ? null : ($oldAvatar !== '' ? $oldAvatar : null);
        $newAvatarPath = null;
        $avatar = $_FILES['avatar'] ?? null;
        if (is_array($avatar) && (int) ($avatar['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            $uploadError = (int) ($avatar['error'] ?? UPLOAD_ERR_NO_FILE);
            if ($uploadError !== UPLOAD_ERR_OK) respond(['error' => 'Profile photo upload failed'], 400);
            $size = (int) ($avatar['size'] ?? 0);
            if ($size < 1 || $size > 2 * 1024 * 1024) {
                respond(['error' => 'Profile photo must be no larger than 2 MB'], 400);
            }
            $tmpName = (string) ($avatar['tmp_name'] ?? '');
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($tmpName);
            $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
            if (!is_string($mime) || !isset($extensions[$mime])) {
                respond(['error' => 'Profile photo must be a JPG, PNG, or WebP image'], 400);
            }
            $avatarDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'avatars';
            if (!is_dir($avatarDir) && !mkdir($avatarDir, 0755, true) && !is_dir($avatarDir)) {
                respond(['error' => 'Could not create profile photo storage'], 500);
            }
            $fileName = generateUUID() . '.' . $extensions[$mime];
            $newAvatarPath = $avatarDir . DIRECTORY_SEPARATOR . $fileName;
            if (!move_uploaded_file($tmpName, $newAvatarPath)) {
                respond(['error' => 'Could not store profile photo'], 500);
            }
            $avatarUrl = '/uploads/avatars/' . $fileName;
        }

        try {
            $update = $db->prepare('UPDATE users SET full_name = ?, email = ?, phone = ?, avatar_url = ? WHERE id = ?');
            $update->execute([$fullName, $email, $phone !== '' ? $phone : null, $avatarUrl, $userId]);
        } catch (Throwable $e) {
            if ($newAvatarPath !== null && is_file($newAvatarPath)) @unlink($newAvatarPath);
            if (stripos($e->getMessage(), 'duplicate') !== false || (string) $e->getCode() === '23000') {
                respond(['error' => 'This email address is already used by another account'], 409);
            }
            throw $e;
        }

        if ($oldEmail !== $email) {
            try {
                $db->prepare('UPDATE marketing_members SET email = ? WHERE user_id = ?')->execute([$email, $userId]);
            } catch (Throwable $e) {
            }
        }

        if ($oldAvatar !== '' && $oldAvatar !== $avatarUrl && strpos($oldAvatar, '/uploads/avatars/') === 0) {
            $oldAvatarPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'avatars'
                . DIRECTORY_SEPARATOR . basename($oldAvatar);
            if (is_file($oldAvatarPath)) @unlink($oldAvatarPath);
        }
        syncpediaAuditLog($db, $tokenData, 'updated_profile', 'user', $userId, 'Updated personal profile');
        respond(['message' => 'Profile updated successfully']);
    }

    if ($action === 'me') {
        $tokenData = verifyToken();
        $stmt = $db->prepare("SELECT id, email, full_name, phone, avatar_url, role, referral_code, org_id FROM users WHERE id = ?");
        $stmt->execute([$tokenData['user_id']]);
        $user = $stmt->fetch();
        if (!$user) respond(['error' => 'User not found'], 404);

        // Keep role consistent with login behavior for portal routing
        $normalizedRole = normalizeRoleForPortal($user['role'] ?? '');
        if ($normalizedRole !== 'marketing' && $normalizedRole !== 'super_admin') {
            $mstmt = $db->prepare("SELECT id FROM marketing_members WHERE user_id = ? OR email = ? LIMIT 1");
            $mstmt->execute([$user['id'], $user['email']]);
            if ($mstmt->fetch()) {
                $normalizedRole = 'marketing';
            }
        }
        $user['role'] = $normalizedRole;
        $user['referral_code'] = ensureUserSpReferralCode($db, $user['id']);
        ensureUsersPageAccessColumn($db);
        try {
            $pa = $db->prepare('SELECT page_access_json FROM users WHERE id = ? LIMIT 1');
            $pa->execute([$user['id']]);
            $user['page_access_json'] = $pa->fetchColumn() ?: null;
        } catch (Throwable $e) {
            $user['page_access_json'] = null;
        }
        userAttachPageAccess($user);

        // JWT org context: super_admin uses switch_org token only; others fall back to users.org_id
        $effectiveOrgId = trim((string) ($tokenData['org_id'] ?? ''));
        if ($normalizedRole !== 'super_admin' && $effectiveOrgId === '') {
            $effectiveOrgId = trim((string) ($user['org_id'] ?? ''));
        }
        if ($effectiveOrgId !== '') {
            $user['org_id'] = $effectiveOrgId;
        }

        $org = null;
        if ($effectiveOrgId !== '') {
            $ostmt = $db->prepare("SELECT id, name, slug, logo_url, plan FROM organizations WHERE id = ? AND is_active = 1");
            $ostmt->execute([$effectiveOrgId]);
            $org = $ostmt->fetch();
            if ($org) {
                $fstmt = $db->prepare("SELECT feature, enabled FROM org_features WHERE org_id = ?");
                $fstmt->execute([$effectiveOrgId]);
                $features = [];
                foreach ($fstmt->fetchAll() as $f) {
                    $features[$f['feature']] = (int) ($f['enabled'] ?? 0) === 1;
                }
                $org['features'] = $features;
            }
        }

        respond(['user' => $user, 'organization' => $org]);
    }

    // Super admin: switch org context
    if ($action === 'switch_org') {
        $tokenData = verifyToken();
        requireRole($tokenData, ['super_admin']);
        $targetOrgId = $input['org_id'] ?? null;
        
        // Re-issue token with new org context
        $token = createToken($tokenData['user_id'], $tokenData['role'], $targetOrgId);
        
        $org = null;
        if ($targetOrgId) {
            $ostmt = $db->prepare("SELECT id, name, slug, logo_url, plan FROM organizations WHERE id = ?");
            $ostmt->execute([$targetOrgId]);
            $org = $ostmt->fetch();
            if ($org) {
                $fstmt = $db->prepare("SELECT feature, enabled FROM org_features WHERE org_id = ?");
                $fstmt->execute([$targetOrgId]);
                $features = [];
                foreach ($fstmt->fetchAll() as $f) {
                    $features[$f['feature']] = (int) ($f['enabled'] ?? 0) === 1;
                }
                $org['features'] = $features;
            }
        }
        
        respond(['token' => $token, 'organization' => $org]);
    }
}

respond(['error' => 'Invalid action'], 400);
