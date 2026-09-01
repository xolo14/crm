<?php
// Capture BOM, notices, or any stray output from includes before JSON is sent.
if (ob_get_level() === 0) {
    ob_start();
}
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/mail_transport.php';
ini_set('display_errors', '0');
ini_set('log_errors', '1');

class Database {
    private $conn;

    public function getConnection() {
        if ($this->conn === null) {
            try {
                $this->conn = syncpediaCreatePdo();
            } catch (PDOException $e) {
                error_log('[Database] connect failed: ' . $e->getMessage());
                $msg = 'Database connection failed';
                if (stripos($e->getMessage(), 'too many connections') !== false) {
                    $msg = 'Database busy — too many concurrent requests. Retry in a moment.';
                }
                respond(['error' => $msg], 500);
            }
        }
        return $this->conn;
    }
}

/** Security headers for JSON API responses (static assets use root .htaccess). */
function syncpediaSecurityHeaders(): void
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
}

function cors() {
    // Buffer output so stray notices/BOM from includes cannot break JSON responses.
    if (ob_get_level() === 0) {
        ob_start();
    }
    syncpediaSecurityHeaders();
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    $origin = syncpediaCorsOrigin();
    header('Access-Control-Allow-Origin: ' . $origin);
    // Required for HttpOnly session cookies from the SPA (origin must not be *).
    if ($origin !== '' && $origin !== '*') {
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Lead-Api-Key, X-Form-Api-Key, X-Assessment-Api-Key, X-Peaklyy-Api-Key, X-Cron-Key");
    header("Content-Type: application/json; charset=UTF-8");

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        respond(['ok' => true]);
    }
}

/** HttpOnly session cookie name (JWT). Prefer this over localStorage Bearer tokens. */
function syncpediaAuthCookieName(): string
{
    return 'syncpedia_session';
}

function syncpediaIssueAuthCookie(string $token): void
{
    $token = trim($token);
    if ($token === '') {
        return;
    }
    $maxAge = defined('TOKEN_EXPIRY') ? max(300, (int) TOKEN_EXPIRY) : 28800;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
    $params = [
        'expires' => time() + $maxAge,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $secure,
    ];
    setcookie(syncpediaAuthCookieName(), $token, $params);
}

function syncpediaClearAuthCookie(): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
    setcookie(syncpediaAuthCookieName(), '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $secure,
    ]);
}

/** Raw JWT from Authorization Bearer or HttpOnly session cookie. */
function syncpediaExtractBearerOrCookieToken(): string
{
    $headers = getallheaders();
    if (!is_array($headers)) {
        $headers = [];
    }
    if (empty($headers['Authorization']) && empty($headers['authorization'])) {
        if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers['Authorization'] = $_SERVER['HTTP_AUTHORIZATION'];
        } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers['Authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
    }
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (preg_match('/Bearer\s+(\S+)/', $authHeader, $matches)) {
        return trim((string) $matches[1]);
    }
    $cookieName = syncpediaAuthCookieName();
    $fromCookie = trim((string) ($_COOKIE[$cookieName] ?? ''));
    return $fromCookie;
}

function getInput() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

/** Decode a MySQL JSON/LONGTEXT column that may already be an array (PDO). */
function syncpediaDecodeAssocJson($raw): array {
    if (is_array($raw)) {
        return $raw;
    }
    if (!is_string($raw)) {
        return [];
    }
    $raw = trim($raw);
    if ($raw === '' || $raw === 'null' || strcasecmp($raw, 'Array') === 0) {
        return [];
    }
    $tmp = json_decode($raw, true);
    return is_array($tmp) ? $tmp : [];
}

function generateUUID() {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20, 12)
    );
}

/** Ensure users.token_version exists (session revoke on password change / offboard). */
function ensureUsersTokenVersionColumn(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'users', 'token_version')) {
            $db->exec('ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 1');
        }
        $done = true;
    } catch (Throwable $e) {
        error_log('[users] token_version column: ' . $e->getMessage());
    }
}

function syncpediaUserTokenVersion(PDO $db, string $userId): int
{
    ensureUsersTokenVersionColumn($db);
    try {
        $st = $db->prepare('SELECT token_version FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $v = $st->fetchColumn();
        return max(1, (int) $v);
    } catch (Throwable $e) {
        return 1;
    }
}

/** Invalidate all existing JWTs for this user (password change, reset, admin set password, deactivate). */
function syncpediaBumpUserTokenVersion(PDO $db, string $userId): void
{
    $uid = trim($userId);
    if ($uid === '') {
        return;
    }
    ensureUsersTokenVersionColumn($db);
    try {
        $db->prepare('UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?')->execute([$uid]);
    } catch (Throwable $e) {
        error_log('[users] bump token_version: ' . $e->getMessage());
    }
}

// Simple JWT implementation
function createToken($userId, $role, $orgId = null, ?int $tokenVersion = null) {
    if ($tokenVersion === null) {
        try {
            $db = (new Database())->getConnection();
            $tokenVersion = syncpediaUserTokenVersion($db, (string) $userId);
        } catch (Throwable $e) {
            $tokenVersion = 1;
        }
    }
    $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = base64_encode(json_encode([
        'user_id' => $userId,
        'role' => $role,
        'org_id' => $orgId,
        'tv' => (int) $tokenVersion,
        'exp' => time() + TOKEN_EXPIRY,
        'iat' => time(),
    ]));
    $signature = base64_encode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    return "$header.$payload.$signature";
}

// nginx / PHP-FPM often omit getallheaders(); Authorization may live in REDIRECT_*.
if (!function_exists('getallheaders')) {
    function getallheaders() {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (!is_string($name) || strncmp($name, 'HTTP_', 5) !== 0) {
                continue;
            }
            $key = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
            $headers[$key] = $value;
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['Content-Type'] = $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $headers['Content-Length'] = $_SERVER['CONTENT_LENGTH'];
        }
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers['Authorization'] = $_SERVER['HTTP_AUTHORIZATION'];
        } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers['Authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        return $headers;
    }
}

function verifyToken() {
    $rawToken = syncpediaExtractBearerOrCookieToken();
    if ($rawToken === '') {
        respond(['error' => 'No token provided'], 401);
    }

    $parts = explode('.', $rawToken);
    if (count($parts) !== 3) {
        respond(['error' => 'Invalid token'], 401);
    }

    [$header, $payload, $signature] = $parts;
    $expectedSig = base64_encode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));

    if (!hash_equals($expectedSig, $signature)) {
        respond(['error' => 'Invalid token signature'], 401);
    }

    $data = json_decode(base64_decode($payload, true), true);
    if (!is_array($data) || !isset($data['exp'])) {
        respond(['error' => 'Invalid token payload'], 401);
    }
    if ($data['exp'] < time()) {
        respond(['error' => 'Token expired'], 401);
    }

    // Reject deactivated / revoked sessions; always load live role/org (fail closed).
    $uid = trim((string) ($data['user_id'] ?? ''));
    if ($uid === '') {
        respond(['error' => 'Invalid token payload'], 401);
    }
    try {
        $db = (new Database())->getConnection();
        ensureUsersTokenVersionColumn($db);
        $st = $db->prepare('SELECT is_active, role, org_id, token_version FROM users WHERE id = ? LIMIT 1');
        try {
            $st->execute([$uid]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $colErr) {
            // Pre-migration DBs without token_version yet.
            $st = $db->prepare('SELECT is_active, role, org_id FROM users WHERE id = ? LIMIT 1');
            $st->execute([$uid]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (is_array($row)) {
                $row['token_version'] = 1;
            }
        }
        if (!$row || !(int) ($row['is_active'] ?? 0)) {
            respond(['error' => 'Account is deactivated'], 401);
        }
        $liveTv = max(1, (int) ($row['token_version'] ?? 1));
        $tokenTv = (int) ($data['tv'] ?? 0);
        // Missing tv (pre-revoke JWTs) or mismatched version → force re-login.
        if ($tokenTv !== $liveTv) {
            respond(['error' => 'Session expired — please sign in again'], 401);
        }
        if (isset($row['role']) && trim((string) $row['role']) !== '') {
            $data['role'] = (string) $row['role'];
        }
        // Prefer live users.org_id. For super_admin, keep JWT switch_org when DB org is empty
        // so tenant lists (batches/courses) stay scoped to the switched organization.
        if (array_key_exists('org_id', $row)) {
            $dbOrg = $row['org_id'];
            $dbOrgTrim = is_string($dbOrg) || is_numeric($dbOrg) ? trim((string) $dbOrg) : '';
            $jwtOrgTrim = trim((string) ($data['org_id'] ?? ''));
            $normRole = syncpediaNormalizeRoleKey((string) ($data['role'] ?? ''));
            if ($dbOrgTrim !== '') {
                $data['org_id'] = (string) $dbOrg;
            } elseif ($normRole === 'super_admin' && $jwtOrgTrim !== '') {
                $data['org_id'] = $jwtOrgTrim;
            } else {
                $data['org_id'] = $dbOrg;
            }
        }
    } catch (Throwable $e) {
        error_log('[verifyToken] user lookup failed: ' . $e->getMessage());
        respond(['error' => 'Authentication temporarily unavailable'], 401);
    }

    if (function_exists('syncpediaSetMailContext')) {
        $mailOrgId = trim((string) ($data['org_id'] ?? ''));
        if ($mailOrgId === '' && syncpediaNormalizeRoleKey((string) ($data['role'] ?? '')) === 'super_admin') {
            try {
                $mailDb = (new Database())->getConnection();
                $mailOrgStmt = $mailDb->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
                $mailOrgId = trim((string) ($mailOrgStmt ? ($mailOrgStmt->fetchColumn() ?: '') : ''));
            } catch (Throwable $e) {
                $mailOrgId = '';
            }
        }
        syncpediaSetMailContext($mailOrgId !== '' ? $mailOrgId : null, 'default');
    }
    return $data;
}

function requireRole($tokenData, $roles) {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $allowed = array_map(
        static fn($r) => syncpediaNormalizeRoleKey((string) $r),
        $roles,
    );
    if (!in_array($role, $allowed, true)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }
}

// Get org_id from token - super_admin uses JWT/switch_org only (no users.org_id fallback)
function getOrgId($tokenData) {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin' && !empty($_GET['org_id'])) {
        return $_GET['org_id'];
    }
    $fromToken = $tokenData['org_id'] ?? null;
    if ($fromToken !== null && trim((string) $fromToken) !== '') {
        return trim((string) $fromToken);
    }
    if ($role === 'super_admin') {
        return null;
    }
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($userId !== '') {
        try {
            $db = (new Database())->getConnection();
            $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
            $st->execute([$userId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            $oid = is_array($row) ? trim((string) ($row['org_id'] ?? '')) : '';
            if ($oid !== '') {
                return $oid;
            }
        } catch (Throwable $e) {
            // ignore
        }
    }
    return null;
}

/** Minimum password length for signup / change-password. */
function syncpediaMinPasswordLength(): int
{
    if (defined('MIN_PASSWORD_LENGTH') && (int) MIN_PASSWORD_LENGTH >= 8) {
        return (int) MIN_PASSWORD_LENGTH;
    }
    return 8;
}

/** Whether public self-registration is allowed (default: disabled). */
function syncpediaPublicSignupEnabled(): bool
{
    return defined('SIGNUP_ENABLED') && SIGNUP_ENABLED === true;
}

/** Validate invite code for signup from api/config.php (never hardcode in source). */
function syncpediaValidateSignupInvite(string $role, string $inviteCode): bool
{
    $role = strtolower(trim($role));
    $inviteCode = trim($inviteCode);
    if ($inviteCode === '') {
        return false;
    }
    $map = [];
    if (defined('SIGNUP_INVITE_ADMIN') && SIGNUP_INVITE_ADMIN !== '') {
        $map['admin'] = (string) SIGNUP_INVITE_ADMIN;
    }
    if (defined('SIGNUP_INVITE_MANAGER') && SIGNUP_INVITE_MANAGER !== '') {
        $map['manager'] = (string) SIGNUP_INVITE_MANAGER;
    }
    if (defined('SIGNUP_INVITE_SALES') && SIGNUP_INVITE_SALES !== '') {
        $map['sales_representative'] = (string) SIGNUP_INVITE_SALES;
    }
    if (!isset($map[$role])) {
        return false;
    }
    return hash_equals($map[$role], $inviteCode);
}

/** Simple file-based rate limiter (per IP + bucket). */
function syncpediaRateLimitConsume(string $bucket, int $maxAttempts = 10, int $windowSeconds = 900): void
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $key = hash('sha256', $bucket . '|' . $ip);
    $dir = dirname(__DIR__) . '/storage/rate_limits';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    $file = $dir . '/' . $key . '.json';
    $now = time();
    $data = ['attempts' => [], 'blocked_until' => 0];
    if (is_file($file)) {
        $decoded = json_decode((string) @file_get_contents($file), true);
        if (is_array($decoded)) {
            $data = $decoded;
        }
    }
    if ((int) ($data['blocked_until'] ?? 0) > $now) {
        respond(['error' => 'Too many attempts. Please try again later.'], 429);
    }
    $attempts = array_values(array_filter(
        $data['attempts'] ?? [],
        static fn($t) => ($now - (int) $t) < $windowSeconds,
    ));
    if (count($attempts) >= $maxAttempts) {
        @file_put_contents($file, json_encode(['attempts' => $attempts, 'blocked_until' => $now + $windowSeconds]));
        respond(['error' => 'Too many attempts. Please try again later.'], 429);
    }
    $attempts[] = $now;
    @file_put_contents($file, json_encode(['attempts' => $attempts, 'blocked_until' => 0]));
}

/**
 * Ensure caller may manage a target user row (tenant boundary).
 *
 * @return array<string, mixed>
 */
function syncpediaAssertTargetUserEditable(PDO $db, array $tokenData, string $targetUserId): array
{
    if ($targetUserId === '') {
        respond(['error' => 'ID required'], 400);
    }
    $st = $db->prepare('SELECT id, org_id, role, email, full_name FROM users WHERE id = ? LIMIT 1');
    $st->execute([$targetUserId]);
    $target = $st->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        respond(['error' => 'User not found'], 404);
    }
    $targetRole = syncpediaNormalizeRoleKey((string) ($target['role'] ?? ''));
    $callerRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($targetRole === 'super_admin' && $callerRole !== 'super_admin') {
        respond(['error' => 'Forbidden'], 403);
    }
    if (tenantIsMasterView($tokenData)) {
        return $target;
    }
    $callerOrg = resolveCreatorOrgId($db, $tokenData);
    $targetOrg = trim((string) ($target['org_id'] ?? ''));
    if ($callerOrg === null || $callerOrg === '' || $targetOrg === '' || $callerOrg !== $targetOrg) {
        respond(['error' => 'You can only manage users in your organization'], 403);
    }
    return $target;
}

/** Ensure assignee belongs to caller's tenant org. */
function syncpediaAssertUserInCallerOrg(PDO $db, array $tokenData, string $userId): void
{
    if ($userId === '' || tenantIsMasterView($tokenData)) {
        return;
    }
    $callerOrg = resolveCreatorOrgId($db, $tokenData);
    if ($callerOrg === null || $callerOrg === '') {
        respond(['error' => 'Organization context required'], 403);
    }
    $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $userOrg = trim((string) ($row['org_id'] ?? ''));
    if ($userOrg === '' || $userOrg !== $callerOrg) {
        respond(['error' => 'Assignee must belong to your organization'], 403);
    }
}

/**
 * Ensure lead is visible under tenant + hierarchy scope.
 *
 * @return array<string, mixed>
 */
function syncpediaAssertLeadInScope(PDO $db, array $tokenData, string $leadId): array
{
    if ($leadId === '') {
        respond(['error' => 'Lead ID required'], 400);
    }
    $scope = tenantLeadsScopeSql($db, $tokenData, 'l');
    $stmt = $db->prepare("SELECT l.* FROM leads l WHERE l.id = ? AND 1=1{$scope['sql']} LIMIT 1");
    $stmt->execute(array_merge([$leadId], $scope['params']));
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Lead not found or access denied'], 404);
    }
    return $row;
}

/** Generate a random temporary password for new team members. */
function syncpediaGenerateTempPassword(int $length = 14): string
{
    $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
    $out = '';
    $max = strlen($chars) - 1;
    for ($i = 0; $i < $length; $i++) {
        $out .= $chars[random_int(0, $max)];
    }
    return $out;
}

/** Feature keys that map to real CRM modules (must match src/lib/orgFeatures.ts). */
function syncpediaImplementedOrgFeatures(): array
{
    return [
        'leads',
        'form_management',
        'tasks',
        'notifications',
        'students',
        'courses',
        'batches',
        'communications',
        'marketing_access',
        'payments',
        'payslip',
        'daily_reports',
        'holidays',
        'certificates',
        'offer_letters',
        'fresher_salary',
        'timetables',
    ];
}

function syncpediaIsAllowedOrgFeature(string $feature): bool
{
    return in_array($feature, syncpediaImplementedOrgFeatures(), true);
}

/** Platform super_admin with no org context (master panel / all tenants). */
function tenantIsMasterView(array $tokenData): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role !== 'super_admin') {
        return false;
    }
    if (!empty($_GET['org_id'])) {
        return false;
    }
    $jwtOrg = $tokenData['org_id'] ?? null;
    return $jwtOrg === null || trim((string) $jwtOrg) === '';
}

/**
 * Org id for tenant list queries; null only in super_admin master view.
 */
function tenantListOrgId(PDO $db, array $tokenData): ?string
{
    if (tenantIsMasterView($tokenData)) {
        return null;
    }
    return resolveCreatorOrgId($db, $tokenData);
}

/**
 * AND clause restricting a row alias to the caller's tenant org.
 *
 * @return array{sql: string, params: array}
 */
function tenantOrgScopeSql(PDO $db, array $tokenData, string $alias = ''): array
{
    if (tenantIsMasterView($tokenData)) {
        return ['sql' => '', 'params' => []];
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null || $orgId === '') {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    return ['sql' => " AND {$col}org_id = ?", 'params' => [$orgId]];
}

/**
 * Leads list scope: tenant org + L1 self / L2 manager downline.
 *
 * @return array{sql: string, params: array}
 */
function tenantLeadsScopeSql(PDO $db, array $tokenData, string $alias = 'l'): array
{
    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if (tenantIsMasterView($tokenData)) {
        if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
            return hierarchyL1OwnLeadsScopeSql($tokenData, $alias);
        }
        if (hierarchyRoleUsesDownlineScope($tokenData) && $effRole !== 'manager') {
            return hierarchyLeadDownlineScopeSql(hierarchyGetVisibleUserIds($db, $tokenData), $alias, $db);
        }
        return ['sql' => '', 'params' => []];
    }

    $tenant = orgFilterLeadsTenant($db, $tokenData, $alias);
    $sql = ' AND (' . $tenant['where'] . ')';
    $params = $tenant['params'];

    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $l1 = hierarchyL1OwnLeadsScopeSql($tokenData, $alias);
        return ['sql' => $sql . $l1['sql'], 'params' => array_merge($params, $l1['params'])];
    }
    // Managers see all leads in their org (same as admin/org), not downline-only.
    if (hierarchyRoleUsesDownlineScope($tokenData) && $effRole !== 'manager') {
        $dl = hierarchyLeadDownlineScopeSql(hierarchyGetVisibleUserIds($db, $tokenData), $alias, $db);
        return ['sql' => $sql . $dl['sql'], 'params' => array_merge($params, $dl['params'])];
    }
    return ['sql' => $sql, 'params' => $params];
}

/**
 * Students list scope: tenant org + hierarchy (manager downline / L1 own leads).
 *
 * @return array{sql: string, params: array}
 */
function tenantStudentListScopeSql(PDO $db, array $tokenData): array
{
    $sql = '';
    $params = [];
    if (!tenantIsMasterView($tokenData)) {
        $orgId = resolveCreatorOrgId($db, $tokenData);
        if ($orgId === null || $orgId === '') {
            return ['sql' => ' AND 1=0', 'params' => []];
        }
        $tenant = orgFilterStudentsTenantSql($orgId);
        $sql .= $tenant['sql'];
        $params = array_merge($params, $tenant['params']);
    }
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        // Managers see all org students (aligned with org-wide leads visibility).
        if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) !== 'manager') {
            $scope = hierarchyStudentListScopeSql(hierarchyGetVisibleUserIds($db, $tokenData));
            $sql .= $scope['sql'];
            $params = array_merge($params, $scope['params']);
        }
    } elseif (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $uid = (string) ($tokenData['user_id'] ?? '');
        $scope = hierarchyStudentListScopeSql($uid !== '' ? [$uid] : []);
        $sql .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    }
    return ['sql' => $sql, 'params' => $params];
}

/**
 * Tasks list scope: tenant org + hierarchy.
 *
 * @return array{sql: string, params: array}
 */
function tenantTaskListScopeSql(PDO $db, array $tokenData): array
{
    if (tenantIsMasterView($tokenData)) {
        return ['sql' => '', 'params' => []];
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');

    $orgSql = $orgId
        ? ' AND (org_id = ? OR assigned_to IN (SELECT id FROM users WHERE org_id = ?) OR created_by IN (SELECT id FROM users WHERE org_id = ?))'
        : ' AND 1=0';
    $orgParams = $orgId ? [$orgId, $orgId, $orgId] : [];

    if (in_array($effRole, ['admin', 'org', 'trainer', 'finance'], true)) {
        return ['sql' => $orgSql, 'params' => $orgParams];
    }
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $scope = hierarchyTaskListScopeSql(hierarchyGetVisibleUserIds($db, $tokenData));
        return ['sql' => $orgSql . $scope['sql'], 'params' => array_merge($orgParams, $scope['params'])];
    }
    // L1 sales/marketing/hr: always see own assigned + created tasks.
    // If org resolution failed, still show their rows (don't blank the whole list with 1=0).
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        if ($orgId) {
            return [
                'sql' => $orgSql . ' AND (assigned_to = ? OR created_by = ?)',
                'params' => array_merge($orgParams, [$userId, $userId]),
            ];
        }
        return [
            'sql' => ' AND (assigned_to = ? OR created_by = ?)',
            'params' => [$userId, $userId],
        ];
    }
    return ['sql' => $orgSql, 'params' => $orgParams];
}

/**
 * Daily reports list scope: tenant org + hierarchy.
 *
 * @return array{sql: string, params: array}
 */
function tenantDailyReportsScopeSql(PDO $db, array $tokenData): array
{
    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    if (tenantIsMasterView($tokenData)) {
        return ['sql' => '', 'params' => []];
    }

    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null || $orgId === '') {
        return ['sql' => ' AND 1=0', 'params' => []];
    }

    $sql = ' AND (dr.org_id = ? OR (dr.org_id IS NULL AND dr.user_id IN (SELECT id FROM users WHERE org_id = ?)))';
    $params = [$orgId, $orgId];

    if (in_array($effRole, ['sales_representative'], true)) {
        $sql .= ' AND dr.user_id = ?';
        $params[] = $userId;
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $scope = hierarchyBuildInClause('dr.user_id', hierarchyGetVisibleUserIds($db, $tokenData));
        $sql .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    } elseif (!in_array($effRole, ['admin', 'org'], true)) {
        $sql .= ' AND dr.user_id = ?';
        $params[] = $userId;
    }

    return ['sql' => $sql, 'params' => $params];
}

/**
 * Courses catalog WHERE (org-owned or batches in org).
 *
 * @return array{where: string, params: array}
 */
function tenantCourseCatalogWhere(PDO $db, array $tokenData, string $courseAlias = 'c'): array
{
    if (tenantIsMasterView($tokenData)) {
        return ['where' => '1=1', 'params' => []];
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null || $orgId === '') {
        return ['where' => '1=0', 'params' => []];
    }
    $c = $courseAlias;
    return [
        'where' => "({$c}.org_id = ? OR EXISTS (SELECT 1 FROM batches b WHERE b.course_id = {$c}.id AND b.org_id = ?))",
        'params' => [$orgId, $orgId],
    ];
}

/**
 * Batches catalog WHERE (batch org or parent course org).
 *
 * @return array{where: string, params: array}
 */
function tenantBatchCatalogWhere(PDO $db, array $tokenData, string $batchAlias = 'b', string $courseAlias = 'c'): array
{
    if (tenantIsMasterView($tokenData)) {
        return ['where' => '1=1', 'params' => []];
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null || $orgId === '') {
        return ['where' => '1=0', 'params' => []];
    }
    // Match batch org, parent course org, or legacy blank/NULL batch org on an org course.
    return [
        'where' => "("
            . "NULLIF(TRIM({$batchAlias}.org_id), '') = ?"
            . " OR NULLIF(TRIM({$courseAlias}.org_id), '') = ?"
            . ")",
        'params' => [$orgId, $orgId],
    ];
}

// Build org filter for queries - returns WHERE clause fragment + params
function orgFilter($tokenData, $tableAlias = '', ?PDO $db = null) {
    if (tenantIsMasterView($tokenData)) {
        return ['where' => '1=1', 'params' => []];
    }
    $prefix = $tableAlias ? "$tableAlias." : '';
    $orgId = $db ? resolveCreatorOrgId($db, $tokenData) : getOrgId($tokenData);
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

    // Super admin with no org filter sees everything
    if ($role === 'super_admin' && !$orgId) {
        return ['where' => '1=1', 'params' => []];
    }
    
    if ($orgId) {
        return ['where' => "{$prefix}org_id = ?", 'params' => [$orgId]];
    }

    if ($role === 'super_admin') {
        return ['where' => '1=1', 'params' => []];
    }

    return ['where' => '1=0', 'params' => []];
}

/**
 * Append org scope to UPDATE/DELETE (e.g. " AND t.org_id = ?").
 *
 * @return array{sql: string, params: array}
 */
function orgFilterSqlAnd(array $tokenData, string $tableAlias = '', ?PDO $db = null): array
{
    $f = orgFilter($tokenData, $tableAlias, $db);
    if ($f['where'] === '1=1') {
        return ['sql' => '', 'params' => []];
    }

    return ['sql' => ' AND ' . $f['where'], 'params' => $f['params']];
}

/**
 * Activities list: tenant org_id on row OR actor belongs to tenant.
 *
 * @return array{sql: string, params: array}
 */
function activitiesListScopeSql(PDO $db, array $tokenData, string $alias = 'a'): array
{
    $prefix = $alias !== '' ? "{$alias}." : '';
    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');

    if ($effRole === 'super_admin' && !getOrgId($tokenData)) {
        return ['sql' => '', 'params' => []];
    }

    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId) {
        return [
            'sql' => " AND ({$prefix}org_id = ? OR {$prefix}user_id IN (SELECT id FROM users WHERE org_id = ?))",
            'params' => [$orgId, $orgId],
        ];
    }

    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyBuildInClause("{$prefix}user_id", $visibleIds);
    }

    return ['sql' => " AND {$prefix}user_id = ?", 'params' => [$userId]];
}

/**
 * Pipeline stages: org-specific rows plus shared global defaults (org_id IS NULL).
 *
 * @return array{where: string, params: array}
 */
function pipelineStagesOrgFilter(array $tokenData, string $tableAlias = 'ps', ?PDO $db = null): array
{
    $prefix = $tableAlias ? "{$tableAlias}." : '';
    $f = orgFilter($tokenData, $tableAlias, $db);
    if ($f['where'] === '1=1' || empty($f['params'])) {
        return $f;
    }

    return [
        'where' => "({$prefix}org_id = ? OR {$prefix}org_id IS NULL)",
        'params' => $f['params'],
    ];
}

/**
 * Return a task row if the caller may read/update/delete it.
 *
 * @return array<string,mixed>|null
 */
function taskFetchIfAccessible(PDO $db, array $tokenData, string $taskId): ?array
{
    $stmt = $db->prepare('SELECT * FROM tasks WHERE id = ? LIMIT 1');
    $stmt->execute([$taskId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    $effRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');

    if ($effRole === 'super_admin' && !getOrgId($tokenData)) {
        return $row;
    }

    $orgId = resolveCreatorOrgId($db, $tokenData);
    $rowOrg = trim((string) ($row['org_id'] ?? ''));
    if ($orgId !== null && $orgId !== '' && $rowOrg === $orgId) {
        return $row;
    }

    if (in_array($effRole, ['admin', 'org'], true) && $orgId) {
        $assigned = trim((string) ($row['assigned_to'] ?? ''));
        $created = trim((string) ($row['created_by'] ?? ''));
        $uids = array_values(array_filter(array_unique([$assigned, $created])));
        if (!empty($uids)) {
            $ph = implode(',', array_fill(0, count($uids), '?'));
            $chk = $db->prepare("SELECT COUNT(*) FROM users WHERE org_id = ? AND id IN ($ph)");
            $chk->execute(array_merge([$orgId], $uids));
            if ((int) $chk->fetchColumn() > 0) {
                return $row;
            }
        }
    }

    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $assigned = (string) ($row['assigned_to'] ?? '');
        $created = (string) ($row['created_by'] ?? '');
        if (in_array($assigned, $visibleIds, true) || in_array($created, $visibleIds, true)) {
            return $row;
        }
    }

    if ((string) ($row['assigned_to'] ?? '') === $userId || (string) ($row['created_by'] ?? '') === $userId) {
        return $row;
    }

    return null;
}

/**
 * Leads list scope for L3 org admin: org_id on row OR assigned/created by a member of the tenant.
 *
 * @return array{where: string, params: array}
 */
function orgFilterLeadsTenant(PDO $db, array $tokenData, string $alias = ''): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    // Prefer ?org_id= / JWT org (getOrgId) so super_admin can filter one tenant.
    $orgId = getOrgId($tokenData);
    if ($role === 'super_admin' && ($orgId === null || trim((string) $orgId) === '')) {
        return ['where' => '1=1', 'params' => []];
    }
    if ($orgId === null || trim((string) $orgId) === '') {
        $orgId = resolveCreatorOrgId($db, $tokenData);
    }
    if (!$orgId) {
        // Fail closed — never expose null-org / orphan leads to callers without a tenant.
        return ['where' => '1=0', 'params' => []];
    }
    $orgId = (string) $orgId;
    $col = $alias !== '' ? "{$alias}." : '';
    $sql = "({$col}org_id = ? OR (({$col}org_id IS NULL OR {$col}org_id = '') AND (
        {$col}assigned_to IN (SELECT id FROM users WHERE org_id = ?)
        OR {$col}created_by IN (SELECT id FROM users WHERE org_id = ?)
    )))";

    return ['where' => $sql, 'params' => [$orgId, $orgId, $orgId]];
}

/**
 * Students list tenant scope (org on student/lead rows or mentor/assignee in org).
 *
 * @return array{sql: string, params: array}
 */
function orgFilterStudentsTenantSql(string $orgId): array
{
    $sql = ' AND (
        s.org_id = ? OR l.org_id = ? OR l2.org_id = ?
        OR s.mentor_id IN (SELECT id FROM users WHERE org_id = ?)
        OR l.assigned_to IN (SELECT id FROM users WHERE org_id = ?)
        OR l2.assigned_to IN (SELECT id FROM users WHERE org_id = ?)
        OR l.created_by IN (SELECT id FROM users WHERE org_id = ?)
        OR l2.created_by IN (SELECT id FROM users WHERE org_id = ?)
    )';

    return [
        'sql' => $sql,
        'params' => array_fill(0, 8, $orgId),
    ];
}

/** L4–L1 role normalization (see src/lib/roleUtils.ts). */
function syncpediaNormalizeRoleKey(string $role): string
{
    $r = strtolower(trim($role));
    if ($r === 'superadmin') {
        return 'super_admin';
    }
    if ($r === 'organisation' || $r === 'admin') {
        return 'org';
    }
    if ($r === 'sales_executive') {
        return 'sales_representative';
    }
    if (in_array($r, ['team_lead', 'sales_manager'], true)) {
        return 'manager';
    }
    if (in_array($r, ['ops_manager', 'l2_operational_manager', 'operational manager'], true)) {
        return 'operational_manager';
    }
    if ($r === 'trainer' || $r === 'finance') {
        return '__removed__';
    }
    if (strpos($r, 'marketing') === 0) {
        return 'marketing';
    }
    if ($r === 'sales_marketing') {
        return 'marketing';
    }
    return $r;
}

/**
 * Legacy column may exist from earlier builds. We never store or return plaintext passwords.
 * Clear any residual value when passwords change.
 */
function syncpediaEnsureLoginPasswordColumn(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'users', 'login_password')) {
            // Do not create the column anymore — plaintext storage is retired.
            $done = true;
            return;
        }
    } catch (Throwable $e) {
    }
    $done = true;
}

/** Clear residual plaintext login_password if the legacy column exists. Never stores plaintext. */
function syncpediaStoreUserLoginPassword(PDO $db, string $userId, ?string $plainPassword): void
{
    $uid = trim($userId);
    if ($uid === '') {
        return;
    }
    syncpediaEnsureLoginPasswordColumn($db);
    if (!syncpediaColumnExists($db, 'users', 'login_password')) {
        return;
    }
    try {
        // Always null — plaintext recovery removed for security.
        $db->prepare('UPDATE users SET login_password = NULL WHERE id = ?')->execute([$uid]);
    } catch (Throwable $e) {
    }
    unset($plainPassword);
}

/** Higher number = more authority: L4 super_admin, L3 org, L2 manager, L1 field roles. */
function syncpediaRoleLevel(string $role): int
{
    $r = syncpediaNormalizeRoleKey($role);
    $levels = [
        'super_admin' => 4,
        'org' => 3,
        'manager' => 2,
        'operational_manager' => 2,
        'sales_representative' => 1,
        'hr' => 1,
        'marketing' => 1,
        'student' => 0,
    ];
    return $levels[$r] ?? 0;
}

function syncpediaL1AssignableRoles(): array
{
    return ['sales_representative', 'hr', 'marketing'];
}

/**
 * Visible user IDs for the current user based on the reporting hierarchy.
 *
 * Desired behavior:
 * - L4 super_admin: return [] meaning "no restriction"
 * - L3 admin/org and L2 manager: return self + all nested reports
 * - other roles: return [self]
 */
function hierarchyVisibleUserIds(PDO $db, array $tokenData): array {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = $tokenData['user_id'] ?? null;
    if (empty($userId) || !is_string($userId)) {
        return [];
    }

    if ($role === 'super_admin') {
        return [];
    }

    $treeRoles = ['admin', 'org', 'manager'];
    if (!in_array($role, $treeRoles, true)) {
        return [$userId];
    }

    try {
        if (!syncpediaColumnExists($db, 'users', 'reports_to_id')) {
            return [$userId];
        }
    } catch (Throwable $e) {
        return [$userId];
    }

    $visible = [$userId];
    $queue = [$userId];

    while (!empty($queue)) {
        $current = array_shift($queue);
        try {
            // Keep hierarchy inside one tenant: never walk across organizations via broken reporting links.
            $stmt = $db->prepare("
                SELECT u.id FROM users u
                INNER JOIN users p ON p.id = ?
                WHERE u.reports_to_id = p.id
                  AND u.is_active = 1
                  AND LOWER(TRIM(u.role)) NOT IN ('admin','super_admin')
                  AND (
                    (
                      (p.org_id IS NULL OR TRIM(p.org_id) = '')
                      AND (u.org_id IS NULL OR TRIM(u.org_id) = '')
                    )
                    OR (
                      p.org_id IS NOT NULL AND TRIM(p.org_id) <> ''
                      AND u.org_id IS NOT NULL AND TRIM(u.org_id) <> ''
                      AND u.org_id = p.org_id
                    )
                  )
            ");
            $stmt->execute([$current]);
            $children = $stmt->fetchAll(PDO::FETCH_COLUMN);
        } catch (Throwable $e) {
            $children = [];
        }

        foreach ($children as $cid) {
            if (!is_string($cid) || $cid === '') {
                continue;
            }
            if (!in_array($cid, $visible, true)) {
                $visible[] = $cid;
                $queue[] = $cid;
            }
        }
    }

    return $visible;
}

/**
 * Request-scoped cache for hierarchyVisibleUserIds (avoids repeated tree walks per HTTP request).
 *
 * @return string[]
 */
function hierarchyGetVisibleUserIds(PDO $db, array $tokenData): array
{
    static $cache = [];
    $userId = (string) ($tokenData['user_id'] ?? '');
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $key = $userId . '|' . $role;
    if (!isset($cache[$key])) {
        $cache[$key] = hierarchyVisibleUserIds($db, $tokenData);
    }
    return $cache[$key];
}

/**
 * Downline lead filter: assigned_to, created_by, or referral_code from visible user ids.
 *
 * @param string[] $visibleIds
 * @return array{sql: string, params: array}
 */
function hierarchyLeadDownlineScopeSql(array $visibleIds, string $alias = '', ?PDO $db = null): array
{
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    $parts = [
        "{$col}assigned_to IN ({$in})",
        "{$col}referred_by IN (SELECT referral_code FROM users WHERE id IN ({$in}))",
    ];
    $params = array_merge($visibleIds, $visibleIds);
    // created_by keeps manager-created leads visible when assigned outside the tree
    if ($db instanceof PDO) {
        try {
            ensureLeadsCreatedByColumn($db);
        } catch (Throwable $e) {
        }
        if (syncpediaColumnExists($db, 'leads', 'created_by')) {
            $parts[] = "{$col}created_by IN ({$in})";
            $params = array_merge($params, $visibleIds);
        }
    }
    return [
        'sql' => ' AND (' . implode(' OR ', $parts) . ')',
        'params' => $params,
    ];
}

/**
 * Downline filter for lead_assignments joined to leads.
 *
 * @param string[] $visibleIds
 * @return array{sql: string, params: array}
 */
function hierarchyLeadAssignmentDownlineScopeSql(array $visibleIds): array
{
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    return [
        'sql' => " AND (la.user_id IN ({$in}) OR l.assigned_to IN ({$in}) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ({$in})))",
        'params' => array_merge($visibleIds, $visibleIds, $visibleIds),
    ];
}

/**
 * Task list / analytics scope: assigned_to or created_by in visible user ids.
 *
 * @param string[] $visibleIds
 * @return array{sql: string, params: array}
 */
function hierarchyTaskListScopeSql(array $visibleIds, string $alias = ''): array
{
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    return [
        'sql' => " AND ({$col}assigned_to IN ({$in}) OR {$col}created_by IN ({$in}))",
        'params' => array_merge($visibleIds, $visibleIds),
    ];
}

/** L2 managers: downline scope on tasks/students; leads list uses full org tenant (see tenantLeadsScopeSql). */
function hierarchyRoleUsesDownlineScope(array $tokenData): bool
{
    return syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'manager';
}

/**
 * @return array{sql: string, params: array}
 */
function hierarchyBuildInClause(string $columnExpr, array $userIds): array
{
    if (empty($userIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $in = implode(',', array_fill(0, count($userIds), '?'));
    return ['sql' => " AND {$columnExpr} IN ({$in})", 'params' => array_values($userIds)];
}

/**
 * Student list scope for managers (expects leads aliases `l` and `l2` on the students query).
 *
 * @return array{sql: string, params: array}
 */
function hierarchyStudentListScopeSql(array $visibleIds): array
{
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    $refSub = "SELECT referral_code FROM users WHERE id IN ({$in})";
    $sql = " AND (
        (l.id IS NOT NULL AND (l.assigned_to IN ({$in}) OR l.referred_by IN ({$refSub})))
        OR (l2.id IS NOT NULL AND (l2.assigned_to IN ({$in}) OR l2.referred_by IN ({$refSub})))
        OR ((l.id IS NULL AND l2.id IS NULL) AND (s.mentor_id IN ({$in}) OR s.user_id IN ({$in})))
    )";
    return [
        'sql' => $sql,
        'params' => array_merge($visibleIds, $visibleIds, $visibleIds, $visibleIds, $visibleIds, $visibleIds),
    ];
}

/**
 * Restrict a user-id column to members of the caller's organization.
 *
 * @return array{sql: string, params: array}
 */
function hierarchyOrgUserIdsScopeSql(array $tokenData, string $columnExpr, ?PDO $db = null): array
{
    $orgId = $db instanceof PDO ? resolveCreatorOrgId($db, $tokenData) : getOrgId($tokenData);
    if ($orgId === null || $orgId === '') {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    return [
        'sql' => " AND {$columnExpr} IN (SELECT id FROM users WHERE org_id = ?)",
        'params' => [$orgId],
    ];
}

/** Whether an archived trash row belongs to the manager's downline. */
function trashRowVisibleToDownline(array $row, array $visibleIds): bool
{
    $deletedBy = (string) ($row['deleted_by'] ?? '');
    if ($deletedBy !== '' && in_array($deletedBy, $visibleIds, true)) {
        return true;
    }
    $p = json_decode((string) ($row['payload'] ?? ''), true);
    if (!is_array($p)) {
        return false;
    }
    $owned = static function (?string $uid) use ($visibleIds): bool {
        return $uid !== null && $uid !== '' && in_array($uid, $visibleIds, true);
    };
    $type = (string) ($row['entity_type'] ?? '');
    if ($type === 'lead' && $owned($p['assigned_to'] ?? null)) {
        return true;
    }
    if ($type === 'task' && ($owned($p['assigned_to'] ?? null) || $owned($p['created_by'] ?? null))) {
        return true;
    }
    if ($type === 'deal' && $owned($p['owner_id'] ?? null)) {
        return true;
    }
    if ($type === 'student' && ($owned($p['mentor_id'] ?? null) || $owned($p['user_id'] ?? null))) {
        return true;
    }
    if ($type === 'payment' && ($owned($p['recorded_by'] ?? null) || $owned($p['created_by'] ?? null))) {
        return true;
    }
    return false;
}

/** L1 roles that see only their own assigned, referred, or created leads. */
function hierarchyRoleUsesL1OwnLeadsScope(array $tokenData): bool
{
    $r = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($r, ['sales_representative', 'marketing', 'hr'], true);
}

/**
 * Self-scope for L1 lead list endpoints.
 *
 * @return array{sql: string, params: array}
 */
function hierarchyL1OwnLeadsScopeSql(array $tokenData, string $alias = ''): array
{
    $userId = $tokenData['user_id'] ?? null;
    if (empty($userId) || !is_string($userId)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    $idCol = $alias !== '' ? "{$alias}.id" : 'id';
    return [
        'sql' => " AND ({$col}assigned_to = ? OR {$col}referred_by = (SELECT referral_code FROM users WHERE id = ?) OR {$col}created_by = ? OR EXISTS (SELECT 1 FROM lead_assignments la WHERE la.lead_id = {$idCol} AND la.user_id = ?))",
        'params' => [$userId, $userId, $userId, $userId],
    ];
}

/**
 * Org filter for report queries (admin/org/finance/super_admin with org switch).
 *
 * @return array{sql: string, params: array}
 */
function reportsOrgScopeSql(array $tokenData, string $alias = '', ?PDO $db = null): array
{
    if (tenantIsMasterView($tokenData)) {
        return ['sql' => '', 'params' => []];
    }
    $orgId = $db instanceof PDO ? resolveCreatorOrgId($db, $tokenData) : getOrgId($tokenData);
    if ($orgId === null || $orgId === '') {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    return ['sql' => " AND {$col}org_id = ?", 'params' => [$orgId]];
}

/**
 * Lead ownership scope for analytics (matches leads.php).
 *
 * @return array{sql: string, params: array}
 */
function reportsLeadOwnershipScopeSql(PDO $db, array $tokenData, string $alias = 'l'): array
{
    return tenantLeadsScopeSql($db, $tokenData, $alias);
}

/**
 * @return array{sql: string, params: array}
 */
function reportsDealScopeSql(PDO $db, array $tokenData, string $alias = 'd'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    $org = tenantOrgScopeSql($db, $tokenData, $alias);
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $dl = hierarchyBuildInClause("{$col}owner_id", $visibleIds);
        return ['sql' => $org['sql'] . $dl['sql'], 'params' => array_merge($org['params'], $dl['params'])];
    }
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $uid = (string) ($tokenData['user_id'] ?? '');
        return ['sql' => $org['sql'] . " AND {$col}owner_id = ?", 'params' => array_merge($org['params'], [$uid])];
    }
    return $org;
}

/**
 * @return array{sql: string, params: array}
 */
function reportsTaskScopeSql(PDO $db, array $tokenData, string $alias = 't'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    $org = tenantOrgScopeSql($db, $tokenData, $alias);
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $dl = hierarchyTaskListScopeSql($visibleIds, $alias);
        return ['sql' => $org['sql'] . $dl['sql'], 'params' => array_merge($org['params'], $dl['params'])];
    }
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $uid = (string) ($tokenData['user_id'] ?? '');
        return [
            'sql' => $org['sql'] . " AND ({$col}assigned_to = ? OR {$col}created_by = ?)",
            'params' => array_merge($org['params'], [$uid, $uid]),
        ];
    }
    return $org;
}

/**
 * @return array{sql: string, params: array}
 */
function reportsContactScopeSql(PDO $db, array $tokenData, string $alias = 'c'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    $org = tenantOrgScopeSql($db, $tokenData, $alias);
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $dl = hierarchyBuildInClause("{$col}owner_id", $visibleIds);
        return ['sql' => $org['sql'] . $dl['sql'], 'params' => array_merge($org['params'], $dl['params'])];
    }
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $uid = (string) ($tokenData['user_id'] ?? '');
        return ['sql' => $org['sql'] . " AND {$col}owner_id = ?", 'params' => array_merge($org['params'], [$uid])];
    }
    return $org;
}

/**
 * Paid student payments visible to managers via downline lead / mentor ownership.
 *
 * @return array{sql: string, params: array}
 */
function reportsPaymentScopeSql(PDO $db, array $tokenData, string $alias = 'p'): array
{
    if (!hierarchyRoleUsesDownlineScope($tokenData)) {
        return reportsOrgScopeSql($tokenData, $alias, $db);
    }
    $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    return [
        'sql' => " AND {$col}student_id IN (
            SELECT s.id FROM students s
            LEFT JOIN leads l ON l.id = s.lead_id
            WHERE (
                (l.id IS NOT NULL AND (l.assigned_to IN ({$in}) OR l.referred_by IN (SELECT referral_code FROM users WHERE id IN ({$in}))))
                OR (l.id IS NULL AND (s.mentor_id IN ({$in}) OR s.user_id IN ({$in})))
            )
        )",
        'params' => array_merge($visibleIds, $visibleIds, $visibleIds, $visibleIds),
    ];
}

/**
 * Team roster scope for reports `team` action.
 *
 * @return array{sql: string, params: array}
 */
function reportsTeamUserScopeSql(PDO $db, array $tokenData): array
{
    $org = tenantOrgScopeSql($db, $tokenData, 'u');
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $dl = hierarchyBuildInClause('u.id', hierarchyGetVisibleUserIds($db, $tokenData));
        return ['sql' => $org['sql'] . $dl['sql'], 'params' => array_merge($org['params'], $dl['params'])];
    }
    return $org;
}

/**
 * Default From address for transactional CRM email (payment link share, etc.).
 * Set env SYNCPIEDIA_MAIL_FROM to override (e.g. support@syncpedia.in).
 */
function syncpediaSupportMailAddress(): string {
    $e = getenv('SYNCPIEDIA_MAIL_FROM');
    if ($e !== false && trim($e) !== '') {
        return trim($e);
    }
    if (defined('SMTP_SUPPORT_USER') && trim((string) SMTP_SUPPORT_USER) !== '') {
        return strtolower(trim((string) SMTP_SUPPORT_USER));
    }
    return 'support@syncpedia.in';
}

function syncpediaSupportMailFromHeader(): string {
    $addr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';
    if (function_exists('mb_encode_mimeheader')) {
        return mb_encode_mimeheader($disp, 'UTF-8', 'B', "\r\n") . ' <' . $addr . '>';
    }
    return 'Syncpedia <' . $addr . '>';
}

/** Legal name in payment-request style emails (header/footer). Override with SYNCPIEDIA_MAIL_LEGAL_NAME. */
function syncpediaMailLegalEntityName(): string {
    $e = getenv('SYNCPIEDIA_MAIL_LEGAL_NAME');
    if ($e !== false && trim($e) !== '') {
        return trim($e);
    }
    return 'Syncpedia Technologies Pvt Ltd';
}

/** Optional HTTPS logo URL for payment emails (white header tile). SYNCPIEDIA_MAIL_LOGO_URL */
function syncpediaMailBrandingLogoUrl(): ?string {
    $e = getenv('SYNCPIEDIA_MAIL_LOGO_URL');
    if ($e === false || trim($e) === '') {
        return null;
    }
    $u = trim($e);
    if (!filter_var($u, FILTER_VALIDATE_URL)) {
        return null;
    }
    if (!preg_match('#^https?://#i', $u)) {
        return null;
    }
    return $u;
}

/** Razorpay payment links — PHP API at /api/payment-links (see payment-links.php). */
function syncpediaBuildPaymentLinkRequestEmailHtml(
    string $customerName,
    string $customerEmail,
    ?string $customerPhone,
    string $descriptionLine,
    float $amountRupees,
    string $payUrl,
    string $receiptRef
): string {
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $logoUrl = syncpediaMailBrandingLogoUrl();
    $name = $h($customerName);
    $email = $h($customerEmail);
    $desc = $h($descriptionLine !== '' ? $descriptionLine : 'Payment request');
    $url = $h($payUrl);
    $amt = $h('INR ' . number_format($amountRupees, 2, '.', ','));
    $phoneTrim = $customerPhone !== null ? trim($customerPhone) : '';
    $issuedBlock = '<div style="font-size:16px;line-height:1.5;color:#1e293b;padding-top:6px;">' . $name . '</div>';
    if ($phoneTrim !== '') {
        $issuedBlock .= '<div style="font-size:16px;line-height:1.5;color:#1e293b;padding-top:4px;">' . $h($phoneTrim) . '</div>';
    }
    $receiptLine = '';
    if (trim($receiptRef) !== '') {
        $receiptLine = '<tr><td align="center" style="padding:8px 24px 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#e2e8f0;">Payment Link Id: ' . $h(trim($receiptRef)) . '</td></tr>';
    }
    $logoCell = '';
    if ($logoUrl !== null) {
        $logoCell = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;background:#ffffff;border-radius:2px;"><tr><td style="padding:10px 14px;">'
            . '<img src="' . $h($logoUrl) . '" alt="' . $legal . '" width="140" style="display:block;max-width:160px;height:auto;border:0;" />'
            . '</td></tr></table>';
    } else {
        $logoCell = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;background:#ffffff;border-radius:2px;"><tr><td style="padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;">'
            . '<span style="font-weight:800;color:#0f2318;letter-spacing:0.04em;">SYNC</span><span style="font-weight:600;color:#1a4d2e;letter-spacing:0.02em;">pedia</span>'
            . '</td></tr></table>';
    }

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1" />'
        . '<title>Payment request</title></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">'
        . '<tr><td style="background:#0f2318;padding:28px 24px 32px 24px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        . '<tr><td align="center" style="padding:0 0 20px 0;">' . $logoCell . '</td></tr>'
        . '<tr><td align="center" style="padding:0 8px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.35;font-weight:700;color:#ffffff;">Payment requested by ' . $legal . '</td></tr>'
        . $receiptLine
        . '</table></td></tr>'
        . '<tr><td style="background:#ffffff;padding:0 1px 1px 1px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">'
        . '<tr><td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;">'
        . '<div style="font-size:11px;letter-spacing:0.08em;color:#94a3b8;font-weight:600;">PAYMENT FOR</div>'
        . '<div style="font-size:16px;line-height:1.5;color:#1e293b;padding-top:6px;">' . $desc . '</div>'
        . '<div style="padding-top:22px;font-size:11px;letter-spacing:0.08em;color:#94a3b8;font-weight:600;">ISSUED TO</div>'
        . $issuedBlock
        . '<div style="padding-top:4px;font-size:15px;"><a href="mailto:' . $email . '" style="color:#2563eb;text-decoration:none;">' . $email . '</a></div>'
        . '</td></tr>'
        . '<tr><td style="padding:0 28px;"><div style="border-top:1px dashed #cbd5e1;font-size:0;line-height:0;">&nbsp;</div></td></tr>'
        . '<tr><td style="padding:20px 28px 28px 28px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        . '<td valign="top" style="font-family:Arial,Helvetica,sans-serif;">'
        . '<div style="font-size:11px;letter-spacing:0.08em;color:#94a3b8;font-weight:600;">AMOUNT PAYABLE</div>'
        . '<div style="font-size:26px;line-height:1.2;font-weight:700;color:#1e293b;padding-top:6px;">' . $amt . '</div>'
        . '</td>'
        . '<td valign="middle" align="right" style="font-family:Arial,Helvetica,sans-serif;">'
        . '<a href="' . $url . '" style="display:inline-block;padding:14px 22px;background:#0f2318;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.06em;">PROCEED TO PAY</a>'
        . '</td></tr></table>'
        . '</td></tr></table></td></tr>'
        . '<tr><td align="center" style="padding:16px 12px 4px 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;">' . $legal . '</td></tr>'
        . '<tr><td align="center" style="padding:0 16px 8px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;">'
        . '1-3-307, Opp IOB Street No. 3, Chikkadpall Ashoknagar (Hyderabad) Hyderabad Musheerabad Telangana 500020'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:0 16px 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;">'
        . 'This message was sent by Syncpedia. If you did not expect it, you can ignore this email.'
        . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}

/**
 * Payment link reminder from support@syncpedia.in (pending link or balance after partial pay).
 */
function syncpediaBuildPaymentLinkReminderEmailHtml(
    string $customerName,
    string $customerEmail,
    ?string $customerPhone,
    string $descriptionLine,
    float $totalAmountRupees,
    float $amountPaidRupees,
    string $payUrl,
    string $paymentLinkId,
    bool $isPartialBalance,
): string {
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $balance = max(0, $totalAmountRupees - $amountPaidRupees);
    $headline = $isPartialBalance
        ? 'Reminder: balance due on your payment'
        : 'Reminder: complete your payment';
    $intro = $isPartialBalance
        ? 'Thank you for your partial payment. Please complete the remaining balance using the link below.'
        : 'This is a friendly reminder to complete your pending payment.';
    $amtBlock = '';
    if ($isPartialBalance) {
        $amtBlock = '<tr><td style="padding:8px 0;color:#64748b;">Paid so far</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#15803d;">'
            . $h('INR ' . number_format($amountPaidRupees, 2, '.', ',')) . '</td></tr>'
            . '<tr><td style="padding:8px 0;color:#64748b;">Balance due</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:18px;color:#b45309;">'
            . $h('INR ' . number_format($balance, 2, '.', ',')) . '</td></tr>'
            . '<tr><td style="padding:8px 0;color:#64748b;">Total amount</td><td style="padding:8px 0;text-align:right;">'
            . $h('INR ' . number_format($totalAmountRupees, 2, '.', ',')) . '</td></tr>';
    } else {
        $amtBlock = '<tr><td style="padding:8px 0;color:#64748b;">Amount payable</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:18px;">'
            . $h('INR ' . number_format($totalAmountRupees, 2, '.', ',')) . '</td></tr>';
    }
    $payAmountLabel = $isPartialBalance
        ? 'PAY REMAINING BALANCE'
        : 'PROCEED TO PAY';
    $url = $h($payUrl);
    $phoneTrim = $customerPhone !== null ? trim($customerPhone) : '';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:8px;overflow:hidden;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#fff;text-align:center;">'
        . '<div style="font-size:20px;font-weight:700;">' . $h($headline) . '</div>'
        . '<div style="font-size:13px;margin-top:8px;opacity:0.9;">' . $legal . '</div>'
        . '</td></tr>'
        . '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;">'
        . '<p style="margin:0 0 12px;">Dear ' . $h($customerName) . ',</p>'
        . '<p style="margin:0 0 16px;">' . $h($intro) . '</p>'
        . '<p style="margin:0 0 8px;font-size:11px;letter-spacing:0.08em;color:#94a3b8;font-weight:600;">PAYMENT FOR</p>'
        . '<p style="margin:0 0 16px;font-weight:600;">' . $h($descriptionLine !== '' ? $descriptionLine : 'Payment') . '</p>'
        . '<table style="width:100%;border-collapse:collapse;font-size:14px;">' . $amtBlock . '</table>'
        . ($phoneTrim !== '' ? '<p style="margin:12px 0 0;font-size:13px;color:#64748b;">Contact: ' . $h($phoneTrim) . '</p>' : '')
        . '<p style="margin:20px 0;text-align:center;">'
        . '<a href="' . $url . '" style="display:inline-block;padding:14px 22px;background:#0f2318;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;">' . $h($payAmountLabel) . '</a>'
        . '</p>'
        . '<p style="margin:0;font-size:12px;color:#64748b;">Payment link ID: <span style="font-family:monospace;">' . $h($paymentLinkId) . '</span></p>'
        . '<p style="margin:16px 0 0;font-size:12px;color:#64748b;">Sent from support@syncpedia.in — reply if you need help.</p>'
        . '</td></tr></table></td></tr></table></body></html>';
}

/** Payment receipt email (after paid / partial payment on a Razorpay payment link). */
function syncpediaBuildPaymentReceiptEmailHtml(
    string $customerName,
    float $amountPaidRupees,
    float $totalAmountRupees,
    float $cumulativePaidRupees,
    string $invoiceNumber,
    string $paymentId,
    string $description,
    bool $isPartial,
): string {
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $title = $isPartial ? 'Partial payment received' : 'Payment received — thank you';
    $amtLine = $h('INR ' . number_format($amountPaidRupees, 2, '.', ','));
    $totalLine = $h('INR ' . number_format($totalAmountRupees, 2, '.', ','));
    $paidSoFar = $h('INR ' . number_format($cumulativePaidRupees, 2, '.', ','));
    $balance = max(0, $totalAmountRupees - $cumulativePaidRupees);
    $balanceLine = $h('INR ' . number_format($balance, 2, '.', ','));

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:8px;overflow:hidden;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#fff;text-align:center;">'
        . '<div style="font-size:20px;font-weight:700;">' . $h($title) . '</div>'
        . '<div style="font-size:13px;margin-top:8px;opacity:0.9;">' . $legal . '</div>'
        . '</td></tr>'
        . '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;">'
        . '<p style="margin:0 0 16px;">Dear ' . $h($customerName) . ',</p>'
        . '<p style="margin:0 0 16px;">We have received your payment. Your invoice is attached to this email.</p>'
        . '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
        . '<tr><td style="padding:8px 0;color:#64748b;">Payment for</td><td style="padding:8px 0;text-align:right;font-weight:600;">' . $h($description !== '' ? $description : 'Course fee') . '</td></tr>'
        . '<tr><td style="padding:8px 0;color:#64748b;">' . ($isPartial ? 'Amount paid (this payment)' : 'Amount paid') . '</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:18px;color:#15803d;">' . $amtLine . '</td></tr>'
        . '<tr><td style="padding:8px 0;color:#64748b;">Total link amount</td><td style="padding:8px 0;text-align:right;">' . $totalLine . '</td></tr>'
        . '<tr><td style="padding:8px 0;color:#64748b;">Paid so far</td><td style="padding:8px 0;text-align:right;">' . $paidSoFar . '</td></tr>'
        . ($isPartial && $balance > 0.009
            ? '<tr><td style="padding:8px 0;color:#64748b;">Balance due</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#b45309;">' . $balanceLine . '</td></tr>'
            : '')
        . '<tr><td style="padding:8px 0;color:#64748b;">Invoice no.</td><td style="padding:8px 0;text-align:right;font-family:monospace;">' . $h($invoiceNumber) . '</td></tr>'
        . ($paymentId !== '' ? '<tr><td style="padding:8px 0;color:#64748b;">Payment ID</td><td style="padding:8px 0;text-align:right;font-family:monospace;font-size:12px;">' . $h($paymentId) . '</td></tr>' : '')
        . '</table>'
        . '<p style="margin:20px 0 0;font-size:12px;color:#64748b;">Questions? Reply to this email or contact support@syncpedia.in</p>'
        . '</td></tr></table></td></tr></table></body></html>';
}

/**
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string, from?: string}
 */
function syncpediaSendPaymentReceiptEmail(
    string $to,
    string $subject,
    string $htmlBody,
    string $plainBody,
    array $attachments = [],
): array {
    syncpediaSetMailCategory('payment_receipts');
    $fromAddr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';

    if (syncpediaLoadComposerAutoload()) {
        $smtp = syncpediaSendHtmlEmailViaSmtpWithOptions(
            $to,
            $subject,
            $htmlBody,
            $fromAddr,
            $disp,
            '',
            '',
            $attachments,
            $plainBody,
        );
        if ($smtp['ok']) {
            $smtp['from'] = $smtp['from'] ?? $fromAddr;
            $smtp['transport'] = 'smtp';
            return $smtp;
        }
        error_log('[email] payment receipt SMTP failed: ' . ($smtp['error'] ?? ''));
        return [
            'ok' => false,
            'error' => $smtp['error'] ?? 'SMTP send failed — receipt not emailed',
            'from' => $fromAddr,
            'transport' => 'smtp',
        ];
    }

    return [
        'ok' => false,
        'error' => 'SMTP is not configured — cannot send payment receipt email',
        'from' => $fromAddr,
        'transport' => 'none',
    ];
}

/** Base URL for CRM login links in emails. Override with SYNCPIEDIA_CRM_URL (no trailing slash). */
function syncpediaCrmAppBaseUrl(): string {
    $e = getenv('SYNCPIEDIA_CRM_URL');
    if ($e !== false && trim($e) !== '') {
        return rtrim(trim($e), '/');
    }
    return 'https://crm.syncpedia.in';
}

/** Browser login path for welcome / reset emails (all except super_admin → /login). */
function syncpediaRoleLoginPath(string $roleKey): string
{
    $r = syncpediaNormalizeRoleKey($roleKey);
    if ($r === 'super_admin') {
        return '/super_admin';
    }
    return '/login';
}

function syncpediaTeamWelcomeRoleLabel(string $roleKey): string {
    $k = syncpediaNormalizeRoleKey($roleKey);
    $map = [
        'super_admin' => 'Super Admin',
        'org' => 'Org Admin',
        'manager' => 'Manager',
        'operational_manager' => 'Operational Manager',
        'sales_representative' => 'Sales Rep',
        'marketing' => 'Marketing',
        'hr' => 'HR',
        'student' => 'Student',
    ];
    return $map[$k] ?? ucfirst(str_replace('_', ' ', $k));
}

/** Welcome email after team member create (credentials + sign-in link). */
function syncpediaBuildTeamMemberWelcomeEmailHtml(
    string $fullName,
    string $loginEmail,
    string $plainPassword,
    string $roleKey,
    ?string $phone
): string {
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $loginUrl = $h(syncpediaCrmAppBaseUrl() . syncpediaRoleLoginPath($roleKey));
    $roleL = $h(syncpediaTeamWelcomeRoleLabel($roleKey));
    $phoneHtml = '';
    if ($phone !== null && trim($phone) !== '') {
        $phoneHtml = '<tr><td style="padding:14px 0 0 0;font-size:11px;letter-spacing:0.06em;color:#94a3b8;font-weight:600;">PHONE</td></tr>'
            . '<tr><td style="font-size:15px;color:#1e293b;">' . $h(trim($phone)) . '</td></tr>';
    }

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;text-align:center;">'
        . 'Your Syncpedia CRM account'
        . '</td></tr>'
        . '<tr><td style="background:#ffffff;padding:28px;font-family:Arial,Helvetica,sans-serif;">'
        . '<p style="margin:0 0 18px 0;font-size:16px;line-height:1.5;color:#1e293b;">Hello ' . $h($fullName) . ',</p>'
        . '<p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#475569;">Your account is ready. Sign in with the credentials below:</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:6px;">'
        . '<tr><td style="padding:16px 18px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        . '<tr><td style="font-size:11px;letter-spacing:0.06em;color:#94a3b8;font-weight:600;">EMAIL (LOGIN)</td></tr>'
        . '<tr><td style="padding:4px 0 0 0;font-size:15px;color:#0f2318;font-weight:600;word-break:break-all;">' . $h($loginEmail) . '</td></tr>'
        . '<tr><td style="padding:14px 0 0 0;font-size:11px;letter-spacing:0.06em;color:#94a3b8;font-weight:600;">TEMPORARY PASSWORD</td></tr>'
        . '<tr><td style="padding:4px 0 0 0;font-size:15px;color:#0f2318;font-weight:600;font-family:Consolas,monospace;">' . $h($plainPassword) . '</td></tr>'
        . '<tr><td style="padding:14px 0 0 0;font-size:11px;letter-spacing:0.06em;color:#94a3b8;font-weight:600;">ROLE</td></tr>'
        . '<tr><td style="padding:4px 0 0 0;font-size:15px;color:#1e293b;">' . $roleL . '</td></tr>'
        . $phoneHtml
        . '</table></td></tr></table>'
        . '<p style="margin:22px 0 0 0;text-align:center;"><a href="' . $loginUrl . '" style="display:inline-block;padding:14px 26px;background:#0f2318;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.05em;">SIGN IN TO CRM</a></p>'
        . '<p style="margin:18px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Change your password after signing in. If you did not expect this message, contact your administrator.</p>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:12px;font-size:12px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;">' . $legal . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}

/**
 * Send welcome email with login credentials (from support@syncpedia.in).
 *
 * @return array{email_sent: bool, email_error: string|null, from: string}
 */
function syncpediaBuildPasswordResetOtpEmailHtml(string $fullName, string $otp): string
{
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $code = $h($otp);
    $name = trim($fullName) !== '' ? $h(trim($fullName)) : 'there';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;text-align:center;">'
        . 'Password reset code'
        . '</td></tr>'
        . '<tr><td style="background:#ffffff;padding:28px;font-family:Arial,Helvetica,sans-serif;">'
        . '<p style="margin:0 0 18px 0;font-size:16px;line-height:1.5;color:#1e293b;">Hello ' . $name . ',</p>'
        . '<p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#475569;">Use this one-time code to reset your Syncpedia CRM password. It expires in <strong>10 minutes</strong>.</p>'
        . '<p style="margin:0;text-align:center;font-size:32px;font-weight:700;letter-spacing:0.35em;color:#0f2318;font-family:Consolas,monospace;">' . $code . '</p>'
        . '<p style="margin:22px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">If you did not request this, you can ignore this email. Your password will stay the same.</p>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:12px;font-size:12px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;">' . $legal . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}

/**
 * @return array{email_sent: bool, email_error: string|null, from: string}
 */
/**
 * Password-reset OTP — SMTP only (no PHP mail() fallback; that often returns true without delivery).
 *
 * @return array{email_sent: bool, email_error: ?string, from: string}
 */
function syncpediaSendPasswordResetOtpEmail(string $toEmail, string $fullName, string $otp): array
{
    syncpediaSetMailCategory('password_reset');
    $from = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';
    $res = syncpediaSendHtmlEmailViaSmtp(
        $toEmail,
        'Your Syncpedia CRM password reset code',
        syncpediaBuildPasswordResetOtpEmailHtml($fullName, $otp),
        $from,
        $disp,
    );
    $ok = ($res['ok'] ?? false) === true;
    return [
        'email_sent' => $ok,
        'email_error' => $ok ? null : ($res['error'] ?? 'Email send failed'),
        'from' => (string) ($res['from'] ?? $from),
    ];
}

/**
 * Team welcome credentials — SMTP only (same transport as password-reset OTP).
 *
 * @return array{email_sent: bool, email_error: ?string, from: string}
 */
function syncpediaSendMemberWelcomeEmail(
    string $fullName,
    string $loginEmail,
    string $plainPassword,
    string $roleKey,
    ?string $phone = null,
): array {
    syncpediaSetMailCategory('member_welcome');
    $from = syncpediaSupportMailAddress();
    $phoneStr = is_string($phone) ? trim($phone) : '';
    $html = syncpediaBuildTeamMemberWelcomeEmailHtml(
        $fullName,
        $loginEmail,
        $plainPassword,
        $roleKey,
        $phoneStr !== '' ? $phoneStr : null,
    );
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';
    $res = syncpediaSendHtmlEmailViaSmtp(
        $loginEmail,
        'Your Syncpedia CRM login credentials',
        $html,
        $from,
        $disp,
    );
    $ok = ($res['ok'] ?? false) === true;
    return [
        'email_sent' => $ok,
        'email_error' => $ok ? null : ($res['error'] ?? 'Email send failed'),
        'from' => (string) ($res['from'] ?? $from),
    ];
}

/**
 * Fresher salary tracker — invite email summarising Phase 1 (training) and Phase 2 (Month 1).
 */
function syncpediaBuildFresherTrainingInviteEmailHtml(string $fullName, string $joiningDateIso): string
{
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $crmUrl = $h(syncpediaCrmAppBaseUrl() . '/');
    $j = trim($joiningDateIso);
    if ($j !== '') {
        $ts = strtotime($j . ' 12:00:00');
        $joinDisp = $ts !== false ? date('d M Y', $ts) : $h($j);
    } else {
        $joinDisp = 'As shared by your manager';
    }

    $phase1Title = 'Phase 1 — Training (first 15 days)';
    $phase1Body = 'This period is <strong>unpaid</strong>. Your sales achievement target is <strong>₹30,000</strong>. '
        . 'Enter your results in the internal fresher tracker with your team lead / admin so eligibility for the next step can be evaluated.';

    $phase2Title = 'Phase 2 — Month 1 (next 30 days)';
    $phase2Body = 'Your monthly sales target is <strong>₹1,60,000</strong>. '
        . 'If you achieve at least <strong>50% (₹80,000)</strong>, you move onto the <strong>fixed salary eligibility</strong> path for Month 2. '
        . 'Otherwise you continue on a <strong>performance-based</strong> track for Month 2. Details are maintained in the CRM fresher salary module.';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;text-align:center;">'
        . 'Welcome to fresher training'
        . '</td></tr>'
        . '<tr><td style="background:#ffffff;padding:28px;font-family:Arial,Helvetica,sans-serif;">'
        . '<p style="margin:0 0 8px 0;font-size:16px;line-height:1.5;color:#1e293b;">Hello ' . $h($fullName) . ',</p>'
        . '<p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#475569;">'
        . 'You have been enrolled in the <strong>Sales fresher salary / training track</strong>. '
        . 'Recorded joining date: <strong>' . $joinDisp . '</strong>.</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px;">'
        . '<tr><td style="padding:16px 18px;">'
        . '<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.06em;color:#0f5230;">' . $h($phase1Title) . '</p>'
        . '<p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">' . $phase1Body . '</p>'
        . '</td></tr></table>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;">'
        . '<tr><td style="padding:16px 18px;">'
        . '<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.06em;color:#0f5230;">' . $h($phase2Title) . '</p>'
        . '<p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">' . $phase2Body . '</p>'
        . '</td></tr></table>'
        . '<p style="margin:22px 0 0 0;text-align:center;"><a href="' . $crmUrl . '" style="display:inline-block;padding:14px 26px;background:#0f2318;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.05em;">OPEN CRM</a></p>'
        . '<p style="margin:18px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Reply to this email if you have questions. Your HR or sales manager can clarify track rules.</p>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:12px;font-size:12px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;">' . $legal . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}

/**
 * Deliver HTML email via SMTP only (default).
 * PHP mail() is a common Hostinger false-positive (returns true, inbox empty) — disabled unless
 * SMTP_ALLOW_MAIL_FALLBACK is explicitly true in api/config.php.
 *
 * @return array{ok: bool, error?: string, transport?: string}
 */
function syncpediaDeliverHtmlEmail(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
): array {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid recipient email'];
    }
    $smtp = syncpediaSendHtmlEmailViaSmtp($to, $subject, $htmlBody, $fromAddr, $fromDisplayName);
    if (!empty($smtp['ok'])) {
        $smtp['transport'] = 'smtp';
        return $smtp;
    }
    $smtpErr = trim((string) ($smtp['error'] ?? 'SMTP send failed'));
    error_log('[email] SMTP failed to ' . $to . ': ' . $smtpErr);
    return ['ok' => false, 'error' => $smtpErr, 'transport' => 'smtp'];
}

/**
 * Send HTML email as support@syncpedia.in (or SYNCPIEDIA_MAIL_FROM).
 *
 * @return array{ok: bool, error?: string}
 */
function syncpediaSendHtmlEmail(string $to, string $subject, string $htmlBody, string $category = 'default'): array
{
    syncpediaSetMailCategory($category);
    $fromAddr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';
    return syncpediaDeliverHtmlEmail($to, $subject, $htmlBody, $fromAddr, $disp);
}

/**
 * Send HTML email with explicit From (e.g. HR payment digest).
 *
 * @return array{ok: bool, error?: string}
 */
function syncpediaSendHtmlEmailWithFrom(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
    string $category = 'default',
): array {
    syncpediaSetMailCategory($category);
    return syncpediaDeliverHtmlEmail($to, $subject, $htmlBody, $fromAddr, $fromDisplayName);
}

/** Plain-text certificate email body → simple HTML wrapper. */
function syncpediaCertificateEmailHtml(string $plainBody): string
{
    $body = nl2br(htmlspecialchars($plainBody, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    $legal = htmlspecialchars(syncpediaMailLegalEntityName(), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;">'
        . '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">'
        . '<tr><td align="center">'
        . '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;padding:28px 32px;">'
        . '<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#334155;">'
        . $body
        . '</td></tr></table>'
        . '<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;text-align:center;">'
        . $legal
        . '</p></td></tr></table></body></html>';
}

/**
 * Send certificate email from support@syncpedia.in with optional PDF attachment.
 *
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string, from?: string}
 */
function syncpediaSendCertificateEmail(
    string $to,
    string $subject,
    string $plainBody,
    string $cc = '',
    string $bcc = '',
    array $attachments = [],
): array {
    syncpediaSetMailCategory('certificates');
    $fromAddr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia Certifications';
    $html = syncpediaCertificateEmailHtml($plainBody);

    if (syncpediaLoadComposerAutoload()) {
        $smtp = syncpediaSendHtmlEmailViaSmtpWithOptions(
            $to,
            $subject,
            $html,
            $fromAddr,
            $disp,
            $cc,
            $bcc,
            $attachments,
            $plainBody,
        );
        if ($smtp['ok']) {
            $smtp['from'] = $smtp['from'] ?? $fromAddr;
            $smtp['transport'] = 'smtp';
            return $smtp;
        }
        error_log('[email] certificate SMTP failed: ' . ($smtp['error'] ?? ''));
        return [
            'ok' => false,
            'error' => $smtp['error'] ?? 'SMTP send failed',
            'from' => $fromAddr,
            'transport' => 'smtp',
        ];
    }

    return [
        'ok' => false,
        'error' => 'SMTP is not configured — cannot send certificate email',
        'from' => $fromAddr,
        'transport' => 'none',
    ];
}

/** Default HR From address for payslips and HR digests. */
function syncpediaHrMailAddress(): string
{
    $e = getenv('SYNCPIEDIA_HR_DIGEST_FROM');
    if ($e !== false && trim($e) !== '') {
        return trim($e);
    }
    if (defined('SMTP_HR_USER') && trim((string) SMTP_HR_USER) !== '') {
        return trim((string) SMTP_HR_USER);
    }
    return 'hr@syncpedia.in';
}

/**
 * Send payslip email from hr@syncpedia.in with PDF attachment.
 *
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string, from?: string}
 */
function syncpediaSendPayslipEmail(
    string $to,
    string $subject,
    string $plainBody,
    array $attachments = [],
    string $cc = '',
    string $bcc = '',
): array {
    syncpediaSetMailCategory('payslips');
    $fromAddr = syncpediaHrMailAddress();
    $disp = 'Syncpedia HR';
    $html = syncpediaCertificateEmailHtml($plainBody);

    if (syncpediaLoadComposerAutoload()) {
        $smtp = syncpediaSendHtmlEmailViaSmtpWithOptions(
            $to,
            $subject,
            $html,
            $fromAddr,
            $disp,
            $cc,
            $bcc,
            $attachments,
            $plainBody,
        );
        if ($smtp['ok']) {
            $smtp['from'] = $smtp['from'] ?? $fromAddr;
            $smtp['transport'] = 'smtp';
            return $smtp;
        }
        error_log('[email] payslip SMTP failed: ' . ($smtp['error'] ?? ''));
        return [
            'ok' => false,
            'error' => $smtp['error'] ?? 'SMTP send failed',
            'from' => $fromAddr,
            'transport' => 'smtp',
        ];
    }

    return [
        'ok' => false,
        'error' => 'SMTP is not configured — cannot send payslip email',
        'from' => $fromAddr,
        'transport' => 'none',
    ];
}

/**
 * Send HTML email from hr@syncpedia.in (offer letters, etc.) with optional attachments.
 *
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string, from?: string}
 */
function syncpediaSendHrHtmlEmail(
    string $to,
    string $subject,
    string $htmlBody,
    array $attachments = [],
    string $altBody = '',
    string $cc = '',
    string $bcc = '',
): array {
    syncpediaSetMailCategory('offer_letters');
    $fromAddr = syncpediaHrMailAddress();
    $disp = 'Syncpedia HR';

    if (syncpediaLoadComposerAutoload()) {
        $smtp = syncpediaSendHtmlEmailViaSmtpWithOptions(
            $to,
            $subject,
            $htmlBody,
            $fromAddr,
            $disp,
            $cc,
            $bcc,
            $attachments,
            $altBody !== '' ? $altBody : trim(strip_tags($htmlBody)),
        );
        if ($smtp['ok']) {
            $smtp['from'] = $smtp['from'] ?? $fromAddr;
            $smtp['transport'] = 'smtp';
            return $smtp;
        }
        error_log('[email] HR SMTP failed: ' . ($smtp['error'] ?? ''));
        return [
            'ok' => false,
            'error' => $smtp['error'] ?? 'SMTP send failed',
            'from' => $fromAddr,
            'transport' => 'smtp',
        ];
    }

    // No attachments path can still use deliver (SMTP-only by default).
    if ($attachments === []) {
        $fallback = syncpediaDeliverHtmlEmail($to, $subject, $htmlBody, $fromAddr, $disp);
        if ($fallback['ok']) {
            $fallback['from'] = $fromAddr;
        }
        return $fallback;
    }

    return [
        'ok' => false,
        'error' => 'SMTP is not configured — cannot send HR email with attachments',
        'from' => $fromAddr,
        'transport' => 'none',
    ];
}

/**
 * Internal copy for support when someone sends the payment-link email to a customer.
 * Set SYNCPIEDIA_PAYMENT_LINK_NOTIFY=0 (or false/off/no) to disable.
 * Set SYNCPIEDIA_PAYMENT_LINK_NOTIFY_EMAIL to override recipient (default: same as From / support address).
 * Failures here are ignored so customer send success/failure responses are unchanged.
 *
 * @param string|null $failureError null when customer email was sent OK
 */
function syncpediaNotifySupportPaymentLinkCustomerMail(
    bool $customerMailOk,
    string $linkId,
    string $customerEmail,
    string $customerName,
    string $amountInrDisplay,
    string $salespersonName,
    string $salespersonEmail,
    ?string $failureError
): void {
    $off = getenv('SYNCPIEDIA_PAYMENT_LINK_NOTIFY');
    if ($off !== false && in_array(strtolower(trim((string) $off)), ['0', 'false', 'off', 'no'], true)) {
        return;
    }
    $raw = getenv('SYNCPIEDIA_PAYMENT_LINK_NOTIFY_EMAIL');
    $notify = ($raw !== false && trim((string) $raw) !== '') ? trim((string) $raw) : syncpediaSupportMailAddress();
    if (!filter_var($notify, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $subj = $customerMailOk
        ? '[CRM] Payment link email sent to customer'
        : '[CRM] Payment link email FAILED — customer not notified';
    $statusLine = $customerMailOk
        ? '<p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#15803d;">Result: sent successfully to the customer.</p>'
        : '<p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#b91c1c;">Result: send failed. The customer was not emailed.</p>';
    $errBlock = '';
    if (!$customerMailOk && $failureError !== null && trim($failureError) !== '') {
        $errBlock = '<p style="margin:0 0 12px 0;font-size:13px;color:#991b1b;"><strong>Error:</strong> ' . $h($failureError) . '</p>';
    }
    $html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;background:#f8fafc;">'
        . '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;">'
        . '<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;">Syncpedia CRM — payment link “send to customer”</p>'
        . $statusLine
        . $errBlock
        . '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
        . '<tr><td style="padding:6px 0;color:#64748b;width:140px;">Payment link ID</td><td style="padding:6px 0;">' . $h($linkId !== '' ? $linkId : '—') . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;">' . $h($customerName) . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#64748b;">Customer email</td><td style="padding:6px 0;">' . $h($customerEmail) . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="padding:6px 0;">' . $h($amountInrDisplay) . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#64748b;">Salesperson</td><td style="padding:6px 0;">' . $h($salespersonName !== '' ? $salespersonName : '—') . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#64748b;">Sales email</td><td style="padding:6px 0;">' . $h($salespersonEmail !== '' ? $salespersonEmail : '—') . '</td></tr>'
        . '</table>'
        . '<p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;">This is an automated internal notice. Disable with SYNCPIEDIA_PAYMENT_LINK_NOTIFY=0 or change recipient with SYNCPIEDIA_PAYMENT_LINK_NOTIFY_EMAIL.</p>'
        . '</div></body></html>';
    @syncpediaSendHtmlEmail($notify, $subj, $html, 'notifications');
}

function respond($data, $status = 200) {
    if (!defined('SYNCPIEDIA_API_DONE')) {
        define('SYNCPIEDIA_API_DONE', true);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    $debug = defined('APP_DEBUG') && APP_DEBUG === true;
    if (is_array($data) && !$debug) {
        unset($data['detail'], $data['file'], $data['line'], $data['trace'], $data['exception']);
        if (isset($data['error']) && is_string($data['error'])
            && preg_match('/SQLSTATE|PDOException|Unknown column|Duplicate entry|mysqli_|syntax error/i', $data['error'])
        ) {
            $data['error'] = $status >= 500 ? 'Server error' : 'Request failed';
        }
    }
    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }
    if (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) {
        $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
    }
    $json = json_encode($data, $flags);
    if ($json === false) {
        $json = json_encode(['error' => 'Response encoding failed'], JSON_UNESCAPED_UNICODE);
    }
    echo $json;
    exit;
}

/** True when this lead already has a student row (duplicate enroll is safe to ignore).
 * Uses lead_id only so we do not swallow duplicate-email errors for a different lead.
 */
function enrollStudentRowAlreadyExists(PDO $db, string $leadId): bool {
    try {
        $q = $db->prepare('SELECT id FROM students WHERE lead_id = ? LIMIT 1');
        $q->execute([$leadId]);
        return (bool) $q->fetch();
    } catch (Throwable $ignored) {
        return false;
    }
}

/**
 * Upsert one lead_assignments row (idempotent under unique index).
 */
function leadsUpsertAssignmentRow(PDO $db, string $leadId, string $userId): void
{
    $exists = $db->prepare('SELECT id FROM lead_assignments WHERE lead_id = ? AND user_id = ? LIMIT 1');
    $exists->execute([$leadId, $userId]);
    if ($exists->fetch()) {
        return;
    }
    try {
        $db->prepare('INSERT INTO lead_assignments (id, lead_id, user_id) VALUES (?,?,?)')
            ->execute([generateUUID(), $leadId, $userId]);
    } catch (Throwable $e) {
        if (!isMysqlDuplicateKey($e)) {
            throw $e;
        }
    }
}

/**
 * Replace the full assignee set for a lead (multi-member assign).
 * Primary owner = first user id; empty list clears assignment.
 *
 * @param list<string> $userIds
 * @throws Throwable on DB failure (callers must not swallow)
 */
function leadsReplaceAssignees(PDO $db, string $leadId, array $userIds): void
{
    $leadId = trim($leadId);
    if ($leadId === '') {
        throw new InvalidArgumentException('lead_id required');
    }
    $normalized = [];
    foreach ($userIds as $uid) {
        $uid = trim((string) $uid);
        if ($uid !== '' && !isset($normalized[$uid])) {
            $normalized[$uid] = true;
        }
    }
    $ids = array_keys($normalized);

    ensureLeadAssignmentsUnique($db);
    $ownTxn = !$db->inTransaction();
    if ($ownTxn) {
        $db->beginTransaction();
    }
    try {
        $lock = $db->prepare('SELECT id FROM leads WHERE id = ? FOR UPDATE');
        $lock->execute([$leadId]);
        if (!$lock->fetch()) {
            throw new RuntimeException('Lead not found');
        }
        if ($ids === []) {
            $db->prepare('UPDATE leads SET assigned_to = NULL WHERE id = ?')->execute([$leadId]);
            $db->prepare('DELETE FROM lead_assignments WHERE lead_id = ?')->execute([$leadId]);
        } else {
            $primary = $ids[0];
            $db->prepare('UPDATE leads SET assigned_to = ? WHERE id = ?')->execute([$primary, $leadId]);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $del = $db->prepare("DELETE FROM lead_assignments WHERE lead_id = ? AND user_id NOT IN ($placeholders)");
            $del->execute(array_merge([$leadId], $ids));
            foreach ($ids as $uid) {
                leadsUpsertAssignmentRow($db, $leadId, $uid);
            }
        }
        if ($ownTxn) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownTxn && $db->inTransaction()) {
            try {
                $db->rollBack();
            } catch (Throwable $ignored) {
            }
        }
        throw $e;
    }
}

/**
 * Set primary assignee. When $exclusive is true (default), replaces the full set with this one user
 * (create / single reassign). When false, upserts the user into the multi-assign set and sets
 * assigned_to only if currently empty (or to this user when forcing primary via exclusive).
 *
 * @throws Throwable on DB failure (callers must not swallow)
 */
function leadsSetAssignee(PDO $db, string $leadId, ?string $userId, bool $exclusive = true): void
{
    $leadId = trim($leadId);
    if ($leadId === '') {
        throw new InvalidArgumentException('lead_id required');
    }
    $uid = $userId !== null ? trim($userId) : '';
    if ($exclusive || $uid === '') {
        leadsReplaceAssignees($db, $leadId, $uid === '' ? [] : [$uid]);
        return;
    }

    ensureLeadAssignmentsUnique($db);
    $ownTxn = !$db->inTransaction();
    if ($ownTxn) {
        $db->beginTransaction();
    }
    try {
        $lock = $db->prepare('SELECT id, assigned_to FROM leads WHERE id = ? FOR UPDATE');
        $lock->execute([$leadId]);
        $row = $lock->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('Lead not found');
        }
        leadsUpsertAssignmentRow($db, $leadId, $uid);
        $primary = trim((string) ($row['assigned_to'] ?? ''));
        if ($primary === '') {
            $db->prepare('UPDATE leads SET assigned_to = ? WHERE id = ?')->execute([$uid, $leadId]);
        }
        if ($ownTxn) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownTxn && $db->inTransaction()) {
            try {
                $db->rollBack();
            } catch (Throwable $ignored) {
            }
        }
        throw $e;
    }
}

/** Best-effort UNIQUE(lead_id, user_id) so concurrent assigns cannot create duplicate rows. */
function ensureLeadAssignmentsUnique(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $db->exec('CREATE UNIQUE INDEX uq_lead_assignments_lead_user ON lead_assignments (lead_id, user_id)');
    } catch (Throwable $e) {
        error_log('[lead_assignments] unique index: ' . $e->getMessage());
    }
}

/**
 * Drop/unlink student for a lead and release batch seats (clear batch_id/course_id).
 */
function leadsDropStudentForLead(PDO $db, string $leadId): void
{
    $leadId = trim($leadId);
    if ($leadId === '') {
        return;
    }
    try {
        $db->prepare(
            "UPDATE students
             SET lead_id = NULL, status = 'dropped', batch_id = NULL, course_id = NULL
             WHERE lead_id = ?",
        )->execute([$leadId]);
    } catch (Throwable $e) {
        // Older schemas may lack course_id/batch_id — fall back to status unlink only.
        try {
            $db->prepare("UPDATE students SET lead_id = NULL, status = 'dropped' WHERE lead_id = ?")->execute([$leadId]);
        } catch (Throwable $ignored) {
            error_log('[students] drop for lead failed: ' . $e->getMessage());
        }
    }
}

/** Active linked students occupying a batch seat. */
function studentsActiveSeatCount(PDO $db, string $batchId): int
{
    $batchId = trim($batchId);
    if ($batchId === '') {
        return 0;
    }
    try {
        $st = $db->prepare(
            "SELECT COUNT(*) FROM students
             WHERE batch_id = ?
               AND lead_id IS NOT NULL AND TRIM(lead_id) <> ''
               AND LOWER(TRIM(COALESCE(status, 'active'))) NOT IN ('dropped', 'inactive', 'deleted')",
        );
        $st->execute([$batchId]);
        return (int) $st->fetchColumn();
    } catch (Throwable $e) {
        $st = $db->prepare('SELECT COUNT(*) FROM students WHERE batch_id = ?');
        $st->execute([$batchId]);
        return (int) $st->fetchColumn();
    }
}

/** Best-effort unique index so concurrent enrolls cannot create two students per lead. */
function ensureStudentsLeadIdUnique(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        if (!syncpediaColumnExists($db, 'students', 'lead_id')) {
            return;
        }
        $db->exec('CREATE UNIQUE INDEX idx_students_lead_id_unique ON students (lead_id)');
    } catch (Throwable $e) {
        // Index may already exist, or duplicates prevent creation — log and continue.
        error_log('[students] unique lead_id index: ' . $e->getMessage());
    }
}

/** Who enrolled the student (team member). Safe on older DBs. */
function ensureStudentsEnrolledByColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        if (!syncpediaColumnExists($db, 'students', 'enrolled_by')) {
            $db->exec('ALTER TABLE students ADD COLUMN enrolled_by CHAR(36) DEFAULT NULL');
        }
        try {
            $db->exec('CREATE INDEX idx_students_enrolled_by ON students (enrolled_by)');
        } catch (Throwable $ignored) {
            /* index may already exist */
        }
    } catch (Throwable $e) {
        error_log('[students] enrolled_by column: ' . $e->getMessage());
    }
}

/** Pipeline statuses on `leads.status` (aligned with leads.php PUT). */
function leadsAllowedStatuses(): array {
    return [
        'new',
        'contacted',
        'not_answered',
        'messaged',
        'qualified',
        'interested',
        'demo_scheduled',
        'demo_attended',
        'enrolled',
        'lost',
    ];
}

/**
 * Normalize legacy / UI aliases to canonical CRM statuses.
 */
function leadsNormalizeStatus(string $status): string
{
    $s = strtolower(trim($status));
    if ($s === 'converted') {
        return 'enrolled';
    }
    if ($s === 'considering') {
        return 'interested';
    }
    if ($s === 'not_interested') {
        return 'lost';
    }
    return $s;
}

/**
 * Valid status transitions (ops-friendly: forward, small rewind, lost/reopen).
 *
 * @return string|null error message, or null when OK
 */
function leadsAssertStatusTransition(?string $fromStatus, string $toStatus): ?string
{
    $from = leadsNormalizeStatus((string) ($fromStatus ?? 'new'));
    $to = leadsNormalizeStatus($toStatus);
    if ($from === $to) {
        return null;
    }
    if (!in_array($to, leadsAllowedStatuses(), true)) {
        return 'Invalid status';
    }
    if (!in_array($from, leadsAllowedStatuses(), true)) {
        // Legacy junk in DB — treat as starting from "new".
        $from = 'new';
    }

    // Ops-friendly: forward, small rewind, lost/reopen. Enrolled only → lost (or stay).
    $allowed = [
        'new' => ['contacted', 'not_answered', 'messaged', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'contacted' => ['new', 'not_answered', 'messaged', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'not_answered' => ['new', 'contacted', 'messaged', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'messaged' => ['new', 'contacted', 'not_answered', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'qualified' => ['contacted', 'not_answered', 'messaged', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'interested' => ['contacted', 'not_answered', 'messaged', 'qualified', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'demo_scheduled' => ['interested', 'qualified', 'demo_attended', 'enrolled', 'lost', 'contacted'],
        'demo_attended' => ['demo_scheduled', 'interested', 'enrolled', 'lost'],
        'enrolled' => ['lost'],
        'lost' => ['new', 'contacted', 'not_answered', 'messaged', 'interested', 'qualified', 'demo_scheduled', 'enrolled'],
    ];
    $ok = $allowed[$from] ?? [];
    if (!in_array($to, $ok, true)) {
        return "Cannot change status from {$from} to {$to}";
    }
    return null;
}

/**
 * Find an existing lead in the same org by email or phone (normalized).
 */
function leadsFindDuplicateInOrg(PDO $db, ?string $orgId, string $email, string $phone): ?array
{
    $email = strtolower(trim($email));
    $phoneDigits = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($phoneDigits) > 10) {
        $phoneDigits = substr($phoneDigits, -10);
    }
    if ($email === '' && $phoneDigits === '') {
        return null;
    }

    if ($email !== '') {
        if ($orgId) {
            $st = $db->prepare(
                'SELECT id, name, email, phone FROM leads WHERE org_id = ? AND email IS NOT NULL AND LOWER(TRIM(email)) = ? LIMIT 1',
            );
            $st->execute([$orgId, $email]);
        } else {
            $st = $db->prepare(
                'SELECT id, name, email, phone FROM leads WHERE email IS NOT NULL AND LOWER(TRIM(email)) = ? LIMIT 1',
            );
            $st->execute([$email]);
        }
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            return $row;
        }
    }

    if ($phoneDigits !== '' && strlen($phoneDigits) >= 10) {
        // Match by last 10 digits (handles +91 / spacing variants).
        if ($orgId) {
            $st = $db->prepare(
                "SELECT id, name, email, phone FROM leads
                 WHERE org_id = ? AND phone IS NOT NULL AND TRIM(phone) <> ''
                   AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(',''),')','') LIKE ?
                 LIMIT 1",
            );
            $st->execute([$orgId, '%' . $phoneDigits]);
        } else {
            $st = $db->prepare(
                "SELECT id, name, email, phone FROM leads
                 WHERE phone IS NOT NULL AND TRIM(phone) <> ''
                   AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(',''),')','') LIKE ?
                 LIMIT 1",
            );
            $st->execute(['%' . $phoneDigits]);
        }
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            return $row;
        }
    }
    return null;
}

/**
 * Load an org's dedup keys once so bulk import can check duplicates in memory
 * instead of running one full-table REPLACE(...) LIKE scan per imported row.
 *
 * Semantics mirror leadsFindDuplicateInOrg exactly:
 * - emails: LOWER(TRIM(email)) equality
 * - phones: last 10 chars of phone with " -+()" stripped (suffix match)
 *
 * @return array{emails: array<string, array{id: string, name: string}>, phones: array<string, array{id: string, name: string}>}
 */
function leadsLoadDedupIndex(PDO $db, string $orgId): array
{
    $index = ['emails' => [], 'phones' => []];
    $st = $db->prepare('SELECT id, name, email, phone FROM leads WHERE org_id = ?');
    $st->execute([$orgId]);
    while (($row = $st->fetch(PDO::FETCH_ASSOC)) !== false) {
        $ref = ['id' => (string) $row['id'], 'name' => (string) ($row['name'] ?? '')];
        $email = strtolower(trim((string) ($row['email'] ?? '')));
        if ($email !== '' && !isset($index['emails'][$email])) {
            $index['emails'][$email] = $ref;
        }
        $phone = trim((string) ($row['phone'] ?? ''));
        if ($phone !== '') {
            $stripped = str_replace([' ', '-', '+', '(', ')'], '', $phone);
            if (strlen($stripped) >= 10) {
                $key = substr($stripped, -10);
                if (!isset($index['phones'][$key])) {
                    $index['phones'][$key] = $ref;
                }
            }
        }
    }
    return $index;
}

function userEffectiveOrgId(PDO $db, array $tokenData, string $userId): ?string {
    $oid = $tokenData['org_id'] ?? null;
    if ($oid !== null && trim((string) $oid) !== '') {
        return trim((string) $oid);
    }
    try {
        $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $oid = $row['org_id'] ?? null;
        return ($oid !== null && trim((string) $oid) !== '') ? trim((string) $oid) : null;
    } catch (Throwable $ignored) {
        return null;
    }
}

/** Org-scoped student access for PUT/DELETE (super_admin bypasses). */
function userCanAccessStudentRow(PDO $db, array $tokenData, string $userId, string $rawRole, array $studentRow): bool {
    $role = syncpediaNormalizeRoleKey($rawRole);
    if ($role === 'super_admin' && tenantIsMasterView($tokenData)) {
        return true;
    }
    $orgId = userEffectiveOrgId($db, $tokenData, $userId);
    if ($orgId === null || $orgId === '') {
        return false;
    }
    $studentOrg = trim((string) ($studentRow['org_id'] ?? ''));
    if ($studentOrg !== '' && $studentOrg === $orgId) {
        return true;
    }
    // Legacy rows with empty org_id: admins/managers in the tenant may still manage them.
    if ($studentOrg === '' && in_array($role, ['admin', 'org', 'manager', 'super_admin'], true)) {
        return true;
    }
    $leadId = trim((string) ($studentRow['lead_id'] ?? ''));
    if ($leadId !== '') {
        try {
            $st = $db->prepare('SELECT org_id FROM leads WHERE id = ? LIMIT 1');
            $st->execute([$leadId]);
            $leadOrg = trim((string) ($st->fetch(PDO::FETCH_ASSOC)['org_id'] ?? ''));
            if ($leadOrg !== '' && $leadOrg === $orgId) {
                return true;
            }
        } catch (Throwable $ignored) {
        }
    }
    $email = trim((string) ($studentRow['email'] ?? ''));
    if ($email !== '') {
        try {
            $st = $db->prepare('SELECT org_id FROM leads WHERE email = ? AND org_id = ? ORDER BY created_at DESC LIMIT 1');
            $st->execute([$email, $orgId]);
            $leadOrg = trim((string) ($st->fetch(PDO::FETCH_ASSOC)['org_id'] ?? ''));
            if ($leadOrg === $orgId) {
                return true;
            }
        } catch (Throwable $ignored) {
        }
    }
    return false;
}

/** Same visibility as listing a lead: if it appears in the member's Leads scope, they may update it. */
function userCanUpdateLeadForCallLog(PDO $db, array $tokenData, string $userId, string $rawRole, array $leadRow): bool {
    $rawRole = syncpediaNormalizeRoleKey($rawRole);
    if ($rawRole === 'super_admin') {
        return true;
    }
    $leadId = trim((string) ($leadRow['id'] ?? ''));
    if ($leadId === '') {
        return false;
    }
    $scope = tenantLeadsScopeSql($db, $tokenData, 'l');
    $st = $db->prepare("SELECT l.id FROM leads l WHERE l.id = ?{$scope['sql']} LIMIT 1");
    $st->execute(array_merge([$leadId], $scope['params']));

    return (bool) $st->fetch(PDO::FETCH_ASSOC);
}

/**
 * Best-effort student row when lead becomes enrolled (subset of leads.php logic).
 */
function leadsTryAttachStudentForEnrollment(PDO $db, array $tokenData, string $leadId): void {
    $q = $db->prepare('SELECT id, name, email, phone, college, year_of_study, org_id FROM leads WHERE id = ? LIMIT 1');
    $q->execute([$leadId]);
    $leadRow = $q->fetch(PDO::FETCH_ASSOC);
    if (!$leadRow || enrollStudentRowAlreadyExists($db, $leadId)) {
        return;
    }
    $stuEmail = trim((string) ($leadRow['email'] ?? ''));
    if ($stuEmail === '') {
        return;
    }
    $sid = generateUUID();
    $stuName = trim((string) ($leadRow['name'] ?? '')) ?: 'Student';
    $enrollDay = date('Y-m-d');
    $leadOrg = isset($leadRow['org_id']) ? trim((string) $leadRow['org_id']) : '';
    $orgIdForStudent = $leadOrg !== '' ? $leadOrg : null;
    if ($orgIdForStudent === null || $orgIdForStudent === '') {
        $jwtOrg = getOrgId($tokenData);
        if (is_string($jwtOrg) && $jwtOrg !== '') {
            $orgIdForStudent = $jwtOrg;
        }
    }
    if ($orgIdForStudent !== null && $orgIdForStudent !== '' && $leadOrg === '') {
        try {
            $upLo = $db->prepare('UPDATE leads SET org_id = ? WHERE id = ? AND (org_id IS NULL OR org_id = \'\')');
            $upLo->execute([$orgIdForStudent, $leadId]);
        } catch (Throwable $ignored) {
        }
    }
    try {
        ensureStudentsEnrolledByColumn($db);
        $enrolledBy = trim((string) ($tokenData['user_id'] ?? ''));
        if ($enrolledBy === '') {
            $enrolledBy = null;
        }
        if ($enrolledBy !== null && syncpediaColumnExists($db, 'students', 'enrolled_by')) {
            $ins = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date, enrolled_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $sid,
                $stuName,
                $stuEmail,
                $leadRow['phone'] ?? null,
                $leadRow['college'] ?? null,
                $leadRow['year_of_study'] ?? null,
                $leadId,
                $orgIdForStudent,
                'active',
                $enrollDay,
                $enrolledBy,
            ]);
        } else {
            $ins = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date) VALUES (?,?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $sid,
                $stuName,
                $stuEmail,
                $leadRow['phone'] ?? null,
                $leadRow['college'] ?? null,
                $leadRow['year_of_study'] ?? null,
                $leadId,
                $orgIdForStudent,
                'active',
                $enrollDay,
            ]);
        }
    } catch (Throwable $insErr) {
        if (isMysqlDuplicateKey($insErr) && enrollStudentRowAlreadyExists($db, $leadId)) {
            return;
        }
        if (isMysqlForeignKeyViolation($insErr) && $orgIdForStudent !== null && $orgIdForStudent !== '') {
            try {
                $sidFk = generateUUID();
                $insFk = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date) VALUES (?,?,?,?,?,?,?,?,?,?)');
                $insFk->execute([
                    $sidFk,
                    $stuName,
                    $stuEmail,
                    $leadRow['phone'] ?? null,
                    $leadRow['college'] ?? null,
                    $leadRow['year_of_study'] ?? null,
                    $leadId,
                    null,
                    'active',
                    $enrollDay,
                ]);
            } catch (Throwable $fkRetry) {
                throw $insErr;
            }
        } else {
            throw $insErr;
        }
    }
}

/**
 * Best-effort: log a lead pipeline status change for mobile/web filters
 * (GET leads.php?status_changed=yesterday|last_7_days|this_month).
 *
 * @param array<string,mixed> $tokenData
 */
function leadsRecordStatusChangeActivity(
    PDO $db,
    array $tokenData,
    string $leadId,
    string $userId,
    string $oldStatus,
    string $newStatus
): void {
    $oldStatus = leadsNormalizeStatus($oldStatus);
    $newStatus = leadsNormalizeStatus($newStatus);
    if ($oldStatus === $newStatus || $leadId === '' || $userId === '') {
        return;
    }
    $subj = 'Status: ' . $oldStatus . ' → ' . $newStatus;
    $desc = $subj;
    $orgForAct = null;
    try {
        $orgForAct = function_exists('getOrgId') ? getOrgId($tokenData) : ($tokenData['org_id'] ?? null);
    } catch (Throwable $ignored) {
        $orgForAct = $tokenData['org_id'] ?? null;
    }
    $occurredAt = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d H:i:s');

    try {
        $aid = generateUUID();
        $insAct = $db->prepare(
            'INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes, occurred_at, org_id)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)'
        );
        $insAct->execute([$aid, 'status_change', $subj, $desc, $leadId, $userId, $occurredAt, $orgForAct]);
    } catch (Throwable $e) {
        try {
            $aid = generateUUID();
            $insAct = $db->prepare(
                'INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes, occurred_at)
                 VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)'
            );
            $insAct->execute([$aid, 'status_change', $subj, $desc, $leadId, $userId, $occurredAt]);
        } catch (Throwable $e2) {
            try {
                $aid = generateUUID();
                $insAct = $db->prepare(
                    'INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes)
                     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)'
                );
                $insAct->execute([$aid, 'status_change', $subj, $desc, $leadId, $userId]);
            } catch (Throwable $e3) {
            }
        }
    }

    try {
        $laid = generateUUID();
        $insLa = $db->prepare(
            'INSERT INTO lead_activities (id, lead_id, user_id, type, description, org_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $insLa->execute([$laid, $leadId, $userId, 'status_change', $desc, $orgForAct, $occurredAt]);
    } catch (Throwable $e) {
        try {
            $laid = generateUUID();
            $insLa = $db->prepare(
                'INSERT INTO lead_activities (id, lead_id, user_id, type, description, org_id)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $insLa->execute([$laid, $leadId, $userId, 'status_change', $desc, $orgForAct]);
        } catch (Throwable $e2) {
            try {
                $laid = generateUUID();
                $insLa = $db->prepare(
                    'INSERT INTO lead_activities (id, lead_id, user_id, type, description)
                     VALUES (?, ?, ?, ?, ?)'
                );
                $insLa->execute([$laid, $leadId, $userId, 'status_change', $desc]);
            } catch (Throwable $e3) {
            }
        }
    }

    if (function_exists('syncpediaAuditLog')) {
        syncpediaAuditLog($db, $tokenData, 'status_updated', 'lead', $leadId, $desc);
    }
}

/**
 * Apply CRM pipeline status from Log Call flow.
 *
 * @return string|null error message, or null when OK
 */
function leadsSyncPipelineStatusFromCallLog(PDO $db, array $tokenData, string $userId, string $rawRole, string $leadId, string $newStatus): ?string {
    $newStatus = leadsNormalizeStatus($newStatus);
    if (!in_array($newStatus, leadsAllowedStatuses(), true)) {
        return 'Invalid lead_status';
    }
    $st = $db->prepare('SELECT id, org_id, assigned_to, referred_by, email, status FROM leads WHERE id = ? LIMIT 1');
    $st->execute([$leadId]);
    $leadRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$leadRow) {
        return 'Lead not found';
    }
    if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $rawRole, $leadRow)) {
        return 'Not allowed to update this lead';
    }
    $transitionErr = leadsAssertStatusTransition((string) ($leadRow['status'] ?? ''), $newStatus);
    if ($transitionErr !== null) {
        return $transitionErr;
    }
    if ($newStatus === 'enrolled') {
        $em = trim((string) ($leadRow['email'] ?? ''));
        if ($em === '') {
            return 'Lead must have an email before Enroll status';
        }
    }
    $prevStatus = leadsNormalizeStatus((string) ($leadRow['status'] ?? ''));
    try {
        $cas = $db->prepare(
            'UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?'
        );
        $cas->execute([$newStatus, $leadId, (string) ($leadRow['status'] ?? $prevStatus)]);
        if ($cas->rowCount() < 1) {
            // Retry once with normalized prev if DB had alias (converted/etc.)
            $cas2 = $db->prepare(
                'UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND LOWER(TRIM(status)) = ?'
            );
            $cas2->execute([$newStatus, $leadId, $prevStatus]);
            if ($cas2->rowCount() < 1) {
                return 'Lead was updated by someone else — refresh and try again';
            }
        }
    } catch (Throwable $e) {
        return 'Could not update lead status';
    }
    if ($newStatus === 'enrolled') {
        ensureStudentsLeadIdUnique($db);
        try {
            leadsTryAttachStudentForEnrollment($db, $tokenData, $leadId);
        } catch (Throwable $e) {
            // Revert status so we never leave enrolled-without-student.
            try {
                $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    ->execute([$prevStatus !== '' ? $prevStatus : 'interested', $leadId]);
            } catch (Throwable $ignored) {
            }
            return 'Could not create student for enrollment';
        }
        if (!enrollStudentRowAlreadyExists($db, $leadId)) {
            try {
                $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    ->execute([$prevStatus !== '' ? $prevStatus : 'interested', $leadId]);
            } catch (Throwable $ignored) {
            }
            return 'Could not create student for enrollment';
        }
    } elseif ($prevStatus === 'enrolled' || $prevStatus === 'converted') {
        // Only drop students when leaving enrolled — never on unrelated status edits.
        leadsDropStudentForLead($db, $leadId);
    }

    leadsRecordStatusChangeActivity($db, $tokenData, $leadId, $userId, $prevStatus, $newStatus);

    return null;
}

/** Create the audit_log table if missing (best-effort, never fatal). */
function ensureAuditLogTable(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS audit_log (
                id CHAR(36) PRIMARY KEY,
                org_id CHAR(36) NULL,
                user_id CHAR(36) NULL,
                user_name VARCHAR(255) NULL,
                action VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id VARCHAR(100) NULL,
                details TEXT NULL,
                ip_address VARCHAR(64) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_audit_org_created (org_id, created_at),
                INDEX idx_audit_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/**
 * Record a real audit trail entry. Never throws — logging must not break the primary action.
 *
 * @param array<string,mixed> $tokenData
 */
function syncpediaAuditLog(PDO $db, array $tokenData, string $action, string $entityType, ?string $entityId, string $details = ''): void {
    try {
        ensureAuditLogTable($db);
        $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? null;
        if (is_string($ip) && strpos($ip, ',') !== false) {
            $ip = trim(explode(',', $ip)[0]);
        }
        $userId = $tokenData['user_id'] ?? null;
        $userName = null;
        if ($userId) {
            try {
                $u = $db->prepare('SELECT full_name FROM users WHERE id = ? LIMIT 1');
                $u->execute([$userId]);
                $userName = $u->fetchColumn() ?: null;
            } catch (Throwable $ignored) {
            }
        }
        $orgId = $tokenData['org_id'] ?? null;
        $ins = $db->prepare(
            'INSERT INTO audit_log (id, org_id, user_id, user_name, action, entity_type, entity_id, details, ip_address)
             VALUES (?,?,?,?,?,?,?,?,?)',
        );
        $ins->execute([
            generateUUID(),
            $orgId,
            $userId,
            $userName,
            $action,
            $entityType,
            $entityId,
            $details !== '' ? $details : null,
            $ip,
        ]);
    } catch (Throwable $ignored) {
        // Audit logging is best-effort; never let it break the calling request.
    }
}

/** Ensure users.page_access_json exists (per-member page toggles). */
function ensureUsersPageAccessColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'users', 'page_access_json')) {
            $db->exec('ALTER TABLE users ADD COLUMN page_access_json LONGTEXT DEFAULT NULL');
        }
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/**
 * @return array{payments: bool, offer_letters: bool, pages: array<string,bool>}
 */
function userDecodePageAccess(?string $json): array {
    $defaults = ['payments' => false, 'offer_letters' => false, 'pages' => []];
    if (!is_string($json) || trim($json) === '') {
        return $defaults;
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return $defaults;
    }
    $pages = [];
    if (isset($decoded['pages']) && is_array($decoded['pages'])) {
        foreach ($decoded['pages'] as $k => $v) {
            $key = is_string($k) ? trim($k) : '';
            if ($key === '') continue;
            $pages[$key] = !empty($v);
        }
    }
    return [
        'payments' => !empty($decoded['payments']),
        'offer_letters' => !empty($decoded['offer_letters']),
        'pages' => $pages,
    ];
}

/** @param array<string,mixed> $user */
function userAttachPageAccess(array &$user): void {
    $user['page_access'] = userDecodePageAccess(isset($user['page_access_json']) ? (string) $user['page_access_json'] : null);
    unset($user['page_access_json']);
}

/**
 * Normalize page_access from Team create/update. Defaults all OFF for L1 flags.
 * For managers and HR, optional pages{} map stores per-page toggles.
 * For HR, pages.offer_letters is mirrored onto the top-level offer_letters flag.
 *
 * @param mixed $input
 * @return array{payments: bool, offer_letters: bool, pages: array<string,bool>}
 */
function userNormalizePageAccessInput($input, string $memberRole): array {
    $access = ['payments' => false, 'offer_letters' => false, 'pages' => []];
    if (is_array($input)) {
        $access['payments'] = !empty($input['payments']);
        $access['offer_letters'] = !empty($input['offer_letters']);
        $pagesIn = isset($input['pages']) && is_array($input['pages']) ? $input['pages'] : null;
        if (is_array($pagesIn)) {
            foreach ($pagesIn as $k => $v) {
                $key = is_string($k) ? trim($k) : '';
                // Only reserve the nested container key; "payments" / "offer_letters" are valid page keys.
                if ($key === '' || $key === 'pages') {
                    continue;
                }
                // Allow snake_case feature keys only
                if (!preg_match('/^[a-z][a-z0-9_]{0,63}$/', $key)) {
                    continue;
                }
                $access['pages'][$key] = !empty($v);
            }
        }
    }
    $role = syncpediaNormalizeRoleKey($memberRole);
    if ($role !== 'sales_representative') {
        $access['payments'] = false;
    }
    if ($role !== 'hr') {
        $access['offer_letters'] = false;
    } else {
        // Keep top-level flag in sync with pages.offer_letters when a pages map is present.
        if (array_key_exists('offer_letters', $access['pages'])) {
            $access['offer_letters'] = !empty($access['pages']['offer_letters']);
        }
    }
    if ($role !== 'manager' && $role !== 'operational_manager' && $role !== 'hr') {
        $access['pages'] = [];
    }
    if ($role === 'operational_manager') {
        $filtered = [];
        foreach (userOperationalManagerOptionalPageKeys() as $key) {
            $filtered[$key] = !empty($access['pages'][$key]);
        }
        $access['pages'] = $filtered;
    }
    return $access;
}

function userOperationalManagerOptionalPageKeys(): array
{
    return ['communications', 'courses', 'batches', 'daily_reports', 'leads'];
}

/** HR portal page grant — communications / form_management / offer_letters are opt-in. */
function userHrHasPageAccess(?array $access, string $featureKey): bool
{
    if ($featureKey === '') {
        return true;
    }
    $pages = is_array($access) && isset($access['pages']) && is_array($access['pages'])
        ? $access['pages']
        : [];
    if (empty($pages)) {
        if ($featureKey === 'offer_letters') {
            return !empty($access['offer_letters']);
        }
        if (in_array($featureKey, ['form_management', 'communications'], true)) {
            return false;
        }
        return true;
    }
    return !empty($pages[$featureKey]);
}

function userSavePageAccess(PDO $db, string $userId, array $access): void {
    ensureUsersPageAccessColumn($db);
    $payload = [
        'payments' => !empty($access['payments']),
        'offer_letters' => !empty($access['offer_letters']),
    ];
    // Always persist pages when provided (including all-false) so configured managers stay restricted.
    if (isset($access['pages']) && is_array($access['pages'])) {
        $payload['pages'] = $access['pages'];
    }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $db->prepare('UPDATE users SET page_access_json = ? WHERE id = ?')->execute([$json, $userId]);
}

/** True when this user may open the Payments (payment links) page. */
function userCanAccessPaymentsPage(array $tokenData, ?array $userRow = null): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ($userRow['role'] ?? '')));
    if (in_array($role, ['super_admin', 'admin', 'org', 'finance', 'manager'], true)) {
        return true;
    }
    if ($role !== 'sales_representative') {
        return false;
    }
    $access = null;
    if (is_array($userRow)) {
        $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
            ? $userRow['page_access']
            : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    }
    return !empty($access['payments']);
}

/** True when this user may open Offer Letters (org/super_admin/manager always when org feature on;
 *  operational_manager when page grant on; HR when toggled on). */
function userCanAccessOfferLettersPage(array $tokenData, ?array $userRow = null, $org = null): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ($userRow['role'] ?? '')));
    if (in_array($role, ['super_admin', 'org', 'manager'], true)) {
        return true;
    }
    $access = null;
    if (is_array($userRow)) {
        $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
            ? $userRow['page_access']
            : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    }
    $pages = is_array($access) && isset($access['pages']) && is_array($access['pages'])
        ? $access['pages']
        : [];

    if ($role === 'operational_manager') {
        return userOperationalManagerHasPageAccess($access, 'offer_letters');
    }

    if ($role !== 'hr') {
        return false;
    }
    if (!is_array($access)) {
        return false;
    }
    if (!empty($pages) && array_key_exists('offer_letters', $pages)) {
        return !empty($pages['offer_letters']);
    }
    return !empty($access['offer_letters']);
}

function userOperationalManagerAutoGrantedPages(): array
{
    return [
        'marketing_access',
        'form_management',
        'dashboard',
        'payments',
        'students',
        'offer_letters',
        'timetables',
        'settings',
        'tasks',
        'notifications',
        'holidays',
    ];
}

/** Operational Manager: marketing auto-granted; other pages default off unless toggled on. */
function userOperationalManagerHasPageAccess(?array $access, string $featureKey): bool
{
    if (in_array($featureKey, userOperationalManagerAutoGrantedPages(), true)) {
        return true;
    }
    $pages = is_array($access) && isset($access['pages']) && is_array($access['pages'])
        ? $access['pages']
        : [];
    if (empty($pages)) {
        return false;
    }
    return !empty($pages[$featureKey]);
}

/**
 * Form Management for HR: pages.form_management must be explicitly true.
 * Operational Manager: toggle required. Other roles as before.
 */
function userCanAccessFormManagementPage(array $tokenData, ?array $userRow = null): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ($userRow['role'] ?? '')));
    $access = null;
    if (is_array($userRow)) {
        $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
            ? $userRow['page_access']
            : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    }
    if ($role === 'operational_manager') {
        return userOperationalManagerHasPageAccess($access, 'form_management');
    }
    if (in_array($role, ['super_admin', 'admin', 'org', 'marketing', 'manager'], true)) {
        return true;
    }
    if ($role !== 'hr') {
        return false;
    }
    if (!is_array($userRow)) {
        return false;
    }
    $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
        ? $userRow['page_access']
        : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    $pages = is_array($access) && isset($access['pages']) && is_array($access['pages'])
        ? $access['pages']
        : [];
    if (empty($pages)) {
        return false;
    }
    return !empty($pages['form_management']);
}

/** Marketing portal: org/super_admin/marketing always; OM auto-granted; manager when page grant on. */
function userCanAccessMarketingPage(array $tokenData, ?array $userRow = null): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ($userRow['role'] ?? '')));
    if (in_array($role, ['super_admin', 'admin', 'org', 'marketing'], true)) {
        return true;
    }
    if ($role === 'operational_manager') {
        return true;
    }
    if ($role !== 'manager') {
        return false;
    }
    $access = null;
    if (is_array($userRow)) {
        $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
            ? $userRow['page_access']
            : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    }
    $pages = is_array($access) && isset($access['pages']) && is_array($access['pages'])
        ? $access['pages']
        : [];
    if (empty($pages)) {
        return true;
    }
    return !empty($pages['marketing_access']);
}

/** Ensure organizations.cert_prefix exists (globally unique 2-letter certificate org code). */
function ensureOrganizationsCertPrefixColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'organizations', 'cert_prefix')) {
            $db->exec('ALTER TABLE organizations ADD COLUMN cert_prefix CHAR(2) DEFAULT NULL');
        }
        try {
            $db->exec('CREATE UNIQUE INDEX uq_org_cert_prefix ON organizations (cert_prefix)');
        } catch (Throwable $ignored) {
        }
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/** @return array<string,mixed>|null */
function syncpediaFetchOrganization(PDO $db, string $orgId, bool $requireActive = true): ?array {
    $orgId = trim($orgId);
    if ($orgId === '') {
        return null;
    }
    ensureOrganizationsCertPrefixColumn($db);
    $sql = 'SELECT id, name, slug, logo_url, plan, cert_prefix FROM organizations WHERE id = ?';
    if ($requireActive) {
        $sql .= ' AND is_active = 1';
    }
    $st = $db->prepare($sql);
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/** Ensure organizations.profile_json exists (company profile + data-retention settings storage). */
function ensureOrganizationsProfileColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'organizations', 'profile_json')) {
            $db->exec('ALTER TABLE organizations ADD COLUMN profile_json LONGTEXT DEFAULT NULL');
        }
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/** @return array<string,mixed> */
function organizationsDecodeProfile(?string $json): array {
    if (!is_string($json) || trim($json) === '') {
        return [];
    }
    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : [];
}

/** Tables allowed for trash archive (whitelist). */
function trashAllowedTables(): array {
    return [
        'leads', 'students', 'contacts', 'deals', 'tasks', 'courses', 'batches', 'payments', 'holidays', 'lead_assignments',
    ];
}

/**
 * Insert a full row snapshot into trash_items (used when row was loaded with permission checks).
 *
 * @throws RuntimeException when archive cannot be persisted (caller must abort hard delete)
 */
function trashArchivePayload(PDO $db, string $entityType, array $row, array $tokenData): void {
    if (empty($row['id'])) {
        throw new RuntimeException('Trash archive failed: row has no id');
    }
    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }
    $json = json_encode($row, $flags);
    if ($json === false) {
        throw new RuntimeException('Trash archive failed: could not encode row payload');
    }
    $tid = generateUUID();
    $orgId = $row['org_id'] ?? null;
    $by = $tokenData['user_id'] ?? null;
    try {
        $ins = $db->prepare('INSERT INTO trash_items (id, entity_type, entity_id, payload, org_id, deleted_by) VALUES (?,?,?,?,?,?)');
        $ins->execute([$tid, $entityType, (string) $row['id'], $json, $orgId, $by]);
    } catch (Throwable $e) {
        throw new RuntimeException('Trash archive failed: ' . $e->getMessage(), 0, $e);
    }
    if ($ins->rowCount() < 1) {
        throw new RuntimeException('Trash archive failed: insert returned no rows');
    }
}

/**
 * Snapshot a row into trash_items before hard DELETE.
 *
 * @throws RuntimeException when archive cannot be persisted (caller must abort hard delete)
 */
function trashArchiveRow(PDO $db, string $entityType, string $table, string $id, array $tokenData): void {
    if (!in_array($table, trashAllowedTables(), true)) {
        return;
    }
    $sel = $db->prepare("SELECT * FROM `{$table}` WHERE id = ? LIMIT 1");
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row || empty($row['id'])) {
        throw new RuntimeException('Trash archive failed: source row not found');
    }
    trashArchivePayload($db, $entityType, $row, $tokenData);
}

/** ISO week in Asia/Kolkata: Monday 00:00:00 → Sunday 23:59:59 */
function getWeekBounds(): array {
    $meta = hrLeadsWeekBoundsAndMeta();
    return ['start' => $meta['start'], 'end' => $meta['end']];
}

/**
 * Full IST week window plus UI metadata (label, resets_in).
 *
 * @return array{start:string,end:string,week:array{start:string,end:string,label:string,resets_in:string}}
 */
function hrLeadsWeekBoundsAndMeta(): array {
    $tz = new DateTimeZone('Asia/Kolkata');
    $now = new DateTime('now', $tz);
    $dayOfWeek = (int) $now->format('N');
    $monday = clone $now;
    $monday->modify('-' . ($dayOfWeek - 1) . ' days');
    $monday->setTime(0, 0, 0);
    $sunday = clone $monday;
    $sunday->modify('+6 days');
    $sunday->setTime(23, 59, 59);
    $start = $monday->format('Y-m-d H:i:s');
    $end = $sunday->format('Y-m-d H:i:s');
    $labelStart = $monday->format('M j');
    $labelEnd = $sunday->format('M j, Y');
    $label = $labelStart . ' – ' . $labelEnd;
    $nextMonday = clone $monday;
    $nextMonday->modify('+7 days');
    $secs = $nextMonday->getTimestamp() - $now->getTimestamp();
    if ($secs <= 0) {
        $resets_in = 'soon';
    } elseif ($secs < 86400) {
        $resets_in = 'tomorrow';
    } else {
        $days = (int) floor($secs / 86400);
        $resets_in = $days === 1 ? 'in 1 day' : 'in ' . $days . ' days';
    }
    return [
        'start' => $start,
        'end' => $end,
        'week' => [
            'start' => $start,
            'end' => $end,
            'label' => $label,
            'resets_in' => $resets_in,
        ],
    ];
}

/** Normalize empty user.org_id to null (platform / Syncpedia-wide reps). */
function lfNormalizeMemberOrg(?string $memberOrgId): ?string {
    if ($memberOrgId === null) {
        return null;
    }
    $t = trim((string)$memberOrgId);

    return $t === '' ? null : $t;
}

/** Canonical slug for the built-in Syncpedia tenant (super_admin–created platform sales roles). */
function syncpediaPlatformOrgSlug(): string {
    return 'syncpedia';
}

/**
 * Resolve UUID for the Syncpedia organization row; create a minimal tenant if missing.
 *
 * Sets owner_id to $actingUserId when non-empty so team roster org_admin_email matches the actor
 * (super_admin creating platform-scoped members). Normalizes display name to Syncpedia.
 *
 * @param string $actingUserId User id of super_admin or migration actor (may be empty).
 */
function syncpediaGetOrCreateOrgId(PDO $db, string $actingUserId): ?string {
    try {
        $slug = syncpediaPlatformOrgSlug();
        $st = $db->prepare('SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = ? LIMIT 1');
        $st->execute([$slug]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!empty($row['id'])) {
            $id = (string) $row['id'];
        } else {
            $id = generateUUID();
            $name = 'Syncpedia';
            try {
                $ins = $db->prepare("INSERT INTO organizations (id, name, slug, logo_url, domain, plan, max_users, industry, is_active) VALUES (?, ?, ?, NULL, NULL, 'enterprise', 9999, NULL, 1)");
                $ins->execute([$id, $name, $slug]);
            } catch (Throwable $e) {
                $ins2 = $db->prepare("INSERT INTO organizations (id, name, slug, plan, max_users, is_active) VALUES (?, ?, ?, 'enterprise', 9999, 1)");
                $ins2->execute([$id, $name, $slug]);
            }
        }

        $actor = trim($actingUserId);
        if ($actor !== '') {
            try {
                $db->prepare('UPDATE organizations SET owner_id = ? WHERE id = ?')->execute([$actor, $id]);
            } catch (Throwable $ignored) {
            }
        }
        try {
            $db->prepare('UPDATE organizations SET name = ? WHERE id = ? AND LOWER(TRIM(slug)) = ?')->execute(['Syncpedia', $id, $slug]);
        } catch (Throwable $ignored) {
        }

        return $id;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Resolve the `org_id` a newly-created member should inherit from its creator.
 *
 * Rule: new member's org = creator's effective org.
 *  - Creator's JWT `org_id` wins (this honors super_admin's `switch_org` context).
 *  - If the JWT has no org_id, fall back to the creator's persistent `users.org_id`.
 *  - If that's still empty AND the creator is super_admin, fall back to the built-in
 *    Syncpedia platform tenant so platform-scoped users never end up org-less.
 */
function resolveCreatorOrgId(PDO $db, array $tokenData): ?string {
    $tokenOrg = $tokenData['org_id'] ?? null;
    if ($tokenOrg !== null && trim((string) $tokenOrg) !== '') {
        return (string) $tokenOrg;
    }

    $creatorId = (string) ($tokenData['user_id'] ?? '');
    if ($creatorId !== '') {
        try {
            $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
            $st->execute([$creatorId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            $dbOrg = $row['org_id'] ?? null;
            if ($dbOrg !== null && trim((string) $dbOrg) !== '') {
                return (string) $dbOrg;
            }
        } catch (Throwable $e) {
            /* fall through */
        }

        // Sales / L1 users sometimes lack users.org_id — inherit from reports_to chain.
        try {
            if (syncpediaColumnExists($db, 'users', 'reports_to_id')) {
                $uid = $creatorId;
                for ($i = 0; $i < 8; $i++) {
                    $st = $db->prepare('SELECT org_id, reports_to_id FROM users WHERE id = ? LIMIT 1');
                    $st->execute([$uid]);
                    $row = $st->fetch(PDO::FETCH_ASSOC);
                    if (!$row) {
                        break;
                    }
                    $dbOrg = trim((string) ($row['org_id'] ?? ''));
                    if ($dbOrg !== '') {
                        return $dbOrg;
                    }
                    $mgr = trim((string) ($row['reports_to_id'] ?? ''));
                    if ($mgr === '' || $mgr === $uid) {
                        break;
                    }
                    $uid = $mgr;
                }
            }
        } catch (Throwable $e) {
            /* fall through to platform fallback */
        }
    }

    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        $sid = syncpediaGetOrCreateOrgId($db, $creatorId);
        if ($sid) {
            return $sid;
        }
    }

    return null;
}

/** Parse Y-m-d (or datetime string) for batch schedule comparisons. */
function batchParseScheduleDate(?string $value): ?DateTimeImmutable
{
    if ($value === null) {
        return null;
    }
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }
    $iso = substr($value, 0, 10);
    // MySQL zero-dates and garbage must not count as a real end/start.
    if ($iso === '' || strpos($iso, '0000-') === 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $iso)) {
        return null;
    }
    try {
        $dt = new DateTimeImmutable($iso);
        if ($dt->format('Y-m-d') !== $iso) {
            return null;
        }
        return $dt;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Batch status from schedule: upcoming (before start), active (in range), completed (after end).
 */
function batchScheduleStatus(?string $startDate, ?string $endDate, ?DateTimeImmutable $today = null): string
{
    $today = $today ?? new DateTimeImmutable('today');
    $start = batchParseScheduleDate($startDate);
    $end = batchParseScheduleDate($endDate);

    if ($start !== null && $today < $start) {
        return 'upcoming';
    }
    if ($end !== null && $today > $end) {
        return 'completed';
    }
    if ($start !== null && $today >= $start) {
        return 'active';
    }
    if ($end !== null && $today <= $end) {
        return 'active';
    }

    return 'upcoming';
}

/** True when batch date range overlaps the calendar month of $today. */
function batchOverlapsMonth(?string $startDate, ?string $endDate, ?DateTimeImmutable $today = null): bool
{
    $today = $today ?? new DateTimeImmutable('today');
    $monthStart = new DateTimeImmutable($today->format('Y-m-01'));
    $monthEnd = new DateTimeImmutable($today->format('Y-m-t'));
    $start = batchParseScheduleDate($startDate);
    $end = batchParseScheduleDate($endDate);

    if ($start === null && $end === null) {
        return true;
    }

    $rangeStart = $start ?? $monthStart;
    $rangeEnd = $end ?? $monthEnd;

    return $rangeStart <= $monthEnd && $rangeEnd >= $monthStart;
}

/** Apply schedule-based status to listed batches and persist when changed. */
function batchesSyncScheduleStatus(PDO $db, array &$rows): void
{
    foreach ($rows as &$row) {
        if (!is_array($row) || empty($row['id'])) {
            continue;
        }
        $computed = batchScheduleStatus($row['start_date'] ?? null, $row['end_date'] ?? null);
        $stored = strtolower(trim((string) ($row['status'] ?? '')));
        // Keep explicitly active batches enrollable (do not demote on list).
        if ($stored === 'active' && $computed !== 'active') {
            $row['status'] = 'active';
            continue;
        }
        // Repair rows wrongly marked completed because of 0000-00-00 / invalid end dates.
        if ($stored === 'completed' && $computed === 'active') {
            $row['status'] = 'active';
            try {
                $upd = $db->prepare('UPDATE batches SET status = ? WHERE id = ?');
                $upd->execute(['active', $row['id']]);
            } catch (Throwable $ignored) {
            }
            continue;
        }
        $row['status'] = $computed;
        if ($stored !== $computed) {
            try {
                $upd = $db->prepare('UPDATE batches SET status = ? WHERE id = ?');
                $upd->execute([$computed, $row['id']]);
            } catch (Throwable $ignored) {
            }
        }
    }
    unset($row);
}

/**
 * Sales reps (L1): show all upcoming + all active batches so they can enroll students.
 * Completed batches (with a real past end date) are hidden.
 */
function batchesFilterViewerSchedule(array $tokenData, array $rows): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $viewerRoles = ['sales_representative'];
    if (!in_array($role, $viewerRoles, true)) {
        return $rows;
    }

    $today = new DateTimeImmutable('today');

    return array_values(array_filter($rows, static function ($row) use ($today) {
        if (!is_array($row)) {
            return false;
        }
        $stored = strtolower(trim((string) ($row['status'] ?? '')));
        if ($stored === 'active' || $stored === 'upcoming') {
            return true;
        }
        $schedule = batchScheduleStatus($row['start_date'] ?? null, $row['end_date'] ?? null, $today);
        if ($schedule === 'upcoming' || $schedule === 'active') {
            return true;
        }
        // If marked completed only because end_date was invalid/missing, still show as active.
        $end = batchParseScheduleDate($row['end_date'] ?? null);
        $start = batchParseScheduleDate($row['start_date'] ?? null);
        if ($end === null && $start !== null && $today >= $start) {
            return true;
        }

        return false;
    }));
}

/**
 * org_id for creating tenant-scoped records (courses, batches, etc.).
 * - super_admin with ?org_id= uses that org (org CRM / switched context).
 * - Otherwise same as resolveCreatorOrgId (platform super_admin → Syncpedia org).
 */
function resolveWriteOrgId(PDO $db, array $tokenData): ?string
{
    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin' && !empty($_GET['org_id'])) {
        return (string) $_GET['org_id'];
    }

    return resolveCreatorOrgId($db, $tokenData);
}

/**
 * Ensure lead_forms / lead_form_assignments tables exist (+ JSON columns).
 * Mirrors php-backend/api/forms.php bootstrap (single source for public endpoints too).
 */
function ensureLeadFormsTables(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }

    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS lead_forms (
              id CHAR(36) NOT NULL,
              name VARCHAR(255) NOT NULL,
              slug VARCHAR(255) NOT NULL,
              description TEXT DEFAULT NULL,
              fields_json JSON DEFAULT NULL,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_by CHAR(36) NOT NULL,
              org_id CHAR(36) DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE (slug, org_id)
            )
        ");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lead_forms_org ON lead_forms (org_id)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lead_forms_active ON lead_forms (is_active)');

        if (!syncpediaColumnExists($db, 'lead_forms', 'fields_json')) {
            $db->exec('ALTER TABLE lead_forms ADD COLUMN fields_json JSON DEFAULT NULL');
        }
        if (!syncpediaColumnExists($db, 'lead_forms', 'meta_json')) {
            $db->exec('ALTER TABLE lead_forms ADD COLUMN meta_json JSON DEFAULT NULL');
        }

        $db->exec("
            CREATE TABLE IF NOT EXISTS lead_form_assignments (
              id CHAR(36) NOT NULL,
              form_id CHAR(36) NOT NULL,
              member_id CHAR(36) NOT NULL,
              assigned_by CHAR(36) NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE (form_id, member_id)
            )
        ");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lfa_form ON lead_form_assignments (form_id)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lfa_member ON lead_form_assignments (member_id)');
    } catch (Throwable $ignored) {
    }

    $done = true;
}

/**
 * Retire legacy platform-global builtin forms (slug normal/default, org_id NULL).
 * These are no longer seeded or exposed in Form Management.
 */
function retireGlobalBuiltinLeadForms(PDO $db): void {
    try {
        ensureLeadFormsTables($db);
        $db->exec("UPDATE lead_forms SET is_active = 0 WHERE slug IN ('normal', 'default') AND org_id IS NULL");
    } catch (Throwable $ignored) {
    }
}

/** Ensure lead_form_assignments exists (no FK; mirrors forms.php bootstrap). */
function ensureLeadFormAssignmentsTable(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS lead_form_assignments (
              id CHAR(36) NOT NULL,
              form_id CHAR(36) NOT NULL,
              member_id CHAR(36) NOT NULL,
              assigned_by CHAR(36) NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE (form_id, member_id)
            )
        ");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lfa_form ON lead_form_assignments (form_id)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_lfa_member ON lead_form_assignments (member_id)');
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/**
 * Resolve lead_form IDs for auto-assign on new sales members.
 * Built-in global forms were removed; assign forms explicitly in Form Management.
 *
 * @return string[] distinct form UUIDs
 */
function lfResolveAutoAssignLeadFormIds(PDO $db, ?string $memberOrg): array {
    return [];
}

/** Upsert lead_form_assignments for default/normal rules. Returns number of rows touched. */
function assignLeadFormsToSalesMember(PDO $db, string $assignedByUserId, string $memberId, ?string $memberOrgId): int {
    ensureLeadFormAssignmentsTable($db);
    $org = lfNormalizeMemberOrg($memberOrgId);
    $formIds = lfResolveAutoAssignLeadFormIds($db, $org);
    $n = 0;
    foreach ($formIds as $fid) {
        try {
            $upsert = syncpediaUpsertClause(
                $db,
                '(form_id, member_id)',
                ['assigned_by = EXCLUDED.assigned_by'],
                ['`assigned_by` = VALUES(`assigned_by`)'],
            );
            $ins = $db->prepare("
                INSERT INTO lead_form_assignments (id, form_id, member_id, assigned_by)
                VALUES (?, ?, ?, ?)
                {$upsert}
            ");
            $ins->execute([generateUUID(), $fid, $memberId, $assignedByUserId]);
            $n++;
        } catch (Throwable $ignored) {
        }
    }

    return $n;
}

/**
 * Backfill assignments for existing team leads / sales reps.
 *
 * @param ?string $scopeOrgId If set (admin), only users in that org; super_admin passes null for everyone including platform users.
 * @return array{users_updated:int,assignment_rows_upserted:int,users_skipped_no_matching_form:int}
 */
function backfillLeadFormAssignmentsForSalesMembers(PDO $db, string $assignedByUserId, ?string $scopeOrgId = null): array {
    ensureLeadFormAssignmentsTable($db);
    $sql = "SELECT id, org_id FROM users WHERE is_active = 1 AND LOWER(TRIM(role)) = 'sales_representative'";
    $params = [];
    if ($scopeOrgId !== null && $scopeOrgId !== '') {
        $sql .= ' AND org_id = ?';
        $params[] = $scopeOrgId;
    }
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $usersUpdated = 0;
    $rowsUpserted = 0;
    $usersSkipped = 0;
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $mid = (string)($row['id'] ?? '');
        if ($mid === '') {
            continue;
        }
        $oid = isset($row['org_id']) ? trim((string)$row['org_id']) : '';
        $memberOrg = ($oid === '') ? null : $oid;
        $n = assignLeadFormsToSalesMember($db, $assignedByUserId, $mid, $memberOrg);
        if ($n > 0) {
            $usersUpdated++;
            $rowsUpserted += $n;
        } else {
            $usersSkipped++;
        }
    }

    return [
        'users_updated' => $usersUpdated,
        'assignment_rows_upserted' => $rowsUpserted,
        'users_skipped_no_matching_form' => $usersSkipped,
    ];
}

/**
 * Ensure Syncpedia org for:
 * - users with NULL org_id
 * - all super_admin users
 * Then attach lead forms for sales roles in that org.
 *
 * @return array{success:bool,error?:string,syncpedia_org_id?:string,users_updated?:int,lead_form_assignment_operations?:int}
 */
function migratePlatformSalesToSyncpediaOrg(PDO $db, string $actingUserId): array {
    $syncId = syncpediaGetOrCreateOrgId($db, $actingUserId);
    if (!$syncId) {
        return ['success' => false, 'error' => 'Could not resolve Syncpedia organization'];
    }

    $upd = $db->prepare("
        UPDATE users
        SET org_id = ?
        WHERE org_id IS NULL
           OR LOWER(TRIM(role)) = 'super_admin'
    ");
    $upd->execute([$syncId]);
    $userUpdated = (int) $upd->rowCount();

    $assignOps = 0;
    $salesRoles = ['sales_representative'];
    $placeholders = implode(',', array_fill(0, count($salesRoles), '?'));
    $st = $db->prepare("SELECT id FROM users WHERE org_id = ? AND LOWER(TRIM(role)) IN ($placeholders)");
    $st->execute(array_merge([$syncId], $salesRoles));
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        if ($uid === null || $uid === '') {
            continue;
        }
        $assignOps += assignLeadFormsToSalesMember($db, $actingUserId, (string) $uid, $syncId);
    }

    return [
        'success' => true,
        'syncpedia_org_id' => $syncId,
        'users_updated' => $userUpdated,
        'lead_form_assignment_operations' => $assignOps,
    ];
}

/** Permanently remove trash rows older than $retentionDays (default 30). Returns rows deleted. */
function trashPurgeExpired(PDO $db, int $retentionDays = 30): int {
    try {
        $stmt = $db->prepare('DELETE FROM trash_items WHERE deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)');
        $stmt->execute([$retentionDays]);
        return $stmt->rowCount();
    } catch (Throwable $ignored) {
        return 0;
    }
}

/** MIME types allowed for lead resume uploads (PDF / Word). */
function leadResumeAllowedMimeTypes(): array {
    return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
}

function leadResumeMaxBytes(): int {
    return 5 * 1024 * 1024;
}

/** Certificate template background / asset images (JPG, PNG, WebP). */
function certTemplateImageMaxBytes(): int {
    return 50 * 1024 * 1024;
}

function certTemplateImageAllowedMimeTypes(): array {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
}

function certTemplateUploadErrorMessage(int $code): string {
    if ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE) {
        return 'File exceeds server upload limit. Ask your host to raise PHP upload_max_filesize and post_max_size (need at least 50M for large backgrounds).';
    }
    if ($code === UPLOAD_ERR_PARTIAL) {
        return 'Upload was interrupted. Try again on a stable connection.';
    }
    if ($code === UPLOAD_ERR_NO_FILE) {
        return 'No file received. The upload may have exceeded post_max_size.';
    }
    return 'Image upload failed (error code ' . $code . ')';
}

/**
 * Store a certificate template image under uploads/certificate_assets/{org_id}/.
 *
 * @param array|null $file $_FILES['file']
 * @return string Relative URL e.g. /uploads/certificate_assets/{orgId}/xxx.jpg
 */
function saveCertificateTemplateImageUpload(?array $file, string $orgId = ''): string {
    if ($file === null || !isset($file['error'])) {
        respond(['error' => 'file is required'], 400);
    }
    $err = (int) $file['error'];
    if ($err !== UPLOAD_ERR_OK) {
        respond(['error' => certTemplateUploadErrorMessage($err)], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid image upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > certTemplateImageMaxBytes()) {
        respond(['error' => 'Image exceeds 50 MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    if ($mime === '' || !in_array($mime, certTemplateImageAllowedMimeTypes(), true)) {
        respond(['error' => 'Image must be JPG, PNG, WebP, or GIF'], 400);
    }
    $ext = match ($mime) {
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
        default => 'jpg',
    };
    $orgFolder = strtolower(trim($orgId));
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $orgFolder)) {
        respond(['error' => 'Select an organization before uploading a certificate background'], 400);
    }
    $uploadParent = __DIR__ . '/../uploads/certificate_assets/' . $orgFolder;
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $filename = uniqid('cert_bg_', true) . '.' . $ext;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save image'], 500);
    }
    return '/uploads/certificate_assets/' . $orgFolder . '/' . $filename;
}

/**
 * LIKE patterns for matching a certificate asset path inside JSON columns.
 * json_encode() escapes slashes as \/ — the old single-pattern check missed those rows for org admins.
 *
 * @return list<string>
 */
function certificateAssetJsonLikePatterns(string $rawPath): array {
    $rawPath = trim($rawPath);
    if ($rawPath === '') {
        return [];
    }
    $base = basename($rawPath);
    $noLeadingSlash = ltrim($rawPath, '/');

    // JSON strings often store paths with escaped slashes (\/) and/or without the leading slash.
    $patterns = [
        $rawPath,
        $noLeadingSlash,
        str_replace('/', '\\/', $rawPath),
        str_replace('/', '\\/', $noLeadingSlash),
        rawurlencode($rawPath),
        rawurlencode($noLeadingSlash),
    ];

    if ($base !== '' && $base !== $rawPath) {
        $patterns[] = 'certificate_assets/' . $base;
        $patterns[] = 'certificate_assets\\/' . $base;
        $patterns[] = $base;
    }
    $out = [];
    foreach ($patterns as $p) {
        $p = trim($p);
        if ($p !== '') {
            $out[$p] = true;
        }
    }
    return array_keys($out);
}

/** Org id encoded in /uploads/certificate_assets/{org_uuid}/file */
function certificateAssetOrgIdFromPath(string $rawPath): ?string {
    if (!preg_match('#^/uploads/certificate_assets/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/#', $rawPath, $m)) {
        return null;
    }
    return strtolower($m[1]);
}

/** Whether the caller's org may read a certificate template asset (super_admin always). */
function certificateAssetAccessibleByUser(PDO $db, array $tokenData, string $rawPath): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        return true;
    }
    if (strpos($rawPath, '/uploads/certificate_assets/') !== 0) {
        return false;
    }

    $callerOrg = strtolower(trim((string) (resolveCreatorOrgId($db, $tokenData) ?? '')));
    $pathOrg = certificateAssetOrgIdFromPath($rawPath);
    if ($pathOrg !== null) {
        return $callerOrg !== '' && $pathOrg === $callerOrg;
    }

    $org = orgFilter($tokenData, 'ct', $db);
    if ($org['where'] === '1=0' || $org['where'] === '1=1') {
        return $org['where'] === '1=1';
    }

    $patterns = certificateAssetJsonLikePatterns($rawPath);
    if ($patterns === []) {
        return false;
    }

    foreach ($patterns as $pattern) {
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $pattern) . '%';
        try {
            $st = $db->prepare(
                "SELECT ct.id FROM certificate_templates ct
                 WHERE {$org['where']}
                   AND (CAST(ct.style_json AS CHAR) LIKE ?
                        OR CAST(ct.layers_json AS CHAR) LIKE ?
                        OR CAST(ct.fields_json AS CHAR) LIKE ?)
                 LIMIT 1"
            );
            $st->execute(array_merge($org['params'], [$like, $like, $like]));
            if ($st->fetch(PDO::FETCH_ASSOC)) {
                return true;
            }
        } catch (Throwable $e) {
            // continue with next pattern
        }
    }

    return false;
}

/**
 * Validate and store an uploaded resume file under uploads/resumes/.
 *
 * @param array|null $file Single element from $_FILES (e.g. $_FILES['resume'])
 * @return string|null Relative URL path e.g. /uploads/resumes/xxx.pdf, or null if no file sent
 */
function saveLeadResumeUpload(?array $file): ?string {
    if ($file === null || !isset($file['error'])) {
        return null;
    }
    if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if ((int) $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'Resume upload failed'], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid resume upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > leadResumeMaxBytes()) {
        respond(['error' => 'Resume exceeds 5MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    if ($mime === '' || !in_array($mime, leadResumeAllowedMimeTypes(), true)) {
        respond(['error' => 'Resume must be PDF or Word document'], 400);
    }
    $uploadParent = __DIR__ . '/../uploads/resumes';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $orig = basename((string) ($file['name'] ?? 'resume'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'resume';
    $filename = uniqid('', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save resume'], 500);
    }
    return '/uploads/resumes/' . $filename;
}

/** Broader file types for public form uploads (resume, certificates, images). */
function formLeadAttachmentAllowedMimeTypes(): array {
    return array_merge(leadResumeAllowedMimeTypes(), [
        'image/jpeg',
        'image/png',
        'image/webp',
        'text/plain',
    ]);
}

/**
 * Store a Peaklyy assessment answer attachment under uploads/assessment_answers/.
 *
 * @return string Relative URL path e.g. /uploads/assessment_answers/xxx.pdf
 */
function savePeaklyyAnswerUpload(?array $file): string {
    if ($file === null || !isset($file['error'])) {
        respond(['error' => 'No file uploaded'], 400);
    }
    if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
        respond(['error' => 'No file uploaded'], 400);
    }
    if ((int) $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'File upload failed'], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid file upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > leadResumeMaxBytes()) {
        respond(['error' => 'File exceeds 5MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    $allowed = array_merge(formLeadAttachmentAllowedMimeTypes(), [
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
    ]);
    if ($mime === '' || !in_array($mime, $allowed, true)) {
        respond(['error' => 'File must be PDF, Word, image, text, or ZIP (max 5MB)'], 400);
    }
    $uploadParent = __DIR__ . '/../uploads/assessment_answers';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $orig = basename((string) ($file['name'] ?? 'file'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'file';
    $filename = uniqid('', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save file'], 500);
    }
    return '/uploads/assessment_answers/' . $filename;
}

/**
 * Sanitize candidate name for download filenames.
 */
function peaklyySanitizeCandidateFileBase(string $name): string
{
    $name = trim($name);
    $name = preg_replace('/\s+/u', '_', $name) ?? 'Candidate';
    $name = preg_replace('/[^a-zA-Z0-9._-]/', '_', $name) ?? 'Candidate';
    $name = trim($name, '._-');
    return $name !== '' ? $name : 'Candidate';
}

/**
 * Persist notepad answer as a .txt file (CandidateName_Q1.txt).
 * Overwrites existing notepad path when provided.
 *
 * @return array{path:string,file_name:string}
 */
function savePeaklyyNotepadTextFile(
    string $candidateName,
    int $questionNumber,
    string $text,
    ?string $existingRelativePath = null
): array {
    $base = peaklyySanitizeCandidateFileBase($candidateName);
    $q = max(1, $questionNumber);
    $displayName = $base . '_Q' . $q . '.txt';

    $uploadParent = __DIR__ . '/../uploads/assessment_answers';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }

    $destFs = null;
    $relPath = null;
    if ($existingRelativePath) {
        $raw = $existingRelativePath[0] === '/' ? $existingRelativePath : '/' . $existingRelativePath;
        if (strpos($raw, '/uploads/assessment_answers/') === 0 && strpos($raw, '..') === false) {
            $candidate = $baseDir . DIRECTORY_SEPARATOR . basename($raw);
            $resolved = realpath(dirname($candidate));
            if ($resolved !== false && str_starts_with(str_replace('\\', '/', $resolved), str_replace('\\', '/', $baseDir))) {
                $destFs = $baseDir . DIRECTORY_SEPARATOR . basename($raw);
                $relPath = '/uploads/assessment_answers/' . basename($raw);
            }
        }
    }
    if ($destFs === null) {
        $storageName = 'np_' . str_replace('.', '', uniqid('', true)) . '_' . $displayName;
        $destFs = $baseDir . DIRECTORY_SEPARATOR . $storageName;
        $relPath = '/uploads/assessment_answers/' . $storageName;
    }

    if (file_put_contents($destFs, $text) === false) {
        respond(['error' => 'Failed to save notepad file'], 500);
    }

    return [
        'path' => (string) $relPath,
        'file_name' => $displayName,
    ];
}

/**
 * Resolve /uploads/... relative path to an absolute filesystem path.
 */
function peaklyyResolveUploadFsPath(string $rawPath): ?string
{
    $rawPath = trim($rawPath);
    if ($rawPath === '') {
        return null;
    }
    if ($rawPath[0] !== '/') {
        $rawPath = '/' . $rawPath;
    }
    if (strpos($rawPath, '..') !== false) {
        return null;
    }
    $candidates = [
        dirname(__DIR__) . str_replace('/', DIRECTORY_SEPARATOR, $rawPath),
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
    ];
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        $norm = str_replace('\\', '/', $resolved);
        if (strpos($norm, '/uploads/') === false) {
            continue;
        }
        return $resolved;
    }
    return null;
}

/**
 * Store a public-form attachment under uploads/form_leads/.
 *
 * @return string|null Relative URL path e.g. /uploads/form_leads/xxx.pdf
 */
function saveFormLeadAttachmentUpload(?array $file): ?string {
    if ($file === null || !isset($file['error'])) {
        return null;
    }
    if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if ((int) $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'File upload failed'], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid file upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > leadResumeMaxBytes()) {
        respond(['error' => 'File exceeds 5MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    if ($mime === '' || !in_array($mime, formLeadAttachmentAllowedMimeTypes(), true)) {
        respond(['error' => 'File must be PDF, Word, JPG, PNG, or plain text'], 400);
    }
    $uploadParent = __DIR__ . '/../uploads/form_leads';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $orig = basename((string) ($file['name'] ?? 'file'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'file';
    $filename = uniqid('', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save file'], 500);
    }
    return '/uploads/form_leads/' . $filename;
}

/** Allow custom form sources like form_my-slug (legacy ENUM breaks inserts). */
function ensureLeadsSourceColumnVarchar(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec("ALTER TABLE leads MODIFY COLUMN source VARCHAR(100) DEFAULT 'other'");
    } catch (PDOException $e) {
        /* column may already be VARCHAR */
    }
    $done = true;
}

/**
 * leads.status was a narrow ENUM missing not_answered / messaged (and other pipeline values).
 * Invalid ENUM writes become '' in non-strict MySQL → blank status in the UI.
 */
function ensureLeadsStatusColumn(PDO $db, bool $force = false): void {
    static $done = false;
    if ($done && !$force) {
        return;
    }
    if ($force) {
        $done = false;
    }

    $columnOk = static function (PDO $db): bool {
        try {
            $stmt = $db->query("SHOW COLUMNS FROM leads LIKE 'status'");
            $col = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            if (!$col) {
                return false;
            }
            $type = strtolower((string) ($col['Type'] ?? ''));
            // VARCHAR accepts any pipeline status; ENUM must explicitly list not_answered + messaged.
            if (str_starts_with($type, 'varchar') || str_starts_with($type, 'char') || str_starts_with($type, 'text')) {
                return true;
            }
            return str_contains($type, 'not_answered') && str_contains($type, 'messaged');
        } catch (Throwable $e) {
            return false;
        }
    };

    if (!$columnOk($db)) {
        try {
            $db->exec("ALTER TABLE leads MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'new'");
        } catch (PDOException $e) {
            try {
                $db->exec(
                    "ALTER TABLE leads MODIFY COLUMN status ENUM(
                        'new','contacted','not_answered','messaged','qualified','interested',
                        'demo_scheduled','demo_attended','enrolled','lost','converted','considering','not_interested'
                    ) NOT NULL DEFAULT 'new'"
                );
            } catch (PDOException $e2) {
                error_log('[leads] ensureLeadsStatusColumn ALTER failed: ' . $e2->getMessage());
            }
        }
    }

    try {
        $db->exec("UPDATE leads SET status = 'new' WHERE status IS NULL OR TRIM(CAST(status AS CHAR)) = ''");
    } catch (PDOException $e) {
        try {
            $db->exec("UPDATE leads SET status = 'new' WHERE status IS NULL OR status = ''");
        } catch (PDOException $e2) {
            /* ignore */
        }
    }

    // Only skip future runs once the column can store the new statuses.
    if ($columnOk($db)) {
        $done = true;
    }
}

/** Ensure leads.resume_path exists for public forms and CRM uploads. */
function ensureLeadsResumeColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec('ALTER TABLE leads ADD COLUMN resume_path VARCHAR(500) DEFAULT NULL AFTER notes');
    } catch (PDOException $e) {
        /* duplicate column / already exists */
    }
    $done = true;
}

/** Ensure leads.created_by exists so creators (e.g. managers) keep visibility on their rows. */
function ensureLeadsCreatedByColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'leads', 'created_by')) {
            $db->exec('ALTER TABLE leads ADD COLUMN created_by CHAR(36) DEFAULT NULL');
        }
    } catch (Throwable $e) {
    }
    $done = true;
}

/** @return array<string,mixed>|null */
function publicLeadFetchFormBySlug(PDO $db, string $slug): ?array {
    $slug = trim($slug);
    if ($slug === '') {
        return null;
    }
    $stmt = $db->prepare(
        'SELECT lf.id, lf.name, lf.slug, lf.description, lf.fields_json, lf.meta_json, lf.is_active, lf.org_id, lf.created_by,
                o.name AS org_name
         FROM lead_forms lf
         LEFT JOIN organizations o ON o.id = lf.org_id
         WHERE LOWER(TRIM(lf.slug)) = LOWER(TRIM(?)) AND lf.is_active = 1
         ORDER BY (lf.org_id IS NOT NULL) DESC, lf.updated_at DESC LIMIT 1',
    );
    $stmt->execute([$slug]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/** @return array<int,array<string,mixed>> */
function publicFormBuilderQuestionsFromMeta(?array $meta): array {
    if (!is_array($meta)) {
        return [];
    }
    $out = [];
    $flat = $meta['builder_questions'] ?? [];
    if (is_array($flat)) {
        foreach ($flat as $q) {
            if (is_array($q)) {
                $out[] = $q;
            }
        }
    }
    $sections = $meta['sections'] ?? [];
    if (is_array($sections)) {
        foreach ($sections as $sec) {
            if (!is_array($sec)) {
                continue;
            }
            $qs = $sec['questions'] ?? [];
            if (!is_array($qs)) {
                continue;
            }
            foreach ($qs as $q) {
                if (is_array($q)) {
                    $out[] = $q;
                }
            }
        }
    }
    return $out;
}

/** True when the form collects a resume (file upload or resume/CV field). */
function publicFormHasResumeField(?array $formRow): bool {
    if (!is_array($formRow)) {
        return false;
    }
    $meta = [];
    if (!empty($formRow['meta_json'])) {
        if (is_array($formRow['meta_json'])) {
            $meta = $formRow['meta_json'];
        } elseif (is_string($formRow['meta_json'])) {
            $tmp = json_decode($formRow['meta_json'], true);
            if (is_array($tmp)) {
                $meta = $tmp;
            }
        }
    }
    foreach (publicFormBuilderQuestionsFromMeta($meta) as $q) {
        $type = strtolower(trim((string) ($q['type'] ?? '')));
        $title = (string) ($q['title'] ?? '');
        if ($type === 'file_upload' && preg_match('/resume|cv|curriculum/i', $title)) {
            return true;
        }
        if (preg_match('/resume|cv|curriculum/i', $title)) {
            return true;
        }
    }
    $fields = $formRow['fields_json'] ?? [];
    if (is_string($fields)) {
        $fields = json_decode($fields, true) ?: [];
    }
    if (is_array($fields)) {
        foreach ($fields as $f) {
            if (!is_array($f)) {
                continue;
            }
            $label = (string) ($f['label'] ?? $f['key'] ?? '');
            if (preg_match('/resume|cv/i', $label)) {
                return true;
            }
        }
    }
    return false;
}

/** Generate plaintext form external API key (shown once). */
function formExternalApiKeyGenerateRaw(): string {
    $raw = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    return 'frm_' . $raw;
}

/** Hash plaintext form external API key for DB/meta storage. */
function formExternalApiKeyHash(string $raw): string {
    return password_hash($raw, PASSWORD_DEFAULT);
}

/** Verify plaintext form external API key against stored hash. */
function formExternalApiKeyVerify(string $provided, string $storedHash): bool {
    $provided = trim($provided);
    $storedHash = trim($storedHash);
    if ($provided === '' || $storedHash === '') {
        return false;
    }
    return password_verify($provided, $storedHash);
}

/** Read explicit lead destination from form meta_json (`form_leads` | `hr_leads`). */
function publicFormLeadDestination(?array $formRow): ?string {
    if (!is_array($formRow)) {
        return null;
    }
    $meta = [];
    if (!empty($formRow['meta_json'])) {
        if (is_array($formRow['meta_json'])) {
            $meta = $formRow['meta_json'];
        } elseif (is_string($formRow['meta_json'])) {
            $tmp = json_decode($formRow['meta_json'], true);
            if (is_array($tmp)) {
                $meta = $tmp;
            }
        }
    }
    $dest = strtolower(trim((string) ($meta['lead_destination'] ?? '')));
    if ($dest === 'hr_leads' || $dest === 'form_leads') {
        return $dest;
    }
    return null;
}

/** Resume / job-application public forms → HR Leads (not Form Leads). */
function publicLeadShouldRouteToHr(
    ?array $formRow,
    string $formSlug,
    string $source,
    ?string $resumePath,
    array $attachmentPaths,
): bool {
    $configured = publicFormLeadDestination($formRow);
    if ($configured === 'hr_leads') {
        return true;
    }
    if ($configured === 'form_leads') {
        return false;
    }
    if ($resumePath !== null && $resumePath !== '') {
        return true;
    }
    foreach (array_keys($attachmentPaths) as $key) {
        if (preg_match('/resume|cv|curriculum/i', (string) $key)) {
            return true;
        }
    }
    if (publicFormHasResumeField($formRow)) {
        return true;
    }
    $formName = is_array($formRow) ? trim((string) ($formRow['name'] ?? '')) : '';
    $formSlugDb = is_array($formRow) ? trim((string) ($formRow['slug'] ?? '')) : '';
    $haystack = strtolower(trim("$formSlug $formSlugDb $formName $source"));
    if (preg_match('/job[-_\s]?application|resume|curriculum|hiring|career|vacancy|\bcv\b/', $haystack)) {
        return true;
    }
    return false;
}

/** Pick an HR user to receive public resume-form submissions (same org as the form only). */
function resolveHrUserIdForPublicForm(PDO $db, ?string $orgId, ?string $formCreatorId): ?string {
    $orgId = is_string($orgId) ? trim($orgId) : '';
    if ($orgId === '') {
        $orgId = null;
    }

    $userInOrg = static function (?string $userId, ?string $requiredRole = null) use ($db, $orgId): ?string {
        $uid = is_string($userId) ? trim($userId) : '';
        if ($uid === '') {
            return null;
        }
        $st = $db->prepare('SELECT id, role, org_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
        $st->execute([$uid]);
        $u = $st->fetch(PDO::FETCH_ASSOC);
        if (!$u || empty($u['id'])) {
            return null;
        }
        if ($requiredRole !== null) {
            $roleKey = syncpediaNormalizeRoleKey((string) ($u['role'] ?? ''));
            if ($roleKey !== syncpediaNormalizeRoleKey($requiredRole)) {
                return null;
            }
        }
        if ($orgId !== null) {
            $userOrg = trim((string) ($u['org_id'] ?? ''));
            if ($userOrg !== '' && $userOrg !== $orgId) {
                return null;
            }
        }
        return (string) $u['id'];
    };

    if ($formCreatorId !== null && $formCreatorId !== '') {
        $hrCreator = $userInOrg($formCreatorId, 'hr');
        if ($hrCreator !== null) {
            return $hrCreator;
        }
    }
    if ($orgId !== null) {
        $st = $db->prepare(
            "SELECT id FROM users WHERE org_id = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'hr' ORDER BY created_at ASC LIMIT 1",
        );
        $st->execute([$orgId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row && !empty($row['id'])) {
            return (string) $row['id'];
        }
    }
    // No HR user yet — form creator owns the row until admin assigns to HR.
    if ($formCreatorId !== null && $formCreatorId !== '') {
        $creator = $userInOrg($formCreatorId);
        if ($creator !== null) {
            return $creator;
        }
    }
    if ($orgId !== null) {
        $st = $db->prepare(
            "SELECT id FROM users WHERE org_id = ? AND is_active = 1 AND LOWER(TRIM(role)) IN ('admin','super_admin','org') ORDER BY created_at ASC LIMIT 1",
        );
        $st->execute([$orgId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row && !empty($row['id'])) {
            return (string) $row['id'];
        }
    }
    return null;
}

/** Extract phone for hr_leads (phone column is NOT NULL). */
function publicFormResolvePhone(?string $phone, array $extraAnswers): string {
    $phone = trim((string) ($phone ?? ''));
    if ($phone !== '') {
        return $phone;
    }
    foreach ($extraAnswers as $key => $val) {
        if (!is_scalar($val)) {
            continue;
        }
        $k = strtolower((string) $key);
        $s = trim((string) $val);
        if ($s === '') {
            continue;
        }
        if (preg_match('/phone|mobile|contact|whatsapp|tel/i', $k)) {
            return $s;
        }
    }
    foreach ($extraAnswers as $val) {
        if (!is_scalar($val)) {
            continue;
        }
        $digits = preg_replace('/[^\d+]/', '', (string) $val);
        if (strlen($digits) >= 10) {
            return trim((string) $val);
        }
    }
    return '0000000000';
}

function ensureHrLeadsTableExists(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    if (syncpediaSkipRuntimeDdl($db)) {
        $done = true;
        return;
    }
    $sql = "CREATE TABLE IF NOT EXISTS hr_leads (
      id SERIAL PRIMARY KEY,
      hr_id CHAR(36) NOT NULL,
      assigned_by CHAR(36) DEFAULT NULL,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(255) DEFAULT NULL,
      source VARCHAR(100) DEFAULT NULL,
      status VARCHAR(30) DEFAULT 'new',
      priority VARCHAR(20) DEFAULT 'medium',
      notes TEXT DEFAULT NULL,
      resume_path VARCHAR(500) DEFAULT NULL,
      follow_up_date DATE DEFAULT NULL,
      is_assigned BOOLEAN DEFAULT FALSE,
      org_id CHAR(36) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      FOREIGN KEY (hr_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_hr_leads_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
    )";
    $db->exec($sql);
    $db->exec('CREATE INDEX IF NOT EXISTS idx_hr_leads_hr_id ON hr_leads (hr_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_hr_leads_status ON hr_leads (status)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_hr_leads_is_assigned ON hr_leads (is_assigned)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_hr_leads_created_at ON hr_leads (created_at)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_hr_leads_org_id ON hr_leads (org_id)');
    try {
        if (!syncpediaColumnExists($db, 'hr_leads', 'resume_path')) {
            $db->exec('ALTER TABLE hr_leads ADD COLUMN resume_path VARCHAR(500) DEFAULT NULL');
        }
    } catch (PDOException $e) {
        /* already exists */
    }
    $done = true;
}

/** Remove a previously stored resume file from disk (safe path under uploads/resumes/). */
function deleteLeadResumeIfExists(?string $relativePath): void {
    if ($relativePath === null || $relativePath === '') {
        return;
    }
    $rel = str_replace('\\', '/', $relativePath);
    $rel = ltrim($rel, '/');
    if ($rel === '' || strpos($rel, '..') !== false) {
        return;
    }
    $uploadRoot = realpath(__DIR__ . '/../uploads/resumes');
    if ($uploadRoot === false) {
        return;
    }
    $candidate = __DIR__ . '/../' . str_replace('/', DIRECTORY_SEPARATOR, $rel);
    $full = realpath($candidate);
    if ($full === false || !is_file($full)) {
        return;
    }
    $uploadRootNorm = str_replace('\\', '/', $uploadRoot);
    $fullNorm = str_replace('\\', '/', $full);
    if (strpos($fullNorm, rtrim($uploadRootNorm, '/')) !== 0) {
        return;
    }
    @unlink($full);
}

/** MIME types allowed for call log recordings / attachments. */
function callRecordingAllowedMimeTypes(): array {
    return [
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/mp4',
        'audio/x-m4a',
        'audio/aac',
        'audio/aacp',
        'audio/webm',
        'audio/ogg',
        'application/pdf',
    ];
}

function callRecordingMaxBytes(): int {
    return 30 * 1024 * 1024;
}

/**
 * Safe single path segment for recordings/{org_name}/{username}/.
 */
function callRecordingSanitizeFolderSegment(string $raw, string $fallback = 'unknown'): string
{
    $s = trim($raw);
    // Letters/numbers (unicode) + space/dot/underscore/hyphen; then spaces → underscore.
    $s = preg_replace('/[^\p{L}\p{N}\s._-]+/u', '', $s) ?? '';
    $s = preg_replace('/\s+/', '_', $s) ?? '';
    $s = trim($s, '._-');
    if ($s === '') {
        $fb = preg_replace('/[^a-zA-Z0-9_-]/', '', $fallback) ?? '';
        $s = $fb !== '' ? $fb : 'unknown';
    }
    if (function_exists('mb_substr')) {
        $s = mb_substr($s, 0, 80);
    } else {
        $s = substr($s, 0, 80);
    }
    return $s !== '' ? $s : 'unknown';
}

/**
 * @return array{0:string,1:string} [org_folder, user_folder]
 */
function callRecordingOrgUserFolderNames(PDO $db, string $orgId, string $userId): array
{
    $orgName = '';
    try {
        $st = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $orgName = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $ignored) {
    }
    $userName = '';
    try {
        $st = $db->prepare('SELECT full_name FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $userName = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $ignored) {
    }
    return [
        callRecordingSanitizeFolderSegment($orgName, $orgId !== '' ? $orgId : 'org'),
        callRecordingSanitizeFolderSegment($userName, $userId !== '' ? $userId : 'user'),
    ];
}

/** Relative directory: /uploads/recordings/{org_name}/{username} */
function callRecordingRelativeDir(PDO $db, string $orgId, string $userId): string
{
    [$orgSeg, $userSeg] = callRecordingOrgUserFolderNames($db, $orgId, $userId);
    return '/uploads/recordings/' . $orgSeg . '/' . $userSeg;
}

/**
 * Resolve a writable absolute filesystem dir for a relative /uploads/... path.
 */
function callRecordingEnsureAbsoluteDir(string $dirRel): string
{
    $dirRel = '/' . ltrim(str_replace('\\', '/', $dirRel), '/');
    $candidates = [
        dirname(__DIR__) . $dirRel, // public/uploads/... when helpers is in public/api
        __DIR__ . '/..' . $dirRel,
        dirname(__DIR__, 2) . '/public' . $dirRel,
    ];
    foreach ($candidates as $candidate) {
        if (!is_dir($candidate)) {
            @mkdir($candidate, 0755, true);
        }
        if (is_dir($candidate) && is_writable($candidate)) {
            $real = realpath($candidate);
            if ($real !== false) {
                return $real;
            }
        }
    }
    respond(['error' => 'Unable to store recording on server'], 500);
    return ''; // unreachable
}

/**
 * Ensure uploads/resumes, recordings, and legacy call_recordings exist (idempotent).
 */
function ensureUploadDirectoriesExist(): void {
    $parent = __DIR__ . '/../uploads';
    foreach (['resumes', 'recordings', 'call_recordings', 'form_leads'] as $sub) {
        $dir = $parent . DIRECTORY_SEPARATOR . $sub;
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
    }
}

/**
 * Validate and store an uploaded call recording under
 * uploads/recordings/{org_name}/{username}/.
 *
 * @param array|null $file Single element from $_FILES
 * @return string|null Relative path e.g. /uploads/recordings/Syncpedia/Jahnavi_K/xxx.webm
 */
function saveCallRecordingUpload(?array $file, ?PDO $db = null, ?string $orgId = null, ?string $userId = null): ?string {
    if ($file === null || !isset($file['error'])) {
        return null;
    }
    if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if ((int) $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'Call recording upload failed'], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid call recording upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > callRecordingMaxBytes()) {
        respond(['error' => 'Recording exceeds 30MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    if ($mime === '' || !in_array($mime, callRecordingAllowedMimeTypes(), true)) {
        respond(['error' => 'Recording must be audio (mp3, wav, m4a, webm, ogg) or PDF'], 400);
    }

    $dirRel = '/uploads/recordings/unknown/unknown';
    if ($db instanceof PDO && $orgId !== null && $orgId !== '' && $userId !== null && $userId !== '') {
        $dirRel = callRecordingRelativeDir($db, $orgId, $userId);
    }
    $baseDir = callRecordingEnsureAbsoluteDir($dirRel);

    $orig = basename((string) ($file['name'] ?? 'recording'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'recording';
    $filename = uniqid('', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save recording'], 500);
    }
    return rtrim($dirRel, '/') . '/' . $filename;
}

/**
 * Remove a stored call recording (safe under uploads/recordings or legacy call_recordings).
 */
function deleteCallRecordingIfExists(?string $relativePath): void {
    if ($relativePath === null || $relativePath === '') {
        return;
    }
    $rel = str_replace('\\', '/', $relativePath);
    $rel = ltrim($rel, '/');
    if ($rel === '' || strpos($rel, '..') !== false) {
        return;
    }
    if (
        strpos($rel, 'uploads/recordings/') !== 0
        && strpos($rel, 'uploads/call_recordings/') !== 0
    ) {
        return;
    }
    $uploadsRoot = realpath(__DIR__ . '/../uploads');
    if ($uploadsRoot === false) {
        return;
    }
    $candidate = __DIR__ . '/../' . str_replace('/', DIRECTORY_SEPARATOR, $rel);
    $full = realpath($candidate);
    if ($full === false || !is_file($full)) {
        return;
    }
    $uploadRootNorm = str_replace('\\', '/', $uploadsRoot);
    $fullNorm = str_replace('\\', '/', $full);
    if (strpos($fullNorm, rtrim($uploadRootNorm, '/')) !== 0) {
        return;
    }
    @unlink($full);
}

/** Max bytes for manual payment proof uploads (12MB). */
function paymentProofMaxBytes(): int
{
    return 12 * 1024 * 1024;
}

/** Image + PDF mime types accepted as payment proof. */
function paymentProofAllowedMimeTypes(): array
{
    return [
        'image/jpeg',
        'image/jpg',
        'image/pjpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/x-ms-bmp',
        'image/tiff',
        'image/heic',
        'image/heif',
        'image/svg+xml',
        'application/pdf',
        'application/x-pdf',
    ];
}

/**
 * Validate and store a payment proof image/PDF under uploads/payment_proofs/.
 *
 * @param array|null $file Single element from $_FILES
 * @return string|null Relative path e.g. /uploads/payment_proofs/xxx.jpg
 */
function savePaymentProofUpload(?array $file): ?string
{
    if ($file === null || !isset($file['error'])) {
        return null;
    }
    if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if ((int) $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'Proof upload failed'], 400);
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid proof upload'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size > paymentProofMaxBytes()) {
        respond(['error' => 'Proof file exceeds 12MB limit'], 400);
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
    }
    if ($mime === '' || !in_array(strtolower($mime), paymentProofAllowedMimeTypes(), true)) {
        respond(['error' => 'Proof must be an image (jpg, png, gif, webp, bmp, tiff, heic, svg) or PDF'], 400);
    }
    $uploadParent = __DIR__ . '/../uploads/payment_proofs';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $orig = basename((string) ($file['name'] ?? 'proof'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'proof';
    $filename = uniqid('mp_', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save proof file'], 500);
    }
    return '/uploads/payment_proofs/' . $filename;
}

/** Remove a stored payment proof (safe path under uploads/payment_proofs/). */
function deletePaymentProofIfExists(?string $relativePath): void
{
    if ($relativePath === null || $relativePath === '') {
        return;
    }
    $rel = str_replace('\\', '/', $relativePath);
    $rel = ltrim($rel, '/');
    if ($rel === '' || strpos($rel, '..') !== false) {
        return;
    }
    $uploadRoot = realpath(__DIR__ . '/../uploads/payment_proofs');
    if ($uploadRoot === false) {
        return;
    }
    $candidate = __DIR__ . '/../' . str_replace('/', DIRECTORY_SEPARATOR, $rel);
    $full = realpath($candidate);
    if ($full === false || !is_file($full)) {
        return;
    }
    $uploadRootNorm = str_replace('\\', '/', $uploadRoot);
    $fullNorm = str_replace('\\', '/', $full);
    if (strpos($fullNorm, rtrim($uploadRootNorm, '/')) !== 0) {
        return;
    }
    @unlink($full);
}

/**
 * Referral code format SP-{FIRSTNAME}-{4 digits}, unique in users.referral_code.
 */
function generateUniqueSpReferralCode(PDO $db, string $fullName): string {
    $parts = preg_split('/\s+/', trim($fullName)) ?: [];
    $first = (string) ($parts[0] ?? 'USER');
    $slug = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $first));
    if ($slug === '') {
        $slug = 'USER';
    }
    $slug = substr($slug, 0, 12);
    for ($i = 0; $i < 100; $i++) {
        $n = random_int(0, 9999);
        $code = sprintf('SP-%s-%04d', $slug, $n);
        $st = $db->prepare('SELECT id FROM users WHERE referral_code = ? LIMIT 1');
        $st->execute([$code]);
        if (!$st->fetch()) {
            return $code;
        }
    }
    return 'SP-' . $slug . '-' . substr(str_replace('-', '', generateUUID()), 0, 6);
}

/**
 * Ensure user has an SP-* style referral code (upgrades legacy short codes when safe).
 */
function ensureUserSpReferralCode(PDO $db, string $userId): string {
    $st = $db->prepare('SELECT referral_code, full_name FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return '';
    }
    $existing = trim((string) ($row['referral_code'] ?? ''));
    if ($existing !== '' && preg_match('/^SP-[A-Z0-9]+-\d{4}$/', $existing)) {
        return $existing;
    }
    $code = generateUniqueSpReferralCode($db, (string) ($row['full_name'] ?? 'User'));
    $up = $db->prepare('UPDATE users SET referral_code = ? WHERE id = ?');
    $up->execute([$code, $userId]);
    return $code;
}

/** Adds fresher_training_join_date to users when missing (idempotent). */
function usersEnsureFresherTrainingJoinDateColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec('ALTER TABLE users ADD COLUMN fresher_training_join_date DATE NULL DEFAULT NULL');
    } catch (Throwable $e) {
        // Column already exists
    }
    $done = true;
}

/**
 * Fresher phase from joining date: 15d training, then three 30-day months (UTC calendar days).
 *
 * @return array{phase_key:string,label:string,window_start:?string,window_end_exclusive:?string,target_rupees:int}|null
 */
function fresherComputePhaseFromJoin(?string $joinYmd): ?array {
    if ($joinYmd === null || trim($joinYmd) === '') {
        return null;
    }
    $joinYmd = substr(preg_replace('/[^0-9\-]/', '', (string) $joinYmd), 0, 10);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinYmd)) {
        return null;
    }
    try {
        $join = new DateTimeImmutable($joinYmd . 'T00:00:00Z');
    } catch (Throwable $e) {
        return null;
    }
    $today = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->setTime(0, 0, 0);
    if ($today < $join) {
        return [
            'phase_key' => 'pre_join',
            'label' => 'Training (upcoming)',
            'window_start' => $join->format('Y-m-d'),
            'window_end_exclusive' => $join->modify('+15 days')->format('Y-m-d'),
            'target_rupees' => 30000,
        ];
    }
    $t0 = $join;
    $t1 = $join->modify('+15 days');
    $m1e = $join->modify('+45 days');
    $m2e = $join->modify('+75 days');
    $m3e = $join->modify('+105 days');
    if ($today < $t1) {
        return [
            'phase_key' => 'training',
            'label' => 'Training (15 days)',
            'window_start' => $t0->format('Y-m-d'),
            'window_end_exclusive' => $t1->format('Y-m-d'),
            'target_rupees' => 30000,
        ];
    }
    if ($today < $m1e) {
        return [
            'phase_key' => 'month1',
            'label' => 'Month 1',
            'window_start' => $t1->format('Y-m-d'),
            'window_end_exclusive' => $m1e->format('Y-m-d'),
            'target_rupees' => 160000,
        ];
    }
    if ($today < $m2e) {
        return [
            'phase_key' => 'month2',
            'label' => 'Month 2',
            'window_start' => $m1e->format('Y-m-d'),
            'window_end_exclusive' => $m2e->format('Y-m-d'),
            'target_rupees' => 160000,
        ];
    }
    if ($today < $m3e) {
        return [
            'phase_key' => 'month3',
            'label' => 'Month 3',
            'window_start' => $m2e->format('Y-m-d'),
            'window_end_exclusive' => $m3e->format('Y-m-d'),
            'target_rupees' => 160000,
        ];
    }

    return [
        'phase_key' => 'completed',
        'label' => 'Program completed',
        'window_start' => null,
        'window_end_exclusive' => null,
        'target_rupees' => 0,
    ];
}

/** Sort order for fresher phase keys (pre_join < training < month1 …). */
function fresherPhaseOrder(string $phaseKey): int {
    static $order = [
        'pre_join' => 0,
        'training' => 1,
        'month1' => 2,
        'month2' => 3,
        'month3' => 4,
        'completed' => 5,
    ];
    return $order[$phaseKey] ?? -1;
}

/**
 * Calendar window + target for a specific phase key (aligned with fresherComputePhaseFromJoin).
 *
 * @return array{phase_key:string,label:string,window_start:?string,window_end_exclusive:?string,target_rupees:int}|null
 */
function fresherPhaseWindowByKey(string $joinYmd, string $phaseKey): ?array {
    if ($joinYmd === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinYmd)) {
        return null;
    }
    try {
        $join = new DateTimeImmutable($joinYmd . 'T00:00:00Z');
    } catch (Throwable $e) {
        return null;
    }
    $t0 = $join;
    $t1 = $join->modify('+15 days');
    $m1e = $join->modify('+45 days');
    $m2e = $join->modify('+75 days');
    $m3e = $join->modify('+105 days');
    switch ($phaseKey) {
        case 'pre_join':
            return [
                'phase_key' => 'pre_join',
                'label' => 'Training (upcoming)',
                'window_start' => $t0->format('Y-m-d'),
                'window_end_exclusive' => $t1->format('Y-m-d'),
                'target_rupees' => 30000,
            ];
        case 'training':
            return [
                'phase_key' => 'training',
                'label' => 'Training (15 days)',
                'window_start' => $t0->format('Y-m-d'),
                'window_end_exclusive' => $t1->format('Y-m-d'),
                'target_rupees' => 30000,
            ];
        case 'month1':
            return [
                'phase_key' => 'month1',
                'label' => 'Month 1',
                'window_start' => $t1->format('Y-m-d'),
                'window_end_exclusive' => $m1e->format('Y-m-d'),
                'target_rupees' => 160000,
            ];
        case 'month2':
            return [
                'phase_key' => 'month2',
                'label' => 'Month 2',
                'window_start' => $m1e->format('Y-m-d'),
                'window_end_exclusive' => $m2e->format('Y-m-d'),
                'target_rupees' => 160000,
            ];
        case 'month3':
            return [
                'phase_key' => 'month3',
                'label' => 'Month 3',
                'window_start' => $m2e->format('Y-m-d'),
                'window_end_exclusive' => $m3e->format('Y-m-d'),
                'target_rupees' => 160000,
            ];
        case 'completed':
            return [
                'phase_key' => 'completed',
                'label' => 'Program completed',
                'window_start' => null,
                'window_end_exclusive' => null,
                'target_rupees' => 0,
            ];
        default:
            return null;
    }
}

/** Load fresher tracker JSON payload for a CRM user linked as trainee. */
function fresherLoadTrackerPayloadByTraineeUserId(PDO $db, string $traineeUserId, ?string $orgId = null): ?array {
    $traineeUserId = trim($traineeUserId);
    if ($traineeUserId === '') {
        return null;
    }
    $sql = "SELECT payload FROM fresher_salary_members WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.trainee_user_id')) = ?";
    $params = [$traineeUserId];
    if ($orgId !== null && trim($orgId) !== '') {
        $sql .= ' AND org_id = ?';
        $params[] = trim($orgId);
    }
    $sql .= ' ORDER BY updated_at DESC LIMIT 1';
    $st = $db->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row || empty($row['payload'])) {
        return null;
    }
    $j = json_decode((string) $row['payload'], true);
    return is_array($j) ? $j : null;
}

function fresherAchievedForPhaseKey(array $payload, string $phaseKey): float {
    switch ($phaseKey) {
        case 'training':
        case 'pre_join':
            return (float) ($payload['training']['achieved'] ?? 0);
        case 'month1':
            return (float) ($payload['month1']['achieved'] ?? 0);
        case 'month2':
            return (float) ($payload['month2']['totalAchieved'] ?? 0);
        case 'month3':
            return (float) ($payload['month3']['achieved'] ?? 0);
        default:
            return 0.0;
    }
}

/** Phase complete only when the calendar period for that phase has ended (not on early target met). */
function fresherIsPhaseComplete(?array $payload, string $phaseKey, string $joinYmd): bool {
    unset($payload);
    $cal = fresherComputePhaseFromJoin($joinYmd);
    if ($cal === null) {
        return false;
    }
    return fresherPhaseOrder((string) $cal['phase_key']) > fresherPhaseOrder($phaseKey);
}

/**
 * Payment attribution phase: tracker current phase when enrolled; never calendar-ahead of tracker.
 */
function fresherEffectivePaymentPhaseKey(?array $trackerPayload, ?array $calendarPhase): string {
    $calKey = is_array($calendarPhase) ? (string) ($calendarPhase['phase_key'] ?? 'completed') : 'completed';
    if (!$trackerPayload || empty($trackerPayload['currentPhase'])) {
        return $calKey;
    }
    $trackerKey = (string) $trackerPayload['currentPhase'];
    if ($trackerKey === 'completed') {
        return 'completed';
    }
    if (fresherPhaseOrder($calKey) > fresherPhaseOrder($trackerKey)) {
        return $trackerKey;
    }
    return $trackerKey;
}

/** Default org fresher salary + incentive policy (matches B2C spreadsheet). */
function fresherDefaultIncentiveTiers(): array {
    return [
        ['threshold' => 0, 'rate_percent' => 2],
        ['threshold' => 80000, 'rate_percent' => 4],
        ['threshold' => 120000, 'rate_percent' => 8],
        ['threshold' => 160000, 'rate_percent' => 12],
        ['threshold' => 200000, 'rate_percent' => 14],
    ];
}

function fresherNormalizeIncentiveTiers($raw): array {
    $defaults = fresherDefaultIncentiveTiers();
    if (!is_array($raw) || count($raw) === 0) {
        return $defaults;
    }
    $parsed = [];
    foreach ($raw as $row) {
        if (!is_array($row)) {
            continue;
        }
        $threshold = (int) max(0, round((float) ($row['threshold'] ?? $row['min_collected'] ?? 0)));
        $rate = (float) ($row['rate_percent'] ?? $row['rate'] ?? 0);
        $rate = max(0, min(100, $rate));
        $parsed[] = ['threshold' => $threshold, 'rate_percent' => $rate];
    }
    if (count($parsed) === 0) {
        return $defaults;
    }
    usort($parsed, static function ($a, $b) {
        return $a['threshold'] <=> $b['threshold'];
    });
    if ((int) ($parsed[0]['threshold'] ?? -1) !== 0) {
        array_unshift($parsed, ['threshold' => 0, 'rate_percent' => (float) ($defaults[0]['rate_percent'] ?? 2)]);
    }
    $byTh = [];
    foreach ($parsed as $t) {
        $byTh[(int) $t['threshold']] = $t;
    }
    ksort($byTh, SORT_NUMERIC);
    return array_values($byTh);
}

function fresherDefaultPolicy(): array {
    return [
        'training_days' => 15,
        'training_target' => 30000,
        'month_days' => 30,
        'monthly_full_target' => 160000,
        'monthly_gate_percent' => 50,
        'fixed_salary_monthly' => 15000,
        'probation_months' => 3,
        'incentive_tiers' => fresherDefaultIncentiveTiers(),
    ];
}

function fresherNormalizePolicy($raw): array {
    $d = fresherDefaultPolicy();
    if (!is_array($raw)) {
        return $d;
    }
    $out = $d;
    foreach ($d as $k => $fallback) {
        if ($k === 'incentive_tiers') {
            continue;
        }
        if (!array_key_exists($k, $raw)) {
            continue;
        }
        $n = (int) round((float) $raw[$k]);
        if ($k === 'monthly_gate_percent') {
            $n = max(0, min(100, $n));
        } elseif ($k === 'probation_months') {
            $n = max(1, min(12, $n));
        } elseif (in_array($k, ['training_days', 'month_days'], true)) {
            $n = max(1, $n);
        } else {
            $n = max(0, $n);
        }
        $out[$k] = $n;
    }
    $out['incentive_tiers'] = fresherNormalizeIncentiveTiers($raw['incentive_tiers'] ?? null);
    return $out;
}

function fresherMonthlyGateAmount(array $policy): int {
    $pct = (int) ($policy['monthly_gate_percent'] ?? 50);
    $full = (int) ($policy['monthly_full_target'] ?? 160000);
    return (int) round($full * (max(0, min(100, $pct)) / 100));
}

function fresherEnsurePolicyTable(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS fresher_salary_policy (
          org_id CHAR(36) NOT NULL,
          payload TEXT NOT NULL,
          updated_by CHAR(36) DEFAULT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (org_id)
        )
    ");
    $done = true;
}

function fresherLoadOrgPolicy(PDO $db, ?string $orgId): array {
    fresherEnsurePolicyTable($db);
    $orgId = trim((string) $orgId);
    if ($orgId === '') {
        return fresherDefaultPolicy();
    }
    $st = $db->prepare('SELECT payload FROM fresher_salary_policy WHERE org_id = ? LIMIT 1');
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row || empty($row['payload'])) {
        return fresherDefaultPolicy();
    }
    $j = json_decode((string) $row['payload'], true);
    return fresherNormalizePolicy(is_array($j) ? $j : null);
}

function fresherSaveOrgPolicy(PDO $db, string $orgId, array $policy, ?string $updatedBy): array {
    fresherEnsurePolicyTable($db);
    $norm = fresherNormalizePolicy($policy);
    $payload = json_encode($norm, JSON_UNESCAPED_UNICODE);
    $orgId = trim($orgId);
    // MySQL upsert
    try {
        $st = $db->prepare('
            INSERT INTO fresher_salary_policy (org_id, payload, updated_by, updated_at)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_by = VALUES(updated_by), updated_at = NOW()
        ');
        $st->execute([$orgId, $payload, $updatedBy]);
    } catch (Throwable $e) {
        $st = $db->prepare('DELETE FROM fresher_salary_policy WHERE org_id = ?');
        $st->execute([$orgId]);
        $st = $db->prepare('INSERT INTO fresher_salary_policy (org_id, payload, updated_by) VALUES (?, ?, ?)');
        $st->execute([$orgId, $payload, $updatedBy]);
    }
    return $norm;
}

/**
 * Calendar phase using org policy day lengths.
 *
 * @return array{phase_key:string,label:string,window_start:?string,window_end_exclusive:?string,target_rupees:int}|null
 */
function fresherComputePhaseFromJoinPolicy(?string $joinYmd, array $policy): ?array {
    if ($joinYmd === null || trim($joinYmd) === '') {
        return null;
    }
    $joinYmd = substr(preg_replace('/[^0-9\-]/', '', (string) $joinYmd), 0, 10);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinYmd)) {
        return null;
    }
    $policy = fresherNormalizePolicy($policy);
    $td = (int) $policy['training_days'];
    $md = (int) $policy['month_days'];
    $pm = (int) $policy['probation_months'];
    $trainT = (int) $policy['training_target'];
    $gate = fresherMonthlyGateAmount($policy);
    try {
        $join = new DateTimeImmutable($joinYmd . 'T00:00:00Z');
    } catch (Throwable $e) {
        return null;
    }
    $today = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->setTime(0, 0, 0);
    if ($today < $join) {
        return [
            'phase_key' => 'pre_join',
            'label' => 'Training (upcoming)',
            'window_start' => $join->format('Y-m-d'),
            'window_end_exclusive' => $join->modify('+' . $td . ' days')->format('Y-m-d'),
            'target_rupees' => $trainT,
        ];
    }
    $cursor = $join;
    $trainEnd = $join->modify('+' . $td . ' days');
    if ($today < $trainEnd) {
        return [
            'phase_key' => 'training',
            'label' => 'Training (' . $td . ' days)',
            'window_start' => $cursor->format('Y-m-d'),
            'window_end_exclusive' => $trainEnd->format('Y-m-d'),
            'target_rupees' => $trainT,
        ];
    }
    $cursor = $trainEnd;
    for ($i = 1; $i <= $pm; $i++) {
        $end = $cursor->modify('+' . $md . ' days');
        if ($today < $end) {
            return [
                'phase_key' => 'month' . $i,
                'label' => 'Month ' . $i,
                'window_start' => $cursor->format('Y-m-d'),
                'window_end_exclusive' => $end->format('Y-m-d'),
                'target_rupees' => $gate,
            ];
        }
        $cursor = $end;
    }
    return [
        'phase_key' => 'completed',
        'label' => 'Program completed',
        'window_start' => null,
        'window_end_exclusive' => null,
        'target_rupees' => 0,
    ];
}

function fresherPhaseWindowByKeyPolicy(string $joinYmd, string $phaseKey, array $policy): ?array {
    $policy = fresherNormalizePolicy($policy);
    $td = (int) $policy['training_days'];
    $md = (int) $policy['month_days'];
    $pm = (int) $policy['probation_months'];
    $trainT = (int) $policy['training_target'];
    $gate = fresherMonthlyGateAmount($policy);
    try {
        $join = new DateTimeImmutable($joinYmd . 'T00:00:00Z');
    } catch (Throwable $e) {
        return null;
    }
    if ($phaseKey === 'pre_join' || $phaseKey === 'training') {
        return [
            'phase_key' => $phaseKey === 'pre_join' ? 'pre_join' : 'training',
            'label' => $phaseKey === 'pre_join' ? 'Training (upcoming)' : ('Training (' . $td . ' days)'),
            'window_start' => $join->format('Y-m-d'),
            'window_end_exclusive' => $join->modify('+' . $td . ' days')->format('Y-m-d'),
            'target_rupees' => $trainT,
        ];
    }
    if ($phaseKey === 'completed') {
        return [
            'phase_key' => 'completed',
            'label' => 'Program completed',
            'window_start' => null,
            'window_end_exclusive' => null,
            'target_rupees' => 0,
        ];
    }
    if (preg_match('/^month(\d+)$/', $phaseKey, $m)) {
        $idx = (int) $m[1];
        if ($idx < 1 || $idx > max($pm, 3)) {
            return null;
        }
        $cursor = $join->modify('+' . $td . ' days');
        for ($i = 1; $i < $idx; $i++) {
            $cursor = $cursor->modify('+' . $md . ' days');
        }
        $end = $cursor->modify('+' . $md . ' days');
        return [
            'phase_key' => 'month' . $idx,
            'label' => 'Month ' . $idx,
            'window_start' => $cursor->format('Y-m-d'),
            'window_end_exclusive' => $end->format('Y-m-d'),
            'target_rupees' => $gate,
        ];
    }
    return null;
}

/** Sum payment_links.amount_paid (paise→INR) for salesperson in [start, endExclusive). */
function fresherSumPaymentLinksInWindow(
    PDO $db,
    string $traineeUserId,
    ?string $orgId,
    ?string $windowStart,
    ?string $windowEndExclusive
): float {
    $traineeUserId = trim($traineeUserId);
    if ($traineeUserId === '' || $windowStart === null || $windowStart === '') {
        return 0.0;
    }
    $sql = "SELECT COALESCE(SUM(amount_paid), 0) FROM payment_links
            WHERE salesperson_id = ?
              AND amount_paid > 0
              AND status IN ('paid','partially_paid')
              AND created_at >= ?";
    $params = [$traineeUserId, $windowStart . ' 00:00:00'];
    if ($windowEndExclusive !== null && $windowEndExclusive !== '') {
        $sql .= ' AND created_at < ?';
        $params[] = $windowEndExclusive . ' 00:00:00';
    }
    if ($orgId !== null && trim($orgId) !== '') {
        $sql .= ' AND org_id = ?';
        $params[] = trim($orgId);
    }
    try {
        $st = $db->prepare($sql);
        $st->execute($params);
        $paise = (float) $st->fetchColumn();
        return round($paise / 100, 2);
    } catch (Throwable $e) {
        return 0.0;
    }
}

/**
 * Auto-move phase from join date + fill achieved from payment links.
 * Manual achieved overrides (admin) are kept when payload.manual_overrides[phase]=true.
 *
 * @return array updated payload
 */
function fresherAutoSyncMemberPayload(PDO $db, array $payload, array $policy, ?string $orgId): array {
    $policy = fresherNormalizePolicy($policy);
    $join = substr(trim((string) ($payload['joiningDate'] ?? '')), 0, 10);
    $tid = trim((string) ($payload['trainee_user_id'] ?? ''));
    if ($join === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $join)) {
        return $payload;
    }

    $overrides = is_array($payload['manual_overrides'] ?? null) ? $payload['manual_overrides'] : [];
    $cal = fresherComputePhaseFromJoinPolicy($join, $policy);
    if ($cal === null) {
        return $payload;
    }

    $trainWin = fresherPhaseWindowByKeyPolicy($join, 'training', $policy);
    $m1Win = fresherPhaseWindowByKeyPolicy($join, 'month1', $policy);
    $m2Win = fresherPhaseWindowByKeyPolicy($join, 'month2', $policy);
    $m3Win = fresherPhaseWindowByKeyPolicy($join, 'month3', $policy);

    $sum = function (?array $win) use ($db, $tid, $orgId): float {
        if (!$win || empty($win['window_start'])) {
            return 0.0;
        }
        if ($tid === '') {
            return 0.0;
        }
        return fresherSumPaymentLinksInWindow(
            $db,
            $tid,
            $orgId,
            (string) $win['window_start'],
            isset($win['window_end_exclusive']) ? (string) $win['window_end_exclusive'] : null
        );
    };

    $trainT = (int) $policy['training_target'];
    $gate = fresherMonthlyGateAmount($policy);
    $full = (int) $policy['monthly_full_target'];

    if (empty($overrides['training'])) {
        $payload['training']['achieved'] = $sum($trainWin);
    }
    $payload['training']['target'] = $trainT;
    $payload['training']['isPaid'] = false;
    $achT = (float) ($payload['training']['achieved'] ?? 0);
    $payload['training']['status'] = $achT <= 0 ? 'pending' : ($achT >= $trainT ? 'passed' : 'failed');

    if (empty($overrides['month1'])) {
        $payload['month1']['achieved'] = $sum($m1Win);
    }
    $payload['month1']['target'] = $full;
    $ach1 = (float) ($payload['month1']['achieved'] ?? 0);
    $payload['month1']['status'] = $ach1 <= 0 ? 'pending' : ($ach1 >= $gate ? 'fixed_eligible' : 'performance');

    if (empty($overrides['month2'])) {
        $payload['month2']['totalAchieved'] = $sum($m2Win);
    }
    $ach2 = (float) ($payload['month2']['totalAchieved'] ?? 0);
    if (!isset($payload['month2']['first10Days']) || !is_array($payload['month2']['first10Days'])) {
        $payload['month2']['first10Days'] = ['achieved' => 0, 'target' => $gate, 'status' => 'pending'];
    }
    if (!isset($payload['month2']['next15Days']) || !is_array($payload['month2']['next15Days'])) {
        $payload['month2']['next15Days'] = ['achieved' => 0, 'target' => $gate, 'status' => 'pending'];
    }
    $payload['month2']['status'] = $ach2 <= 0 ? 'pending' : ($ach2 >= $gate ? 'full_fixed' : 'target_based');

    if (empty($overrides['month3'])) {
        $payload['month3']['achieved'] = $sum($m3Win);
    }
    $payload['month3']['target'] = $full;
    $ach3 = (float) ($payload['month3']['achieved'] ?? 0);
    $payload['month3']['status'] = $ach3 <= 0 ? 'pending' : ($ach3 >= $gate ? 'confirmed' : 'performance');

    // Auto phase from calendar (map monthN > 3 to month3 storage key when needed).
    $phaseKey = (string) ($cal['phase_key'] ?? 'training');
    if ($phaseKey === 'pre_join') {
        $phaseKey = 'training';
    }
    if (preg_match('/^month(\d+)$/', $phaseKey, $mm)) {
        $n = (int) $mm[1];
        if ($n >= 3) {
            $phaseKey = $n > 3 ? 'completed' : 'month3';
            // If still in month 3 of a longer probation, keep month3.
            if ($n === 3) {
                $phaseKey = 'month3';
            } elseif ($n > 3 && $n <= (int) $policy['probation_months']) {
                // Store extra months' progress on month3 bucket for display; phase label from calendar.
                $phaseKey = 'month3';
            }
        }
    }
    if ($phaseKey === 'completed' || ($cal['phase_key'] ?? '') === 'completed') {
        $payload['currentPhase'] = 'completed';
    } elseif (in_array($phaseKey, ['training', 'month1', 'month2', 'month3'], true)) {
        $payload['currentPhase'] = $phaseKey;
    } else {
        $payload['currentPhase'] = 'training';
    }

    // Salary type for current month = outcome of previous phase only.
    // Hit gate → fixed next month; miss gate (even from fixed) → target_based next month.
    $salaryType = 'performance';
    $cur = (string) $payload['currentPhase'];
    if ($cur === 'training') {
        $salaryType = 'performance';
    } elseif ($cur === 'month1') {
        $salaryType = $payload['training']['status'] === 'passed' ? 'fixed' : 'target_based';
    } elseif ($cur === 'month2') {
        $salaryType = $payload['month1']['status'] === 'fixed_eligible' ? 'fixed' : 'target_based';
    } elseif ($cur === 'month3' || $cur === 'completed') {
        $salaryType = in_array((string) ($payload['month2']['status'] ?? ''), ['full_fixed', 'fixed_eligible_month3'], true)
            ? 'fixed'
            : 'target_based';
    }
    $payload['salaryType'] = $salaryType;

    $label = (string) ($cal['label'] ?? $cur);
    $tgt = (int) ($cal['target_rupees'] ?? 0);
    $achNow = 0.0;
    if ($cur === 'training') {
        $achNow = (float) ($payload['training']['achieved'] ?? 0);
    } elseif ($cur === 'month1') {
        $achNow = (float) ($payload['month1']['achieved'] ?? 0);
    } elseif ($cur === 'month2') {
        $achNow = (float) ($payload['month2']['totalAchieved'] ?? 0);
    } elseif ($cur === 'month3') {
        $achNow = (float) ($payload['month3']['achieved'] ?? 0);
    }
    $payload['headlineStatus'] = $label . ' · ' . ($salaryType === 'fixed' ? 'Fixed salary track' : 'Target-based')
        . ' · Achieved ₹' . number_format($achNow, 0, '.', ',')
        . ' / ₹' . number_format($tgt, 0, '.', ',')
        . ' (from payment links)';
    $payload['calendar_phase_key'] = (string) ($cal['phase_key'] ?? $cur);
    $payload['calendar_label'] = $label;
    $payload['policy_snapshot'] = [
        'training_target' => $trainT,
        'monthly_gate' => $gate,
        'monthly_full_target' => $full,
        'fixed_salary_monthly' => (int) $policy['fixed_salary_monthly'],
    ];

    return $payload;
}

/**
 * Best-effort in-app notification. Never throws (must not break the primary action).
 */
function syncpediaNotifyUser(
    PDO $db,
    string $userId,
    string $title,
    string $message,
    string $type = 'info',
    ?string $link = null,
    ?string $orgId = null,
): void {
    $userId = trim($userId);
    if ($userId === '') {
        return;
    }
    try {
        $nid = generateUUID();
        $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$nid, $userId, $title, $message, $type, $link, $orgId]);
    } catch (Throwable $e) {
        try {
            $nid = generateUUID();
            $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$nid, $userId, $title, $message, $type, $link]);
        } catch (Throwable $e2) {
        }
    }
}

function syncpediaUserDisplayName(PDO $db, string $userId): string {
    try {
        $st = $db->prepare('SELECT full_name FROM users WHERE id = ? LIMIT 1');
        $st->execute([trim($userId)]);
        return trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $e) {
        return '';
    }
}

/** Active org admins (admin / org) in a tenant. */
function syncpediaOrgAdminUserIds(PDO $db, ?string $orgId): array {
    $orgId = trim((string) $orgId);
    if ($orgId === '') {
        return [];
    }
    try {
        $st = $db->prepare("SELECT id FROM users WHERE org_id = ? AND is_active = 1 AND LOWER(TRIM(role)) IN ('admin', 'org')");
        $st->execute([$orgId]);
        $ids = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN, 0) as $id) {
            $id = trim((string) $id);
            if ($id !== '') {
                $ids[] = $id;
            }
        }
        return $ids;
    } catch (Throwable $e) {
        return [];
    }
}

function syncpediaManagerIdOfUser(PDO $db, string $userId): ?string {
    try {
        $st = $db->prepare('SELECT reports_to_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([trim($userId)]);
        $mid = trim((string) ($st->fetchColumn() ?: ''));
        return $mid !== '' ? $mid : null;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Org admins (and the member's manager) when a teammate is added or removed.
 * Skips the acting user.
 */
function syncpediaNotifyMemberLifecycle(
    PDO $db,
    string $actorUserId,
    string $memberName,
    string $memberRole,
    ?string $reportsToId,
    ?string $orgId,
    string $kind,
): void {
    $memberName = trim($memberName) !== '' ? trim($memberName) : 'A team member';
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $role = trim($memberRole) !== '' ? trim($memberRole) : 'member';
    if ($kind === 'removed') {
        $title = 'Team member removed';
        $message = $actorName . ' removed ' . $memberName . ' (' . $role . ') from the team.';
        $type = 'member_removed';
    } else {
        $title = 'Team member added';
        $message = $actorName . ' added ' . $memberName . ' (' . $role . ') to the team.';
        $type = 'member_added';
    }
    $ids = syncpediaOrgAdminUserIds($db, $orgId);
    $adminIds = $ids;
    $mgr = trim((string) $reportsToId);
    if ($mgr !== '') {
        $ids[] = $mgr;
    }
    $actorUserId = trim($actorUserId);
    $seen = [];
    foreach ($ids as $uid) {
        $uid = trim((string) $uid);
        if ($uid === '' || $uid === $actorUserId || isset($seen[$uid])) {
            continue;
        }
        $seen[$uid] = true;
        syncpediaNotifyUser($db, $uid, $title, $message, $type, '/team', $orgId);
    }

    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(function_exists('syncpediaMailLegalEntityName') ? syncpediaMailLegalEntityName() : 'Syncpedia');
    $crmUrl = $h((function_exists('syncpediaCrmAppBaseUrl') ? syncpediaCrmAppBaseUrl() : '') . '/team');
    $html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eceff1;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceff1;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">'
        . '<tr><td style="background:#0f2318;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;text-align:center;">'
        . $h($title)
        . '</td></tr>'
        . '<tr><td style="background:#ffffff;padding:28px;font-family:Arial,Helvetica,sans-serif;">'
        . '<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#334155;">' . $h($message) . '</p>'
        . '<p style="margin:22px 0 0 0;text-align:center;"><a href="' . $crmUrl . '" style="display:inline-block;padding:14px 26px;background:#0f2318;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.05em;">OPEN TEAM</a></p>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:12px;font-size:12px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;">' . $legal . '</td></tr>'
        . '</table></td></tr></table></body></html>';

    if (function_exists('syncpediaSetMailContext')) {
        syncpediaSetMailContext($orgId ? (string) $orgId : null, 'notifications');
    }
    $adminSeen = [];
    foreach ($adminIds as $adminId) {
        $adminId = trim((string) $adminId);
        if ($adminId === '' || $adminId === $actorUserId || isset($adminSeen[$adminId])) {
            continue;
        }
        $adminSeen[$adminId] = true;
        $to = '';
        try {
            $st = $db->prepare('SELECT email FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
            $st->execute([$adminId]);
            $to = strtolower(trim((string) ($st->fetchColumn() ?: '')));
        } catch (Throwable $e) {
            continue;
        }
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        try {
            syncpediaSendHtmlEmail($to, $title, $html, 'notifications');
        } catch (Throwable $e) {
        }
    }
}

/**
 * One notification per person for bulk lead assign (not per lead).
 * Recipients: each assignee (L1) and that assignee's manager.
 */
function syncpediaNotifyBulkLeadAssign(
    PDO $db,
    array $assigneeIds,
    string $actorUserId,
    int $leadCount,
    ?string $orgId,
    string $link = '/leads',
): void {
    if ($leadCount < 1) {
        return;
    }
    $actorUserId = trim($actorUserId);
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $countLabel = $leadCount === 1 ? '1 lead' : ($leadCount . ' leads');
    $seen = [];
    $notify = static function (string $uid, string $title, string $message) use ($db, $actorUserId, &$seen, $orgId, $link): void {
        $uid = trim($uid);
        if ($uid === '' || $uid === $actorUserId || isset($seen[$uid])) {
            return;
        }
        $seen[$uid] = true;
        syncpediaNotifyUser($db, $uid, $title, $message, 'lead_assigned', $link, $orgId);
    };
    foreach ($assigneeIds as $aid) {
        $aid = trim((string) $aid);
        if ($aid === '') {
            continue;
        }
        $aname = syncpediaUserDisplayName($db, $aid);
        $notify($aid, $leadCount . ' leads assigned', $actorName . ' assigned you ' . $countLabel . '.');
        $mgr = syncpediaManagerIdOfUser($db, $aid);
        if ($mgr) {
            $who = $aname !== '' ? $aname : 'A team member';
            $notify($mgr, 'Team bulk assignment', $who . ' was assigned ' . $countLabel . ' by ' . $actorName . '.');
        }
    }
    syncpediaNotifyOrgAdminsOfBulkKind($db, $actorUserId, $orgId, 'lead_assign', $leadCount);
}

/**
 * Notify org admins (except the actor) about a bulk org action.
 * Known kinds: offer_letters, certificates, payslips, lead_assign, leads_import,
 * leads_delete, marketing_email, whatsapp.
 */
function syncpediaNotifyOrgAdminsOfBulkKind(
    PDO $db,
    string $actorUserId,
    ?string $orgId,
    string $kind,
    int $count,
    string $detail = '',
): void {
    if ($count < 1) {
        return;
    }
    $kind = trim($kind);
    $catalog = [
        'offer_letters' => ['title' => 'Bulk offer letters', 'link' => '/offer-letters', 'label' => 'offer letter(s)'],
        'certificates' => ['title' => 'Bulk certificates issued', 'link' => '/certificates', 'label' => 'certificate(s)'],
        'payslips' => ['title' => 'Bulk payslips generated', 'link' => '/payslip', 'label' => 'payslip(s)'],
        'lead_assign' => ['title' => 'Bulk lead assignment', 'link' => '/leads', 'label' => 'lead(s) assigned'],
        'leads_import' => ['title' => 'Bulk leads imported', 'link' => '/leads', 'label' => 'lead(s) imported'],
        'leads_delete' => ['title' => 'Bulk leads deleted', 'link' => '/leads', 'label' => 'lead(s) deleted'],
        'marketing_email' => ['title' => 'Bulk email campaign', 'link' => '/marketing-email', 'label' => 'email(s) sent'],
        'whatsapp' => ['title' => 'Bulk WhatsApp campaign', 'link' => '/marketing-whatsapp', 'label' => 'message(s) sent'],
    ];
    if (!isset($catalog[$kind])) {
        return;
    }
    $actorUserId = trim($actorUserId);
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $meta = $catalog[$kind];
    $message = $actorName . ' completed a bulk action: ' . $count . ' ' . $meta['label'] . '.';
    $detail = trim($detail);
    if ($detail !== '') {
        $message .= ' ' . $detail;
    }
    $seen = [];
    foreach (syncpediaOrgAdminUserIds($db, $orgId) as $adminId) {
        $adminId = trim((string) $adminId);
        if ($adminId === '' || $adminId === $actorUserId || isset($seen[$adminId])) {
            continue;
        }
        $seen[$adminId] = true;
        syncpediaNotifyUser($db, $adminId, $meta['title'], $message, 'bulk_action', $meta['link'], $orgId);
    }
}

/**
 * Notify org admins (and the trainee + their manager) when someone is added
 * to the fresher salary training tracker.
 */
function syncpediaNotifyFresherTrainingAdded(
    PDO $db,
    string $actorUserId,
    string $memberName,
    ?string $traineeUserId,
    ?string $orgId,
): void {
    $actorUserId = trim($actorUserId);
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $memberName = trim($memberName) !== '' ? trim($memberName) : 'A team member';
    $link = '/fresher-salary-tracker';
    $type = 'fresher_enrolled';
    $seen = [];
    $notify = static function (string $uid, string $title, string $message) use ($db, $actorUserId, &$seen, $orgId, $link, $type): void {
        $uid = trim($uid);
        if ($uid === '' || $uid === $actorUserId || isset($seen[$uid])) {
            return;
        }
        $seen[$uid] = true;
        syncpediaNotifyUser($db, $uid, $title, $message, $type, $link, $orgId);
    };
    $adminMsg = $actorName . ' added ' . $memberName . ' to fresher salary training.';
    foreach (syncpediaOrgAdminUserIds($db, $orgId) as $adminId) {
        $notify((string) $adminId, 'Fresher salary training', $adminMsg);
    }
    $tid = trim((string) $traineeUserId);
    if ($tid !== '') {
        $notify($tid, 'Added to fresher salary training', $actorName . ' enrolled you in the fresher salary training track.');
        $mgr = syncpediaManagerIdOfUser($db, $tid);
        if ($mgr) {
            $notify($mgr, 'Team fresher training', $memberName . ' was added to fresher salary training by ' . $actorName . '.');
        }
    }
}

function syncpediaOrgActiveUserIdsByRoles(PDO $db, ?string $orgId, array $roles): array {
    $orgId = trim((string) $orgId);
    if ($orgId === '' || $roles === []) {
        return [];
    }
    $clean = [];
    foreach ($roles as $r) {
        $r = strtolower(trim((string) $r));
        if ($r !== '') {
            $clean[$r] = $r;
        }
    }
    $clean = array_values($clean);
    if ($clean === []) {
        return [];
    }
    try {
        $in = implode(',', array_fill(0, count($clean), '?'));
        $st = $db->prepare("SELECT id FROM users WHERE org_id = ? AND is_active = 1 AND LOWER(TRIM(role)) IN ($in)");
        $st->execute(array_merge([$orgId], $clean));
        $ids = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN, 0) as $id) {
            $id = trim((string) $id);
            if ($id !== '') {
                $ids[] = $id;
            }
        }
        return $ids;
    } catch (Throwable $e) {
        return [];
    }
}

function syncpediaNotificationExists(PDO $db, string $userId, string $type, string $link, bool $todayOnly = false): bool {
    $userId = trim($userId);
    if ($userId === '') {
        return false;
    }
    try {
        $sql = 'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND link = ?';
        $params = [$userId, $type, $link];
        if ($todayOnly) {
            $sql .= ' AND created_at >= CURDATE()';
        }
        $sql .= ' LIMIT 1';
        $st = $db->prepare($sql);
        $st->execute($params);
        return (bool) $st->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function syncpediaNotifyUserOnce(
    PDO $db,
    string $userId,
    string $title,
    string $message,
    string $type,
    string $link,
    ?string $orgId,
    bool $todayOnly = false,
    string $skipActor = '',
): void {
    $userId = trim($userId);
    if ($userId === '' || ($skipActor !== '' && $userId === trim($skipActor))) {
        return;
    }
    if (syncpediaNotificationExists($db, $userId, $type, $link, $todayOnly)) {
        return;
    }
    syncpediaNotifyUser($db, $userId, $title, $message, $type, $link, $orgId);
}

function syncpediaNotifyIdList(
    PDO $db,
    array $userIds,
    string $actorUserId,
    string $title,
    string $message,
    string $type,
    string $link,
    ?string $orgId,
    bool $skipActor = true,
): void {
    $actorUserId = trim($actorUserId);
    $seen = [];
    foreach ($userIds as $uid) {
        $uid = trim((string) $uid);
        if ($uid === '' || isset($seen[$uid])) {
            continue;
        }
        if ($skipActor && $uid === $actorUserId) {
            continue;
        }
        $seen[$uid] = true;
        syncpediaNotifyUser($db, $uid, $title, $message, $type, $link, $orgId);
    }
}

function syncpediaNotifyRoleChanged(
    PDO $db,
    string $actorUserId,
    string $memberId,
    string $memberName,
    string $prevRole,
    string $newRole,
    ?string $orgId,
): void {
    if ($prevRole === $newRole) {
        return;
    }
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $memberName = trim($memberName) !== '' ? trim($memberName) : 'A team member';
    $msg = $actorName . ' changed ' . $memberName . "'s role from " . $prevRole . ' to ' . $newRole . '.';
    $ids = syncpediaOrgAdminUserIds($db, $orgId);
    $ids[] = $memberId;
    $mgr = syncpediaManagerIdOfUser($db, $memberId);
    if ($mgr) {
        $ids[] = $mgr;
    }
    syncpediaNotifyIdList($db, $ids, $actorUserId, 'Role updated', $msg, 'role_changed', '/team', $orgId);
}

function syncpediaNotifyTaskCompleted(
    PDO $db,
    string $actorUserId,
    array $task,
): void {
    $title = trim((string) ($task['title'] ?? 'Untitled'));
    $orgId = isset($task['org_id']) ? (string) $task['org_id'] : null;
    $assignee = trim((string) ($task['assigned_to'] ?? ''));
    $creator = trim((string) ($task['created_by'] ?? ''));
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $msg = $actorName . ' completed the task: ' . ($title !== '' ? $title : 'Untitled');
    $ids = [];
    if ($creator !== '') {
        $ids[] = $creator;
    }
    if ($assignee !== '') {
        $mgr = syncpediaManagerIdOfUser($db, $assignee);
        if ($mgr) {
            $ids[] = $mgr;
        }
    }
    syncpediaNotifyIdList($db, $ids, $actorUserId, 'Task completed', $msg, 'task_completed', '/tasks', $orgId);
}

function syncpediaNotifyFresherPhaseMoved(
    PDO $db,
    string $memberName,
    ?string $traineeUserId,
    string $fromPhase,
    string $toPhase,
    ?string $orgId,
): void {
    $tid = trim((string) $traineeUserId);
    if ($tid === '' || $fromPhase === $toPhase) {
        return;
    }
    $memberName = trim($memberName) !== '' ? trim($memberName) : 'You';
    $link = '/fresher-salary-tracker#phase-' . $tid . '-' . $toPhase;
    $msg = $memberName . ' moved from ' . $fromPhase . ' to ' . $toPhase . ' on the fresher salary track.';
    syncpediaNotifyUserOnce($db, $tid, 'Training phase updated', 'You moved to ' . $toPhase . ' on the fresher salary track.', 'fresher_phase', $link, $orgId, false, '');
    $mgr = syncpediaManagerIdOfUser($db, $tid);
    if ($mgr) {
        syncpediaNotifyUserOnce($db, $mgr, 'Team training phase', $msg, 'fresher_phase', $link, $orgId, false, '');
    }
}

function syncpediaNotifyFresherPolicyChanged(
    PDO $db,
    string $actorUserId,
    ?string $orgId,
): void {
    $orgId = trim((string) $orgId);
    if ($orgId === '') {
        return;
    }
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $msg = $actorName . ' updated fresher salary training policy / targets.';
    $ids = [];
    try {
        $st = $db->prepare("SELECT payload FROM fresher_salary_members WHERE org_id = ?");
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN, 0) as $raw) {
            $p = json_decode((string) $raw, true);
            $tid = is_array($p) ? trim((string) ($p['trainee_user_id'] ?? '')) : '';
            if ($tid === '') {
                continue;
            }
            $ids[] = $tid;
            $mgr = syncpediaManagerIdOfUser($db, $tid);
            if ($mgr) {
                $ids[] = $mgr;
            }
        }
    } catch (Throwable $e) {
        return;
    }
    syncpediaNotifyIdList($db, $ids, $actorUserId, 'Fresher policy updated', $msg, 'fresher_policy', '/fresher-salary-tracker', $orgId);
}

function syncpediaNotifyHolidayChange(
    PDO $db,
    string $actorUserId,
    ?string $orgId,
    string $holidayName,
    string $kind,
): void {
    $roles = array_merge(['admin', 'org', 'manager'], syncpediaL1AssignableRoles());
    $ids = syncpediaOrgActiveUserIdsByRoles($db, $orgId, $roles);
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $name = trim($holidayName) !== '' ? trim($holidayName) : 'a holiday';
    $title = $kind === 'removed' ? 'Holiday removed' : 'Holiday added';
    $message = $actorName . ' ' . ($kind === 'removed' ? 'removed' : 'added') . ' holiday: ' . $name . '.';
    syncpediaNotifyIdList($db, $ids, $actorUserId, $title, $message, 'holiday', '/holidays', $orgId);
}

function syncpediaNotifyMarketingTemplateChange(
    PDO $db,
    string $actorUserId,
    ?string $orgId,
    string $templateName,
    string $channel,
    string $verb,
): void {
    $name = trim($templateName) !== '' ? trim($templateName) : 'a template';
    $title = $verb === 'deleted' ? 'Marketing template deleted' : 'Marketing template created';
    $message = syncpediaUserDisplayName($db, $actorUserId);
    if ($message === '') {
        $message = 'A teammate';
    }
    $message .= ' ' . $verb . ' ' . $channel . ' template: ' . $name . '.';
    $link = $channel === 'whatsapp' ? '/marketing-whatsapp' : '/marketing-email';
    syncpediaNotifyIdList(
        $db,
        syncpediaOrgAdminUserIds($db, $orgId),
        $actorUserId,
        $title,
        $message,
        'marketing_template',
        $link,
        $orgId,
    );
}

function syncpediaNotifyOrgAdminsOps(
    PDO $db,
    ?string $orgId,
    string $title,
    string $message,
    string $link,
    string $dedupeLink,
    string $actorUserId = '',
): void {
    $actorUserId = trim($actorUserId);
    foreach (syncpediaOrgAdminUserIds($db, $orgId) as $adminId) {
        $adminId = trim((string) $adminId);
        if ($adminId === '' || ($actorUserId !== '' && $adminId === $actorUserId)) {
            continue;
        }
        syncpediaNotifyUserOnce($db, $adminId, $title, $message, 'ops', $dedupeLink, $orgId, true, $actorUserId);
    }
}

function syncpediaDispatchDueReminders(PDO $db, array $tokenData): void {
    $orgId = resolveWriteOrgId($db, $tokenData);
    $orgId = $orgId ? trim((string) $orgId) : '';
    if ($orgId === '') {
        return;
    }
    $today = (new DateTimeImmutable('now'))->format('Y-m-d');
    $tomorrow = (new DateTimeImmutable('now'))->modify('+1 day')->format('Y-m-d');
    $nowTs = time();

    try {
        $st = $db->prepare("SELECT id, title, assigned_to, due_date, org_id FROM tasks WHERE org_id = ? AND (status IS NULL OR LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled')) AND assigned_to IS NOT NULL AND assigned_to <> '' AND due_date IS NOT NULL");
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $task) {
            $dueRaw = trim((string) ($task['due_date'] ?? ''));
            if ($dueRaw === '') {
                continue;
            }
            $dueTs = strtotime($dueRaw);
            if ($dueTs === false) {
                continue;
            }
            $dueDay = date('Y-m-d', $dueTs);
            $assignee = trim((string) ($task['assigned_to'] ?? ''));
            $taskTitle = trim((string) ($task['title'] ?? 'Untitled'));
            $tid = (string) ($task['id'] ?? '');
            if ($assignee === '' || $tid === '') {
                continue;
            }
            if ($dueDay === $tomorrow) {
                syncpediaNotifyUserOnce(
                    $db,
                    $assignee,
                    'Task due tomorrow',
                    '“' . $taskTitle . '” is due tomorrow.',
                    'task_due',
                    '/tasks#due-tomorrow-' . $tid,
                    $orgId,
                    true,
                    '',
                );
            }
            if ($dueTs > $nowTs && ($dueTs - $nowTs) <= 3600) {
                syncpediaNotifyUserOnce(
                    $db,
                    $assignee,
                    'Task due in 1 hour',
                    '“' . $taskTitle . '” is due within the next hour.',
                    'task_due',
                    '/tasks#due-1h-' . $tid . '-' . $today,
                    $orgId,
                    true,
                    '',
                );
            }
        }
    } catch (Throwable $e) {
    }

    try {
        $st = $db->prepare('SELECT id, recipient_name, sent_by FROM offer_letters_sent WHERE org_id = ? AND DATE(sent_at) = DATE_SUB(CURDATE(), INTERVAL 2 DAY)');
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $sender = trim((string) ($row['sent_by'] ?? ''));
            $oid = (string) ($row['id'] ?? '');
            if ($sender === '' || $oid === '') {
                continue;
            }
            $who = trim((string) ($row['recipient_name'] ?? 'a candidate'));
            $link = '/offer-letters#followup-' . $oid;
            $msg = 'Follow up on offer letter sent to ' . $who . ' (2 days ago).';
            syncpediaNotifyUserOnce($db, $sender, 'Offer letter follow-up', $msg, 'follow_up', $link, $orgId, false, '');
            $mgr = syncpediaManagerIdOfUser($db, $sender);
            if ($mgr) {
                $sname = syncpediaUserDisplayName($db, $sender);
                syncpediaNotifyUserOnce($db, $mgr, 'Offer letter follow-up', ($sname !== '' ? $sname : 'A team member') . ': ' . $msg, 'follow_up', $link, $orgId, false, '');
            }
        }
    } catch (Throwable $e) {
    }

    try {
        $st = $db->prepare('SELECT id, recipient_name, issued_by FROM issued_certificates WHERE org_id = ? AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 2 DAY)');
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $issuer = trim((string) ($row['issued_by'] ?? ''));
            $cid = (string) ($row['id'] ?? '');
            if ($issuer === '' || $cid === '') {
                continue;
            }
            $who = trim((string) ($row['recipient_name'] ?? 'a recipient'));
            $link = '/certificates#followup-' . $cid;
            $msg = 'Follow up on certificate issued to ' . $who . ' (2 days ago).';
            syncpediaNotifyUserOnce($db, $issuer, 'Certificate follow-up', $msg, 'follow_up', $link, $orgId, false, '');
            $mgr = syncpediaManagerIdOfUser($db, $issuer);
            if ($mgr) {
                $sname = syncpediaUserDisplayName($db, $issuer);
                syncpediaNotifyUserOnce($db, $mgr, 'Certificate follow-up', ($sname !== '' ? $sname : 'A team member') . ': ' . $msg, 'follow_up', $link, $orgId, false, '');
            }
        }
    } catch (Throwable $e) {
    }

    try {
        $st = $db->prepare('SELECT payload FROM fresher_salary_members WHERE org_id = ?');
        $st->execute([$orgId]);
        $policy = function_exists('fresherLoadOrgPolicy') ? fresherLoadOrgPolicy($db, $orgId) : [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN, 0) as $raw) {
            $p = json_decode((string) $raw, true);
            if (!is_array($p)) {
                continue;
            }
            $tid = trim((string) ($p['trainee_user_id'] ?? ''));
            $join = substr(trim((string) ($p['joiningDate'] ?? '')), 0, 10);
            if ($tid === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $join)) {
                continue;
            }
            if ($join === $tomorrow) {
                syncpediaNotifyUserOnce($db, $tid, 'Training starts tomorrow', 'Your fresher salary training joining date is tomorrow.', 'fresher_gate', '/fresher-salary-tracker#join-tomorrow-' . $tid, $orgId, true, '');
            }
            if ($join === $today) {
                syncpediaNotifyUserOnce($db, $tid, 'Training starts today', 'Your fresher salary training joining date is today.', 'fresher_gate', '/fresher-salary-tracker#join-today-' . $tid, $orgId, true, '');
            }
            if (is_array($policy) && $policy !== [] && function_exists('fresherComputePhaseFromJoinPolicy')) {
                $cal = fresherComputePhaseFromJoinPolicy($join, $policy);
                $start = is_array($cal) ? (string) ($cal['window_start'] ?? '') : '';
                $phase = is_array($cal) ? (string) ($cal['phase_key'] ?? '') : '';
                if ($start === $today && in_array($phase, ['training', 'month1', 'month2', 'month3'], true)) {
                    $label = (string) ($cal['label'] ?? $phase);
                    syncpediaNotifyUserOnce($db, $tid, 'Training month gate', 'Your fresher track window starts today: ' . $label . '.', 'fresher_gate', '/fresher-salary-tracker#gate-' . $tid . '-' . $phase, $orgId, true, '');
                }
            }
        }
    } catch (Throwable $e) {
    }

    try {
        $st = $db->prepare("SELECT connection_status FROM org_whatsapp_config WHERE org_id = ? LIMIT 1");
        $st->execute([$orgId]);
        $status = strtolower(trim((string) ($st->fetchColumn() ?: '')));
        if (in_array($status, ['disconnected', 'error', 'expired', 'failed'], true)) {
            syncpediaNotifyOrgAdminsOps(
                $db,
                $orgId,
                'WhatsApp disconnected',
                'WhatsApp / Meta connection is ' . $status . '. Reconnect in Communications setup.',
                '/communications',
                '/communications#wa-down-' . $today,
                (string) ($tokenData['user_id'] ?? ''),
            );
        }
    } catch (Throwable $e) {
    }
}

/** Notify assignee (and their manager) when a task is created or reassigned. */
function syncpediaNotifyTaskAssignee(
    PDO $db,
    string $assigneeId,
    string $actorUserId,
    string $taskTitle,
    ?string $orgId = null,
): void {
    $assigneeId = trim($assigneeId);
    $actorUserId = trim($actorUserId);
    if ($assigneeId === '') {
        return;
    }
    $actorName = syncpediaUserDisplayName($db, $actorUserId);
    if ($actorName === '') {
        $actorName = 'A teammate';
    }
    $taskLabel = trim($taskTitle) !== '' ? trim($taskTitle) : 'Untitled';
    $seen = [];
    $notify = static function (string $uid, string $title, string $message) use ($db, $actorUserId, &$seen, $orgId): void {
        $uid = trim($uid);
        if ($uid === '' || $uid === $actorUserId || isset($seen[$uid])) {
            return;
        }
        $seen[$uid] = true;
        syncpediaNotifyUser($db, $uid, $title, $message, 'task_assigned', '/tasks', $orgId);
    };
    $notify($assigneeId, 'New task assigned', $actorName . ' assigned you a task: ' . $taskLabel);
    $mgr = syncpediaManagerIdOfUser($db, $assigneeId);
    if ($mgr) {
        $assigneeName = syncpediaUserDisplayName($db, $assigneeId);
        $who = $assigneeName !== '' ? $assigneeName : 'A team member';
        $notify($mgr, 'Task assigned to your team', $actorName . ' assigned "' . $taskLabel . '" to ' . $who . '.');
    }
}

/** In-app notification for payment link events (webhook). */
function paymentLinkNotifySalesperson(PDO $db, string $salespersonId, string $title, string $message, ?string $orgId = null): void {
    syncpediaNotifyUser($db, $salespersonId, $title, $message, 'payment_link', '/payments', $orgId);
}

/**
 * Manager access grants for form / assessment source cards.
 */
function syncpediaLeadSourceCardManagersEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS lead_source_card_managers (
                id CHAR(36) NOT NULL PRIMARY KEY,
                org_id CHAR(36) NOT NULL,
                source_key VARCHAR(255) NOT NULL,
                manager_user_id CHAR(36) NOT NULL,
                granted_by CHAR(36) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_lscm_org_source_mgr (org_id, source_key, manager_user_id),
                KEY idx_lscm_manager (org_id, manager_user_id),
                KEY idx_lscm_source (org_id, source_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (Throwable $e) {
        error_log('[lead_source_card_managers] schema: ' . $e->getMessage());
    }
    $done = true;
}

/** @return string[] */
function syncpediaParseLeadTags($tags): array
{
    if (is_array($tags)) {
        $out = [];
        foreach ($tags as $t) {
            $t = trim((string) $t);
            if ($t !== '') {
                $out[] = $t;
            }
        }
        return $out;
    }
    $raw = trim((string) $tags);
    if ($raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $out = [];
        foreach ($decoded as $t) {
            $t = trim((string) $t);
            if ($t !== '') {
                $out[] = $t;
            }
        }
        return $out;
    }
    // Comma / whitespace separated fallback
    $parts = preg_split('/[,;\s]+/', $raw) ?: [];
    $out = [];
    foreach ($parts as $t) {
        $t = trim((string) $t);
        if ($t !== '') {
            $out[] = $t;
        }
    }
    return $out;
}

function syncpediaIsPeaklyyLeadRow(array $row): bool
{
    $source = strtolower(trim((string) ($row['source'] ?? '')));
    if ($source === 'peaklyy' || str_starts_with($source, 'peaklyy:')) {
        return true;
    }
    foreach (syncpediaParseLeadTags($row['tags'] ?? null) as $t) {
        $tl = strtolower(trim((string) $t));
        if ($tl === 'peaklyy' || str_starts_with($tl, 'peaklyy_id:')) {
            return true;
        }
    }
    return false;
}

function syncpediaIsManuallyAddedLeadRow(array $row): bool
{
    if (syncpediaIsPeaklyyLeadRow($row)) {
        return false;
    }
    foreach (syncpediaParseLeadTags($row['tags'] ?? null) as $t) {
        $v = strtolower(trim((string) $t));
        if ($v === 'entry:manual' || $v === 'added_lead') {
            return true;
        }
        if (str_starts_with($v, 'import_set:')) {
            return false;
        }
    }
    $source = strtolower(trim((string) ($row['source'] ?? '')));
    return in_array($source, ['manual', 'added', 'added_leads'], true);
}

function syncpediaIsFormLeadRow(array $row): bool
{
    if (syncpediaIsManuallyAddedLeadRow($row)) {
        return false;
    }
    if (trim((string) ($row['referred_by'] ?? '')) !== '') {
        return true;
    }
    $source = strtolower(trim((string) ($row['source'] ?? '')));
    if ($source === 'google_forms' || $source === 'normal_form') {
        return true;
    }
    return str_starts_with($source, 'form_');
}

function syncpediaIsMetaAdLeadRow(array $row): bool
{
    $source = strtolower(trim((string) ($row['source'] ?? '')));
    if ($source === 'meta_ads' || $source === 'facebook' || $source === 'instagram' || str_starts_with($source, 'meta_ad:')) {
        return true;
    }
    foreach (syncpediaParseLeadTags($row['tags'] ?? null) as $t) {
        $tl = trim((string) $t);
        if (
            str_starts_with($tl, 'meta_ad:')
            || str_starts_with($tl, 'meta_ad_name:')
            || str_starts_with($tl, 'meta_lead_id:')
            || str_starts_with($tl, 'meta_ad_id:')
        ) {
            return true;
        }
    }
    return false;
}

function syncpediaMetaAdSourceKey(array $row): string
{
    $source = trim((string) ($row['source'] ?? ''));
    if (stripos($source, 'meta_ad:') === 0) {
        return $source;
    }
    foreach (syncpediaParseLeadTags($row['tags'] ?? null) as $t) {
        $tl = trim((string) $t);
        if (str_starts_with($tl, 'meta_ad:')) {
            return $tl;
        }
        if (str_starts_with($tl, 'meta_ad_id:')) {
            return 'meta_ad:' . substr($tl, strlen('meta_ad_id:'));
        }
    }
    return 'meta_ads';
}

/**
 * Source-card key for leads that managers only see after "Access to manager" grant
 * (forms, Peaklyy assessments, Meta/promotion ads).
 */
function syncpediaLeadFormOrAssessmentSourceKey(array $row): ?string
{
    if (syncpediaIsPeaklyyLeadRow($row)) {
        $source = trim((string) ($row['source'] ?? ''));
        if (stripos($source, 'peaklyy:') === 0) {
            return $source;
        }
        foreach (syncpediaParseLeadTags($row['tags'] ?? null) as $t) {
            if (stripos($t, 'peaklyy_id:') === 0) {
                return 'peaklyy:' . substr($t, strlen('peaklyy_id:'));
            }
        }
        return 'peaklyy';
    }
    if (syncpediaIsMetaAdLeadRow($row)) {
        return syncpediaMetaAdSourceKey($row);
    }
    if (!syncpediaIsFormLeadRow($row)) {
        return null;
    }
    $source = trim((string) ($row['source'] ?? ''));
    $lower = strtolower($source);
    if (str_starts_with($lower, 'form_') && strlen($lower) > 5) {
        return 'form_' . substr($source, 5);
    }
    if ($lower === 'google_forms') {
        return 'form_google_forms';
    }
    if ($lower === 'normal_form') {
        return 'form_normal';
    }
    return 'form_other';
}

/**
 * Managers: hide form / assessment / Meta promotion leads unless granted card access,
 * assigned, or self-created.
 *
 * @param array<int,mixed> $rows
 * @return array<int,array>
 */
function syncpediaFilterLeadsForManagerCardAccess(PDO $db, array $tokenData, array $rows): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role !== 'manager') {
        $out = [];
        foreach ($rows as $row) {
            if (is_array($row)) {
                $out[] = $row;
            }
        }
        return $out;
    }

    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = getOrgId($tokenData);
    if ($orgId === null || trim((string) $orgId) === '') {
        $orgId = resolveCreatorOrgId($db, $tokenData);
    }
    $orgId = $orgId !== null ? trim((string) $orgId) : '';

    $granted = [];
    if ($orgId !== '' && $userId !== '') {
        syncpediaLeadSourceCardManagersEnsureSchema($db);
        try {
            $st = $db->prepare(
                'SELECT source_key FROM lead_source_card_managers WHERE org_id = ? AND manager_user_id = ?'
            );
            $st->execute([$orgId, $userId]);
            while ($key = $st->fetchColumn()) {
                $key = trim((string) $key);
                if ($key !== '') {
                    $granted[$key] = true;
                }
            }
        } catch (Throwable $e) {
        }
    }

    // Multi-assignee: any lead_id where this manager is in lead_assignments
    $assignedExtra = [];
    $leadIds = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $lid = trim((string) ($row['id'] ?? ''));
        if ($lid !== '') {
            $leadIds[$lid] = true;
        }
    }
    if ($userId !== '' && $leadIds !== []) {
        try {
            foreach (array_chunk(array_keys($leadIds), 400) as $chunk) {
                $ph = implode(',', array_fill(0, count($chunk), '?'));
                $st = $db->prepare(
                    "SELECT lead_id FROM lead_assignments WHERE user_id = ? AND lead_id IN ($ph)"
                );
                $st->execute(array_merge([$userId], $chunk));
                while ($lid = $st->fetchColumn()) {
                    $lid = trim((string) $lid);
                    if ($lid !== '') {
                        $assignedExtra[$lid] = true;
                    }
                }
            }
        } catch (Throwable $e) {
        }
    }

    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $sourceKey = syncpediaLeadFormOrAssessmentSourceKey($row);
        if ($sourceKey === null) {
            // Non-gated cards: keep (imports, added, website, etc.)
            $out[] = $row;
            continue;
        }
        if (isset($granted[$sourceKey])) {
            $out[] = $row;
            continue;
        }
        // Also accept parent meta_ads grant for per-ad cards (meta_ad:{id}).
        if (str_starts_with($sourceKey, 'meta_ad:') && isset($granted['meta_ads'])) {
            $out[] = $row;
            continue;
        }
        $lid = trim((string) ($row['id'] ?? ''));
        $assignedTo = trim((string) ($row['assigned_to'] ?? ''));
        $createdBy = trim((string) ($row['created_by'] ?? ''));
        if ($userId !== '' && ($assignedTo === $userId || $createdBy === $userId || ($lid !== '' && isset($assignedExtra[$lid])))) {
            $out[] = $row;
            continue;
        }
        // Hide gated form / assessment / Meta promotion lead
    }
    return $out;
}

register_shutdown_function(static function () {
    if (defined('SYNCPIEDIA_API_DONE')) {
        return;
    }
    $err = error_get_last();
    if ($err === null) {
        return;
    }
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!in_array((int) $err['type'], $fatalTypes, true)) {
        return;
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(500);
    }
    $detail = (string) ($err['message'] ?? 'Error');
    if (strlen($detail) > 300) {
        $detail = substr($detail, 0, 300) . '…';
    }
    $file = isset($err['file']) ? (string) $err['file'] : '';
    $line = isset($err['line']) ? (int) $err['line'] : 0;
    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }
    $payload = ['error' => 'Internal server error'];
    if (defined('APP_DEBUG') && APP_DEBUG === true) {
        $payload['detail'] = $detail;
        if ($file !== '') {
            $payload['file'] = $file;
        }
        if ($line > 0) {
            $payload['line'] = $line;
        }
    }
    $json = json_encode($payload, $flags);
    echo $json !== false ? $json : '{"error":"Internal server error"}';
});

