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

/** @param array<string,mixed> $user */
function authAttachResultAssessment(PDO $db, array &$user): void
{
    ensureUsersResultAssessmentColumn($db);
    try {
        $st = $db->prepare('SELECT result_assessment_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([(string) ($user['id'] ?? '')]);
        $id = trim((string) ($st->fetchColumn() ?: ''));
        $user['result_assessment_id'] = $id !== '' ? $id : null;
    } catch (Throwable $e) {
        $user['result_assessment_id'] = null;
    }
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
    if ($normalizedRole !== 'marketing' && $normalizedRole !== 'super_admin' && $normalizedRole !== 'assessment_viewer') {
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
    authAttachResultAssessment($db, $user);

    // Super admin master panel: no org in JWT until switch_org selects a tenant.
    $tokenOrgId = $user['org_id'] ?? null;
    if ($normalizedRole === 'super_admin') {
        $tokenOrgId = null;
    }
    $token = createToken($user['id'], $user['role'], $tokenOrgId);
    syncpediaIssueAuthCookie($token);
    unset($user['password_hash'], $user['is_active']);

    $org = null;
    if ($normalizedRole !== 'super_admin' && !empty($user['org_id'])) {
        $org = syncpediaFetchOrganization($db, (string) $user['org_id'], true);

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

function ensureSuperAdminEmailLoginTables(PDO $db): void
{
    static $ok = false;
    if ($ok) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS super_admin_allowed_emails (
                id CHAR(36) NOT NULL,
                email VARCHAR(255) NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by CHAR(36) DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_super_admin_allowed_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
        $db->exec(
            "CREATE TABLE IF NOT EXISTS super_admin_login_approvals (
                id CHAR(36) NOT NULL,
                user_id CHAR(36) NOT NULL,
                email VARCHAR(255) NOT NULL,
                token_hash CHAR(64) NOT NULL,
                ip VARCHAR(64) DEFAULT NULL,
                user_agent VARCHAR(512) DEFAULT NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'pending',
                expires_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                approved_at DATETIME DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_sa_login_token (token_hash),
                KEY idx_sa_login_user (user_id),
                KEY idx_sa_login_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
        try {
            $db->exec('ALTER TABLE super_admin_login_approvals ADD COLUMN poll_token_hash CHAR(64) NULL');
        } catch (Throwable $e) {
        }
        try {
            $db->exec('CREATE UNIQUE INDEX uq_sa_login_poll ON super_admin_login_approvals (poll_token_hash)');
        } catch (Throwable $e) {
        }
    } catch (Throwable $e) {
        error_log('[auth] super_admin email login tables: ' . $e->getMessage());
    }
    $ok = true;
}

function syncpediaAuthPublicOrigin(): string
{
    foreach (['FRONTEND_URL', 'CRM_PUBLIC_URL'] as $const) {
        if (defined($const)) {
            $v = trim((string) constant($const));
            if ($v !== '' && stripos($v, 'your-domain') === false && stripos($v, 'example.com') === false) {
                return rtrim($v, '/');
            }
        }
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') {
        return '';
    }
    return ($https ? 'https' : 'http') . '://' . $host;
}

function syncpediaIsSuperAdminAllowedEmail(PDO $db, string $email): bool
{
    $email = strtolower(trim($email));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    ensureSuperAdminEmailLoginTables($db);
    $st = $db->prepare('SELECT id FROM super_admin_allowed_emails WHERE LOWER(TRIM(email)) = ? LIMIT 1');
    $st->execute([$email]);
    return (bool) $st->fetchColumn();
}

/**
 * Super Admin account for a Google / magic-link address: profile email, else allowlist owner.
 *
 * @return array<string,mixed>|null
 */
function syncpediaResolveSuperAdminUserByLoginEmail(PDO $db, string $email): ?array
{
    $email = strtolower(trim($email));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    ensureSuperAdminEmailLoginTables($db);
    $stmt = $db->prepare(
        'SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active
         FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1'
    );
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (
        is_array($user)
        && (int) ($user['is_active'] ?? 0)
        && normalizeRoleForPortal((string) ($user['role'] ?? '')) === 'super_admin'
    ) {
        return $user;
    }
    $own = $db->prepare(
        'SELECT created_by FROM super_admin_allowed_emails WHERE LOWER(TRIM(email)) = ? LIMIT 1'
    );
    $own->execute([$email]);
    $ownerId = trim((string) ($own->fetchColumn() ?: ''));
    if ($ownerId === '') {
        return null;
    }
    $ust = $db->prepare(
        'SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active
         FROM users WHERE id = ? LIMIT 1'
    );
    $ust->execute([$ownerId]);
    $user = $ust->fetch(PDO::FETCH_ASSOC);
    if (
        !is_array($user)
        || !(int) ($user['is_active'] ?? 0)
        || normalizeRoleForPortal((string) ($user['role'] ?? '')) !== 'super_admin'
    ) {
        return null;
    }
    return $user;
}

function syncpediaRoleRequiresEmailChangeOtp(string $role): bool
{
    return in_array(normalizeRoleForPortal($role), ['super_admin', 'org', 'admin'], true);
}

function ensureEmailChangeOtpsTable(PDO $db): void
{
    static $ok = false;
    if ($ok) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS email_change_otps (
                id CHAR(36) NOT NULL,
                user_id CHAR(36) NOT NULL,
                purpose VARCHAR(40) NOT NULL,
                payload TEXT NOT NULL,
                token_hash VARCHAR(255) NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_email_change_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (Throwable $e) {
        error_log('[auth] email_change_otps: ' . $e->getMessage());
    }
    $ok = true;
}

function syncpediaSuperAdminEmailLoginHtml(string $title, string $body, bool $ok = false): void
{
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    http_response_code($ok ? 200 : 400);
    header('Content-Type: text/html; charset=UTF-8');
    $t = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $b = htmlspecialchars($body, ENT_QUOTES, 'UTF-8');
    $color = $ok ? '#15803d' : '#b91c1c';
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . $t . '</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;">'
        . '<h1 style="font-size:1.25rem;color:' . $color . ';">' . $t . '</h1>'
        . '<p style="color:#334155;line-height:1.5;">' . $b . '</p>'
        . '<p><a href="/super_admin" style="color:#2563eb;">Back to Super Admin login</a></p>'
        . '</body></html>';
    exit;
}

function syncpediaSuperAdminEmailLoginRedirectToApp(): void
{
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    $origin = rtrim(syncpediaAuthPublicOrigin(), '/');
    $to = ($origin !== '' ? $origin : '') . '/super_admin?email_ok=1';
    header('Location: ' . $to, true, 302);
    header('Cache-Control: no-store');
    exit;
}

// GET: email-link login is disabled; Super Admin uses Google or password.
if ($method === 'GET' && (($_GET['action'] ?? '') === 'approve_super_admin_login')) {
    syncpediaSuperAdminEmailLoginHtml(
        'Email login is off',
        'Sign in at Super Admin with Google or email and password.'
    );
    ensureSuperAdminEmailLoginTables($db);
    $raw = trim((string) ($_GET['token'] ?? ''));
    if ($raw === '' || !preg_match('/^[a-f0-9]{64}$/', $raw)) {
        syncpediaSuperAdminEmailLoginHtml('Invalid link', 'This login link is invalid or incomplete.');
    }
    $hash = hash('sha256', $raw);
    $st = $db->prepare(
        "SELECT id, user_id, email, status, expires_at FROM super_admin_login_approvals
         WHERE token_hash = ? LIMIT 1"
    );
    $st->execute([$hash]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        syncpediaSuperAdminEmailLoginHtml('Invalid link', 'This login link was not found. Request a new one from the login page.');
    }
    $approvalStatus = (string) ($row['status'] ?? '');
    if ($approvalStatus === 'used') {
        syncpediaSuperAdminEmailLoginHtml('Already used', 'This login link was already used. Request a new one if you need to sign in again.');
    }
    if ($approvalStatus !== 'pending' && $approvalStatus !== 'approved') {
        syncpediaSuperAdminEmailLoginHtml('Link expired', 'This login link is no longer valid. Request a new email from the Super Admin login page.');
    }
    $exp = strtotime((string) ($row['expires_at'] ?? '') . ' UTC');
    if ($exp === false || $exp < time()) {
        $db->prepare("UPDATE super_admin_login_approvals SET status = 'expired' WHERE id = ?")->execute([(string) $row['id']]);
        syncpediaSuperAdminEmailLoginHtml('Link expired', 'This login link has expired. Go back to the Super Admin login page and request a new email.');
    }
    $requestEmail = strtolower(trim((string) ($row['email'] ?? '')));
    $resolved = $requestEmail !== '' ? syncpediaResolveSuperAdminUserByLoginEmail($db, $requestEmail) : null;
    if (!$resolved || (string) ($resolved['id'] ?? '') !== (string) ($row['user_id'] ?? '')) {
        syncpediaSuperAdminEmailLoginHtml('Not allowed', 'This email is no longer allowed for Super Admin login.');
    }
    if (!(int) ($resolved['is_active'] ?? 0)) {
        syncpediaSuperAdminEmailLoginHtml('Account deactivated', 'This account is deactivated.');
    }
    $db->beginTransaction();
    try {
        $lock = $db->prepare('SELECT status FROM super_admin_login_approvals WHERE id = ? FOR UPDATE');
        $lock->execute([(string) $row['id']]);
        $lockedStatus = (string) ($lock->fetchColumn() ?: '');
        if ($lockedStatus === 'used') {
            $db->commit();
            syncpediaSuperAdminEmailLoginHtml('Already used', 'This login link was already used. Request a new one if you need to sign in again.');
        }
        if ($lockedStatus !== 'pending' && $lockedStatus !== 'approved') {
            $db->commit();
            syncpediaSuperAdminEmailLoginHtml('Link expired', 'This login link is no longer valid. Request a new email from the Super Admin login page.');
        }
        $db->prepare(
            "UPDATE super_admin_login_approvals SET status = 'used', approved_at = UTC_TIMESTAMP() WHERE id = ? AND status IN ('pending', 'approved')"
        )->execute([(string) $row['id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        syncpediaSuperAdminEmailLoginHtml('Could not complete login', 'Try the link again, or request a new email from the Super Admin login page.');
    }
    syncpediaAuditLog(
        $db,
        ['user_id' => $resolved['id'], 'org_id' => $resolved['org_id'] ?? null],
        'logged_in',
        'auth',
        (string) $resolved['id'],
        'Super admin email login completed in the browser that opened the mail'
    );
    authLoginSuccessResponse($db, $resolved);
    syncpediaSuperAdminEmailLoginRedirectToApp();
}

if (($_GET['action'] ?? '') === 'google_config') {
    $clientId = defined('GOOGLE_CLIENT_ID') ? trim((string) GOOGLE_CLIENT_ID) : '';
    respond([
        'client_id' => $clientId,
        'enabled' => $clientId !== '',
    ]);
}

if ($method === 'POST') {
    // Prefer query for backward compatibility; accept action in JSON body (Android app).
    $action = $_GET['action'] ?? ($input['action'] ?? '');
    if ($action === '' || $action === null) {
        respond(['error' => 'Invalid action'], 400);
    }

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

    if ($action === 'request_super_admin_email_login') {
        respond(['error' => 'Email login is turned off. Use Google or email and password.'], 403);
        syncpediaRateLimitConsume('sa_email_login', 5, 900);
        ensureSuperAdminEmailLoginTables($db);
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(['error' => 'Enter a valid email address'], 400);
        }
        $generic = [
            'status' => 'approval_sent',
            'message' => 'If this email is allowed for Super Admin login, a confirmation link has been sent. Click Yes in the email to sign in.',
        ];
        $user = syncpediaResolveSuperAdminUserByLoginEmail($db, $email);
        if (!$user) {
            respond($generic);
        }
        $db->prepare(
            "UPDATE super_admin_login_approvals SET status = 'expired'
             WHERE user_id = ? AND status = 'pending'"
        )->execute([(string) $user['id']]);
        $rawToken = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $rawToken);
        $rawPoll = bin2hex(random_bytes(32));
        $pollHash = hash('sha256', $rawPoll);
        $aid = generateUUID();
        $exp = gmdate('Y-m-d H:i:s', time() + 900);
        $ip = function_exists('syncpediaClientIp') ? syncpediaClientIp() : (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 512);
        $db->prepare(
            'INSERT INTO super_admin_login_approvals
             (id, user_id, email, token_hash, poll_token_hash, ip, user_agent, status, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, \'pending\', ?)'
        )->execute([$aid, $user['id'], $email, $tokenHash, $pollHash, $ip !== '' ? $ip : null, $ua !== '' ? $ua : null, $exp]);

        $origin = syncpediaAuthPublicOrigin();
        $approveUrl = ($origin !== '' ? $origin : '') . '/api/auth.php?action=approve_super_admin_login&token=' . rawurlencode($rawToken);
        $name = trim((string) ($user['full_name'] ?? 'Super Admin'));
        $safeName = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        $safeIp = htmlspecialchars($ip !== '' ? $ip : 'unknown', ENT_QUOTES, 'UTF-8');
        $safeUrl = htmlspecialchars($approveUrl, ENT_QUOTES, 'UTF-8');
        $html = '<div style="font-family:system-ui,sans-serif;max-width:32rem;margin:0 auto;color:#0f172a;">'
            . '<h2 style="font-size:1.25rem;">Super Admin login request</h2>'
            . '<p>Hi ' . $safeName . ',</p>'
            . '<p>Someone requested access to the Syncpedia Super Admin portal with this email. Clicking Yes signs you in on <strong>this device</strong> (the one where you open the email).</p>'
            . '<p style="font-size:0.875rem;color:#64748b;">IP: ' . $safeIp . '<br>Link expires in 15 minutes.</p>'
            . '<p style="margin:1.5rem 0;"><a href="' . $safeUrl . '" style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;padding:0.75rem 1.25rem;border-radius:0.5rem;font-weight:600;">Yes, log me in</a></p>'
            . '<p style="font-size:0.8rem;color:#64748b;">If you did not request this, ignore this email.</p>'
            . '</div>';

        $mailOrgId = '';
        $syncOrg = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
        $mailOrgId = trim((string) ($syncOrg ? ($syncOrg->fetchColumn() ?: '') : ''));
        syncpediaSetMailContext($mailOrgId !== '' ? $mailOrgId : null, 'default');
        $mail = syncpediaSendHtmlEmail($email, 'Approve Super Admin login — Syncpedia CRM', $html, 'default');
        if (empty($mail['ok'])) {
            $db->prepare('DELETE FROM super_admin_login_approvals WHERE id = ?')->execute([$aid]);
            respond([
                'error' => 'Could not send the login email. ' . (string) ($mail['error'] ?? 'SMTP failed'),
            ], 503);
        }
        $generic['poll_token'] = $rawPoll;
        respond($generic);
    }

    if ($action === 'super_admin_email_login_status') {
        respond(['status' => 'invalid']);
        ensureSuperAdminEmailLoginTables($db);
        $rawPoll = trim((string) ($input['poll_token'] ?? ''));
        if ($rawPoll === '' || !preg_match('/^[a-f0-9]{64}$/', $rawPoll)) {
            respond(['status' => 'invalid']);
        }
        $pollHash = hash('sha256', $rawPoll);
        $st = $db->prepare(
            'SELECT id, user_id, email, status, expires_at FROM super_admin_login_approvals WHERE poll_token_hash = ? LIMIT 1'
        );
        $st->execute([$pollHash]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            respond(['status' => 'invalid']);
        }
        $exp = strtotime((string) ($row['expires_at'] ?? '') . ' UTC');
        if ($exp === false || $exp < time()) {
            $db->prepare("UPDATE super_admin_login_approvals SET status = 'expired' WHERE id = ? AND status IN ('pending', 'approved')")
                ->execute([(string) $row['id']]);
            respond(['status' => 'expired']);
        }
        $approvalStatus = (string) ($row['status'] ?? '');
        if ($approvalStatus === 'pending') {
            respond(['status' => 'pending']);
        }
        if ($approvalStatus !== 'approved') {
            respond(['status' => $approvalStatus === 'used' ? 'used' : 'expired']);
        }
        $requestEmail = strtolower(trim((string) ($row['email'] ?? '')));
        $ust = $db->prepare(
            'SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active
             FROM users WHERE id = ? LIMIT 1'
        );
        $ust->execute([(string) $row['user_id']]);
        $user = $ust->fetch(PDO::FETCH_ASSOC);
        if (
            $requestEmail === ''
            || !syncpediaIsSuperAdminAllowedEmail($db, $requestEmail)
            || !$user
            || !(int) ($user['is_active'] ?? 0)
            || normalizeRoleForPortal((string) ($user['role'] ?? '')) !== 'super_admin'
        ) {
            $db->prepare("UPDATE super_admin_login_approvals SET status = 'expired' WHERE id = ? AND status = 'approved'")
                ->execute([(string) $row['id']]);
            respond(['status' => 'expired']);
        }
        $db->beginTransaction();
        try {
            $lock = $db->prepare(
                'SELECT status FROM super_admin_login_approvals WHERE id = ? FOR UPDATE'
            );
            $lock->execute([(string) $row['id']]);
            $lockedStatus = (string) ($lock->fetchColumn() ?: '');
            if ($lockedStatus !== 'approved') {
                $db->commit();
                respond(['status' => $lockedStatus === 'used' ? 'used' : 'expired']);
            }
            $db->prepare(
                "UPDATE super_admin_login_approvals SET status = 'used' WHERE id = ? AND status = 'approved'"
            )->execute([(string) $row['id']]);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            respond(['status' => 'pending']);
        }
        syncpediaAuditLog(
            $db,
            ['user_id' => $user['id'], 'org_id' => $user['org_id'] ?? null],
            'logged_in',
            'auth',
            (string) $user['id'],
            'Super admin email login completed on the waiting browser'
        );
        $session = authLoginSuccessResponse($db, $user);
        respond(array_merge(['status' => 'signed_in'], $session));
    }

    if ($action === 'list_super_admin_login_emails') {
        $tokenData = verifyToken();
        requireRole($tokenData, ['super_admin']);
        ensureSuperAdminEmailLoginTables($db);
        $rows = $db->query(
            'SELECT id, email, created_at FROM super_admin_allowed_emails ORDER BY created_at ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        respond(['emails' => $rows ?: [], 'max' => 2]);
    }

    if ($action === 'save_super_admin_login_emails') {
        $tokenData = verifyToken();
        requireRole($tokenData, ['super_admin']);
        ensureSuperAdminEmailLoginTables($db);
        $ownerId = trim((string) ($tokenData['user_id'] ?? ''));
        if ($ownerId === '') {
            respond(['error' => 'Unauthorized'], 401);
        }
        $raw = $input['emails'] ?? [];
        if (!is_array($raw)) {
            respond(['error' => 'emails must be an array'], 400);
        }
        $cleaned = [];
        foreach ($raw as $item) {
            $e = strtolower(trim((string) $item));
            if ($e === '') {
                continue;
            }
            if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
                respond(['error' => "Invalid email: {$e}"], 400);
            }
            $cleaned[] = $e;
        }
        $cleaned = array_values(array_unique($cleaned));
        if (count($cleaned) > 2) {
            respond(['error' => 'Maximum of 2 Super Admin login emails'], 400);
        }
        $cur = $db->query('SELECT email FROM super_admin_allowed_emails ORDER BY created_at ASC')->fetchAll(PDO::FETCH_COLUMN);
        $curNorm = [];
        foreach (is_array($cur) ? $cur : [] as $existing) {
            $e = strtolower(trim((string) $existing));
            if ($e !== '') {
                $curNorm[] = $e;
            }
        }
        if ($curNorm !== $cleaned) {
            respond(['error' => 'Verify the code sent to your current email before changing Super Admin login emails.'], 403);
        }
        $db->exec('DELETE FROM super_admin_allowed_emails');
        $ins = $db->prepare(
            'INSERT INTO super_admin_allowed_emails (id, email, created_by) VALUES (?, ?, ?)'
        );
        foreach ($cleaned as $e) {
            $ins->execute([generateUUID(), $e, $ownerId]);
        }
        $rows = $db->query(
            'SELECT id, email, created_at FROM super_admin_allowed_emails ORDER BY created_at ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        respond(['ok' => true, 'emails' => $rows ?: [], 'max' => 2]);
    }

    if ($action === 'add_super_admin_login_email' || $action === 'remove_super_admin_login_email') {
        $tokenData = verifyToken();
        requireRole($tokenData, ['super_admin']);
        respond(['error' => 'Verify the code sent to your current email before changing Super Admin login emails.'], 403);
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
        syncpediaBumpUserTokenVersion($db, (string) $row['user_id']);
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

        // Per-account lockout (IP-agnostic): the per-IP limiter above does not stop a
        // distributed credential-stuffing attack against one account from many IPs.
        $acctKey = hash('sha256', 'auth_login_acct|' . mb_strtolower(trim($email)));
        syncpediaRateLimitConsumeByKey($acctKey, 20, 900);

        $stmt = $db->prepare("SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        // Always run password_verify(), even for an unknown email, against a dummy hash computed
        // with the same algorithm/cost as real passwords — this makes the "no such account" and
        // "wrong password" paths take comparable time, so an attacker cannot use response timing
        // to enumerate which emails have accounts. (No real account has this as its password.)
        static $dummyHash = null;
        if ($dummyHash === null) {
            $dummyHash = password_hash('a-dummy-password-used-only-for-timing-parity', PASSWORD_DEFAULT);
        }
        $hash = $user ? (string) ($user['password_hash'] ?? '') : $dummyHash;
        $passwordOk = $hash !== '' && password_verify($password, $hash);

        if (!$user || !$passwordOk) {
            respond(['error' => 'Invalid email or password'], 401);
        }
        // Only disclose deactivation status once the password itself was confirmed correct —
        // otherwise a wrong-password guess against a deactivated account's email would reveal
        // that the account exists and is deactivated, without ever knowing the real password.
        if (!(int)($user['is_active'] ?? 0)) {
            respond(['error' => 'This account is deactivated. Ask your administrator to re-enable it.'], 403);
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
        $portal = strtolower(trim((string) ($input['portal'] ?? '')));
        $user = null;
        if ($portal === 'super_admin') {
            $user = syncpediaResolveSuperAdminUserByLoginEmail($db, $email);
            if (!$user) {
                respond(['error' => 'This Google account is not allowed for Super Admin sign-in.'], 403);
            }
        } else {
            $stmt = $db->prepare("SELECT id, email, password_hash, full_name, phone, avatar_url, role, referral_code, org_id, is_active FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1");
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user) {
                respond(['error' => 'No CRM account for this Google email. Sign up first with the same email, or ask your administrator to create your user.'], 404);
            }
        }
        syncpediaAuditLog($db, ['user_id' => $user['id'], 'org_id' => $user['org_id'] ?? null], 'logged_in', 'auth', (string) $user['id'], 'User logged in with Google');
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
        $referralCode = $orgId
            ? referralCodeForNewOrgUser($db, (string) $orgId, $role, $fullName)
            : generateUniqueSpReferralCode($db, $fullName);

        $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, role, referral_code, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $email, $hash, $fullName, $role, $referralCode, $orgId]);

        $token = createToken($id, $role, $orgId);
        syncpediaIssueAuthCookie($token);

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

    if ($action === 'logout') {
        syncpediaClearAuthCookie();
        respond(['ok' => true, 'message' => 'Signed out']);
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
        syncpediaBumpUserTokenVersion($db, (string) $tokenData['user_id']);
        respond(['message' => 'Password updated successfully. Please sign in again.']);
    }

    if ($action === 'request_email_change_otp') {
        $tokenData = verifyToken();
        syncpediaRateLimitConsume('email_change_otp_' . ($tokenData['user_id'] ?? ''), 5, 900);
        $userId = trim((string) ($tokenData['user_id'] ?? ''));
        $st = $db->prepare('SELECT id, email, full_name, role, org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $me = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($me)) {
            respond(['error' => 'User not found'], 404);
        }
        if (!syncpediaRoleRequiresEmailChangeOtp((string) ($me['role'] ?? ''))) {
            respond(['error' => 'Email verification is not required for this account'], 403);
        }
        $oldEmail = strtolower(trim((string) ($me['email'] ?? '')));
        $newEmail = strtolower(trim((string) ($input['new_email'] ?? '')));
        $loginEmailsRaw = $input['login_emails'] ?? null;
        $loginEmails = null;
        if (is_array($loginEmailsRaw)) {
            $loginEmails = [];
            foreach ($loginEmailsRaw as $item) {
                $e = strtolower(trim((string) $item));
                if ($e === '') {
                    continue;
                }
                if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
                    respond(['error' => "Invalid login email: {$e}"], 400);
                }
                $loginEmails[] = $e;
            }
            $loginEmails = array_values(array_unique($loginEmails));
            if (count($loginEmails) > 2) {
                respond(['error' => 'Maximum of 2 Super Admin login emails'], 400);
            }
            if (normalizeRoleForPortal((string) ($me['role'] ?? '')) !== 'super_admin') {
                respond(['error' => 'Only Super Admin can change extra login emails'], 403);
            }
        }
        if ($newEmail === '') {
            $newEmail = $oldEmail;
        }
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL) || strlen($newEmail) > 255) {
            respond(['error' => 'Enter a valid email address'], 400);
        }
        $emailChanging = $newEmail !== $oldEmail;
        $loginChanging = false;
        if ($loginEmails !== null) {
            ensureSuperAdminEmailLoginTables($db);
            $cur = $db->query('SELECT email FROM super_admin_allowed_emails ORDER BY created_at ASC')->fetchAll(PDO::FETCH_COLUMN);
            $curNorm = array_map(static function ($e) {
                return strtolower(trim((string) $e));
            }, is_array($cur) ? $cur : []);
            $loginChanging = $curNorm !== $loginEmails;
        }
        if (!$emailChanging && !$loginChanging) {
            respond(['error' => 'No email changes to verify'], 400);
        }
        if ($emailChanging) {
            $dup = $db->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1');
            $dup->execute([$newEmail, $userId]);
            if ($dup->fetchColumn()) {
                respond(['error' => 'This email address is already used by another account'], 409);
            }
        }
        ensureEmailChangeOtpsTable($db);
        $otp = sprintf('%06d', random_int(0, 999999));
        $otpHash = password_hash($otp, PASSWORD_DEFAULT);
        $purpose = $emailChanging && $loginChanging
            ? 'profile_and_login'
            : ($loginChanging ? 'sa_login_emails' : 'profile_email');
        $payload = json_encode([
            'new_email' => $newEmail,
            'login_emails' => $loginEmails,
        ], JSON_UNESCAPED_UNICODE);
        $db->prepare('DELETE FROM email_change_otps WHERE user_id = ?')->execute([$userId]);
        $rid = generateUUID();
        $exp = gmdate('Y-m-d H:i:s', time() + 600);
        $db->prepare(
            'INSERT INTO email_change_otps (id, user_id, purpose, payload, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$rid, $userId, $purpose, $payload, $otpHash, $exp]);
        $mailOrgId = trim((string) ($me['org_id'] ?? ''));
        if ($mailOrgId === '' && normalizeRoleForPortal((string) ($me['role'] ?? '')) === 'super_admin') {
            $syncOrg = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
            $mailOrgId = trim((string) ($syncOrg ? ($syncOrg->fetchColumn() ?: '') : ''));
        }
        syncpediaSetMailContext($mailOrgId !== '' ? $mailOrgId : null, 'password_reset');
        $mail = function_exists('syncpediaSendEmailChangeOtpEmail')
            ? syncpediaSendEmailChangeOtpEmail($oldEmail, (string) ($me['full_name'] ?? ''), $otp)
            : syncpediaSendPasswordResetOtpEmail($oldEmail, (string) ($me['full_name'] ?? ''), $otp);
        if (!($mail['email_sent'] ?? false)) {
            $db->prepare('DELETE FROM email_change_otps WHERE id = ?')->execute([$rid]);
            $detail = (string) ($mail['email_error'] ?? 'Email send failed');
            respond(['error' => 'Could not send the verification code. ' . $detail, 'email_error' => $detail], 503);
        }
        respond([
            'message' => 'A verification code was sent to your current email.',
            'sent_to' => $oldEmail,
            'purpose' => $purpose,
        ]);
    }

    if ($action === 'confirm_email_change') {
        $tokenData = verifyToken();
        $userId = trim((string) ($tokenData['user_id'] ?? ''));
        syncpediaRateLimitConsume('email_change_confirm_' . $userId, 10, 900);
        $otp = trim((string) ($input['otp'] ?? ''));
        if (!preg_match('/^\d{6}$/', $otp)) {
            respond(['error' => 'Enter the 6-digit code from your email'], 400);
        }
        $st = $db->prepare('SELECT id, email, role FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $me = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($me)) {
            respond(['error' => 'User not found'], 404);
        }
        if (!syncpediaRoleRequiresEmailChangeOtp((string) ($me['role'] ?? ''))) {
            respond(['error' => 'Email verification is not required for this account'], 403);
        }
        ensureEmailChangeOtpsTable($db);
        $rowSt = $db->prepare(
            'SELECT id, purpose, payload, token_hash, expires_at FROM email_change_otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
        );
        $rowSt->execute([$userId]);
        $row = $rowSt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row) || strtotime((string) ($row['expires_at'] ?? '')) < time()) {
            respond(['error' => 'This code expired. Request a new one.'], 400);
        }
        if (!password_verify($otp, (string) ($row['token_hash'] ?? ''))) {
            respond(['error' => 'That code is incorrect'], 400);
        }
        $payload = json_decode((string) ($row['payload'] ?? ''), true);
        if (!is_array($payload)) {
            respond(['error' => 'Invalid verification session. Request a new code.'], 400);
        }
        $newEmail = strtolower(trim((string) ($payload['new_email'] ?? '')));
        $loginEmails = $payload['login_emails'] ?? null;
        $oldEmail = strtolower(trim((string) ($me['email'] ?? '')));
        if ($newEmail !== '' && $newEmail !== $oldEmail) {
            $dup = $db->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1');
            $dup->execute([$newEmail, $userId]);
            if ($dup->fetchColumn()) {
                respond(['error' => 'This email address is already used by another account'], 409);
            }
            $db->prepare('UPDATE users SET email = ? WHERE id = ?')->execute([$newEmail, $userId]);
            try {
                $db->prepare('UPDATE marketing_members SET email = ? WHERE user_id = ?')->execute([$newEmail, $userId]);
            } catch (Throwable $e) {
            }
        }
        if (is_array($loginEmails) && normalizeRoleForPortal((string) ($me['role'] ?? '')) === 'super_admin') {
            ensureSuperAdminEmailLoginTables($db);
            $cleaned = [];
            foreach ($loginEmails as $item) {
                $e = strtolower(trim((string) $item));
                if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) {
                    $cleaned[] = $e;
                }
            }
            $cleaned = array_values(array_unique($cleaned));
            if (count($cleaned) > 2) {
                respond(['error' => 'Maximum of 2 Super Admin login emails'], 400);
            }
            $db->exec('DELETE FROM super_admin_allowed_emails');
            $ins = $db->prepare(
                'INSERT INTO super_admin_allowed_emails (id, email, created_by) VALUES (?, ?, ?)'
            );
            foreach ($cleaned as $e) {
                $ins->execute([generateUUID(), $e, $userId]);
            }
        }
        $db->prepare('DELETE FROM email_change_otps WHERE user_id = ?')->execute([$userId]);
        syncpediaAuditLog($db, $tokenData, 'updated_profile', 'user', $userId, 'Verified email change');
        $list = [];
        if (normalizeRoleForPortal((string) ($me['role'] ?? '')) === 'super_admin') {
            ensureSuperAdminEmailLoginTables($db);
            $list = $db->query(
                'SELECT id, email, created_at FROM super_admin_allowed_emails ORDER BY created_at ASC'
            )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        }
        respond([
            'message' => 'Email updated.',
            'email' => $newEmail !== '' ? $newEmail : $oldEmail,
            'emails' => $list,
        ]);
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

        $currentStmt = $db->prepare('SELECT avatar_url, email, role FROM users WHERE id = ? LIMIT 1');
        $currentStmt->execute([$userId]);
        $current = $currentStmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($current)) respond(['error' => 'User not found'], 404);

        $oldEmail = strtolower(trim((string) ($current['email'] ?? '')));
        if ($oldEmail !== $email && syncpediaRoleRequiresEmailChangeOtp((string) ($current['role'] ?? ''))) {
            respond(['error' => 'Verify the code sent to your current email before changing it.'], 403);
        }

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

 // Only upgrade legacy/unknown roles to marketing for portal routing.
 // Never override a role that is already a recognized CRM role.
 $knownCrmRoles = ['super_admin', 'org', 'manager', 'operational_manager', 'sales_representative', 'hr', 'marketing', 'assessment_viewer'];
 $normalizedRole = normalizeRoleForPortal($user['role'] ?? '');
 if (!in_array($normalizedRole, $knownCrmRoles, true)) {
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
        authAttachResultAssessment($db, $user);

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
            $org = syncpediaFetchOrganization($db, $effectiveOrgId, true);
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
        syncpediaIssueAuthCookie($token);
        
        $org = null;
        if ($targetOrgId) {
            $org = syncpediaFetchOrganization($db, (string) $targetOrgId, false);
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
