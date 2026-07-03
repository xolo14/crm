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
            token VARCHAR(128) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE (token)
        )");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)');
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
    if ($r === 'admin' || $r === 'org') {
        return '/admin';
    }

    return '/login';
}

// Secret invite codes for role-based signup
define('INVITE_CODES', [
    'admin' => 'SYNC-ADMIN-2026',
    'manager' => 'SYNC-MG-2026',
    'sales_representative' => 'SYNC-REP-2024',
]);

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
    if ($normalizedRole !== 'marketing' && $normalizedRole !== 'sales_marketing' && $normalizedRole !== 'super_admin') {
        $mstmt = $db->prepare("SELECT id FROM marketing_members WHERE user_id = ? OR email = ? LIMIT 1");
        $mstmt->execute([$user['id'], $user['email']]);
        if ($mstmt->fetch()) {
            $normalizedRole = 'marketing';
        }
    }
    $user['role'] = $normalizedRole;

    $token = createToken($user['id'], $user['role'], $user['org_id']);
    unset($user['password_hash'], $user['is_active']);

    $org = null;
    if (!empty($user['org_id'])) {
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
        $email = trim($input['email'] ?? '');
        if (!$email) {
            respond(['error' => 'Email is required'], 400);
        }
        ensurePasswordResetsTable($db);
        $stmt = $db->prepare("SELECT id, full_name, role FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND is_active = 1");
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
        $exp = date('Y-m-d H:i:s', time() + 600);
        $db->prepare("INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)")->execute([$rid, $u['id'], $otpHash, $exp]);
        $mail = syncpediaSendPasswordResetOtpEmail($email, (string) ($u['full_name'] ?? ''), $otp);
        if (!($mail['email_sent'] ?? false)) {
            $db->prepare("DELETE FROM password_resets WHERE id = ?")->execute([$rid]);
            respond([
                'error' => 'Could not send the reset code email. Check SMTP settings in api/config.php or try again later.',
                'email_error' => $mail['email_error'] ?? 'Email send failed',
            ], 503);
        }
        respond(['message' => $genericMsg]);
    }

    if ($action === 'verify_reset_otp') {
        $email = trim($input['email'] ?? '');
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
              AND pr.expires_at > NOW()
            ORDER BY pr.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([$email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !password_verify($otp, (string) ($row['token'] ?? ''))) {
            respond(['error' => 'Invalid or expired code. Request a new one from Forgot password.'], 400);
        }
        $resetToken = bin2hex(random_bytes(32));
        $exp = date('Y-m-d H:i:s', time() + 900);
        $db->prepare("UPDATE password_resets SET token = ?, expires_at = ? WHERE id = ?")->execute([$resetToken, $exp, $row['reset_id']]);
        respond([
            'message' => 'Code verified. Choose a new password.',
            'reset_token' => $resetToken,
        ]);
    }

    if ($action === 'reset_password') {
        $token = trim($input['token'] ?? '');
        $newPass = $input['password'] ?? '';
        if (!$token || strlen($newPass) < 6) {
            respond(['error' => 'Valid verification and new password (6+ characters) are required'], 400);
        }
        ensurePasswordResetsTable($db);
        $stmt = $db->prepare("SELECT user_id FROM password_resets WHERE token = ? AND expires_at > NOW()");
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) {
            respond(['error' => 'Your session expired. Request a new code from Forgot password.'], 400);
        }
        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$hash, $row['user_id']]);
        $db->prepare("DELETE FROM password_resets WHERE token = ?")->execute([$token]);
        respond(['message' => 'Your password has been changed successfully. You can sign in now.']);
    }

    if ($action === 'login') {
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

        respond(authLoginSuccessResponse($db, $user));
    }

    if ($action === 'google_login') {
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
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';
        $fullName = trim($input['full_name'] ?? '');
        $role = trim($input['role'] ?? 'sales_representative');
        $inviteCode = trim($input['invite_code'] ?? '');
        $orgSlug = trim($input['org_slug'] ?? '');

        if (!$email || !$password || !$fullName) {
            respond(['error' => 'Email, password, and name are required'], 400);
        }

        if (strlen($password) < 6) {
            respond(['error' => 'Password must be at least 6 characters'], 400);
        }

        // Validate role
        $allowedRoles = ['admin', 'manager', 'sales_representative'];
        if (!in_array($role, $allowedRoles)) {
            respond(['error' => 'Invalid role'], 400);
        }

        // Validate invite code (not required for sales_representative)
        if ($role !== 'sales_representative') {
            if (!$inviteCode || !isset(INVITE_CODES[$role]) || INVITE_CODES[$role] !== $inviteCode) {
                respond(['error' => 'Invalid invite code for this role'], 403);
            }
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

    if ($action === 'me') {
        $tokenData = verifyToken();
        $stmt = $db->prepare("SELECT id, email, full_name, phone, avatar_url, role, referral_code, org_id FROM users WHERE id = ?");
        $stmt->execute([$tokenData['user_id']]);
        $user = $stmt->fetch();
        if (!$user) respond(['error' => 'User not found'], 404);

        // Keep role consistent with login behavior for portal routing
        $normalizedRole = normalizeRoleForPortal($user['role'] ?? '');
        if ($normalizedRole !== 'marketing' && $normalizedRole !== 'sales_marketing' && $normalizedRole !== 'super_admin') {
            $mstmt = $db->prepare("SELECT id FROM marketing_members WHERE user_id = ? OR email = ? LIMIT 1");
            $mstmt->execute([$user['id'], $user['email']]);
            if ($mstmt->fetch()) {
                $normalizedRole = 'marketing';
            }
        }
        $user['role'] = $normalizedRole;
        $user['referral_code'] = ensureUserSpReferralCode($db, $user['id']);

        // Get org info
        $org = null;
        if ($user['org_id']) {
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
        }
        
        respond(['token' => $token, 'organization' => $org]);
    }
}

respond(['error' => 'Invalid action'], 400);
