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
                respond(['error' => 'Database connection failed'], 500);
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
    header('Access-Control-Allow-Origin: ' . syncpediaCorsOrigin());
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");
    header("Content-Type: application/json; charset=UTF-8");

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        respond(['ok' => true]);
    }
}

function getInput() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function generateUUID() {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

// Simple JWT implementation
function createToken($userId, $role, $orgId = null) {
    $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = base64_encode(json_encode([
        'user_id' => $userId,
        'role' => $role,
        'org_id' => $orgId,
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

    if (!preg_match('/Bearer\s+(.+)/', $authHeader, $matches)) {
        respond(['error' => 'No token provided'], 401);
    }

    $parts = explode('.', $matches[1]);
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

    // Reject deactivated accounts even if JWT is still within expiry.
    $uid = trim((string) ($data['user_id'] ?? ''));
    if ($uid !== '') {
        try {
            $db = (new Database())->getConnection();
            $st = $db->prepare('SELECT is_active, role, org_id FROM users WHERE id = ? LIMIT 1');
            $st->execute([$uid]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row || !(int) ($row['is_active'] ?? 0)) {
                respond(['error' => 'Account is deactivated'], 401);
            }
            // Prefer live role/org from DB over stale JWT claims.
            if (isset($row['role']) && trim((string) $row['role']) !== '') {
                $data['role'] = (string) $row['role'];
            }
            if (array_key_exists('org_id', $row)) {
                $data['org_id'] = $row['org_id'];
            }
        } catch (Throwable $e) {
            // If users table unavailable, keep JWT payload (bootstrap/migration edge).
        }
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
    return [
        'where' => "({$batchAlias}.org_id = ? OR {$courseAlias}.org_id = ?)",
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
    if ($role === 'super_admin' && !getOrgId($tokenData)) {
        return ['where' => '1=1', 'params' => []];
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    if (!$orgId) {
        $col = $alias !== '' ? "{$alias}." : '';
        return ['where' => "({$col}org_id IS NULL)", 'params' => []];
    }
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
    if ($r === 'organisation') {
        return 'org';
    }
    if ($r === 'sales_executive') {
        return 'sales_representative';
    }
    if (in_array($r, ['team_lead', 'sales_manager'], true)) {
        return 'manager';
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

/** Higher number = more authority: L4 super_admin, L3 admin/org, L2 manager, L1 field roles. */
function syncpediaRoleLevel(string $role): int
{
    $r = syncpediaNormalizeRoleKey($role);
    $levels = [
        'super_admin' => 4,
        'admin' => 3,
        'org' => 3,
        'manager' => 2,
        'sales_representative' => 1,
        'hr' => 1,
        'marketing' => 1,
        'trainer' => 1,
        'finance' => 1,
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
    return [
        'sql' => " AND ({$col}assigned_to = ? OR {$col}referred_by = (SELECT referral_code FROM users WHERE id = ?) OR {$col}created_by = ?)",
        'params' => [$userId, $userId, $userId],
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
    $k = strtolower(trim($roleKey));
    $map = [
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'manager' => 'Manager',
        'sales_representative' => 'Sales Rep',
        'marketing' => 'Marketing',
        'hr' => 'HR',
        'trainer' => 'Trainer',
        'finance' => 'Finance',
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

/** Pipeline statuses on `leads.status` (aligned with leads.php PUT). */
function leadsAllowedStatuses(): array {
    return ['new', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'];
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
        // Legacy junk in DB — allow move onto a known status.
        return null;
    }

    $allowed = [
        'new' => ['contacted', 'qualified', 'interested', 'demo_scheduled', 'lost'],
        'contacted' => ['new', 'qualified', 'interested', 'demo_scheduled', 'lost'],
        'qualified' => ['contacted', 'interested', 'demo_scheduled', 'demo_attended', 'lost'],
        'interested' => ['contacted', 'qualified', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'],
        'demo_scheduled' => ['interested', 'demo_attended', 'enrolled', 'lost'],
        'demo_attended' => ['demo_scheduled', 'interested', 'enrolled', 'lost'],
        'enrolled' => ['lost'],
        'lost' => ['new', 'contacted', 'interested', 'qualified'],
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

/** Same idea as editing a lead from CRM: rep sees assigned/referred; admin/org same-org; manager = list scope. */
function userCanUpdateLeadForCallLog(PDO $db, array $tokenData, string $userId, string $rawRole, array $leadRow): bool {
    $rawRole = syncpediaNormalizeRoleKey($rawRole);
    if ($rawRole === 'super_admin') {
        return true;
    }
    if ($rawRole === 'sales_representative' || hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        if (($leadRow['assigned_to'] ?? '') === $userId) {
            return true;
        }
        if ((string) ($leadRow['created_by'] ?? '') === $userId) {
            return true;
        }
        try {
            $rc = $db->prepare('SELECT referral_code FROM users WHERE id = ? LIMIT 1');
            $rc->execute([$userId]);
            $code = trim((string) ($rc->fetch()['referral_code'] ?? ''));
            return $code !== '' && trim((string) ($leadRow['referred_by'] ?? '')) === $code;
        } catch (Throwable $ignored) {
            return false;
        }
    }
    if (in_array($rawRole, ['admin', 'org'], true)) {
        $orgId = userEffectiveOrgId($db, $tokenData, $userId);
        $leadOrg = trim((string) ($leadRow['org_id'] ?? ''));

        return $orgId !== null && $orgId !== '' && $leadOrg === $orgId;
    }
    if ($rawRole === 'manager') {
        $leadId = trim((string) ($leadRow['id'] ?? ''));
        if ($leadId === '') {
            return false;
        }
        $scope = tenantLeadsScopeSql($db, $tokenData, 'l');
        $st = $db->prepare("SELECT l.id FROM leads l WHERE l.id = ?{$scope['sql']} LIMIT 1");
        $st->execute(array_merge([$leadId], $scope['params']));

        return (bool) $st->fetch(PDO::FETCH_ASSOC);
    }

    return false;
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
        $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')->execute([$newStatus, $leadId]);
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
    } elseif ($prevStatus === 'enrolled' || enrollStudentRowAlreadyExists($db, $leadId)) {
        // Leaving enrolled (or cleaning stale enrolled students) via call-log status change.
        try {
            $db->prepare("UPDATE students SET lead_id = NULL, status = 'dropped' WHERE lead_id = ?")->execute([$leadId]);
        } catch (Throwable $ignored) {
        }
    }

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
 * @return array{payments: bool, offer_letters: bool}
 */
function userDecodePageAccess(?string $json): array {
    $defaults = ['payments' => false, 'offer_letters' => false];
    if (!is_string($json) || trim($json) === '') {
        return $defaults;
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return $defaults;
    }
    return [
        'payments' => !empty($decoded['payments']),
        'offer_letters' => !empty($decoded['offer_letters']),
    ];
}

/** @param array<string,mixed> $user */
function userAttachPageAccess(array &$user): void {
    $user['page_access'] = userDecodePageAccess(isset($user['page_access_json']) ? (string) $user['page_access_json'] : null);
    unset($user['page_access_json']);
}

/**
 * Normalize page_access from Team create/update. Defaults all OFF.
 * Only relevant flags for the target role are stored as true; others forced off.
 *
 * @param mixed $input
 * @return array{payments: bool, offer_letters: bool}
 */
function userNormalizePageAccessInput($input, string $memberRole): array {
    $access = ['payments' => false, 'offer_letters' => false];
    if (is_array($input)) {
        $access['payments'] = !empty($input['payments']);
        $access['offer_letters'] = !empty($input['offer_letters']);
    }
    $role = syncpediaNormalizeRoleKey($memberRole);
    if ($role !== 'sales_representative') {
        $access['payments'] = false;
    }
    if ($role !== 'hr') {
        $access['offer_letters'] = false;
    }
    return $access;
}

function userSavePageAccess(PDO $db, string $userId, array $access): void {
    ensureUsersPageAccessColumn($db);
    $json = json_encode([
        'payments' => !empty($access['payments']),
        'offer_letters' => !empty($access['offer_letters']),
    ], JSON_UNESCAPED_UNICODE);
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

/** True when this user may open Offer Letters (admins/managers always; HR when toggled on). */
function userCanAccessOfferLettersPage(array $tokenData, ?array $userRow = null, $org = null): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ($userRow['role'] ?? '')));
    if (in_array($role, ['super_admin', 'admin', 'manager'], true)) {
        return true;
    }
    if ($role !== 'hr') {
        return false;
    }
    $access = null;
    if (is_array($userRow)) {
        $access = isset($userRow['page_access']) && is_array($userRow['page_access'])
            ? $userRow['page_access']
            : userDecodePageAccess(isset($userRow['page_access_json']) ? (string) $userRow['page_access_json'] : null);
    }
    return !empty($access['offer_letters']);
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
    if ($tokenOrg !== null && $tokenOrg !== '') {
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
    try {
        return new DateTimeImmutable(substr($value, 0, 10));
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

/** Apply schedule-based status to listed batches and persist when changed. */
function batchesSyncScheduleStatus(PDO $db, array &$rows): void
{
    foreach ($rows as &$row) {
        if (!is_array($row) || empty($row['id'])) {
            continue;
        }
        $computed = batchScheduleStatus($row['start_date'] ?? null, $row['end_date'] ?? null);
        $stored = strtolower(trim((string) ($row['status'] ?? '')));
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

/** Team lead / sales reps: list only upcoming and active batches (read-only viewers). */
function batchesFilterViewerSchedule(array $tokenData, array $rows): array
{
    $role = strtolower(trim((string) ($tokenData['role'] ?? '')));
    $viewerRoles = ['sales_representative'];
    if (!in_array($role, $viewerRoles, true)) {
        return $rows;
    }

    return array_values(array_filter($rows, static function ($row) {
        if (!is_array($row)) {
            return false;
        }
        $status = batchScheduleStatus($row['start_date'] ?? null, $row['end_date'] ?? null);

        return $status === 'upcoming' || $status === 'active';
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
 * Store a certificate template image under uploads/certificate_assets/.
 *
 * @param array|null $file $_FILES['file']
 * @return string Relative URL e.g. /uploads/certificate_assets/xxx.jpg
 */
function saveCertificateTemplateImageUpload(?array $file): string {
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
    $uploadParent = __DIR__ . '/../uploads/certificate_assets';
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
    return '/uploads/certificate_assets/' . $filename;
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
        'audio/webm',
        'audio/ogg',
        'application/pdf',
    ];
}

function callRecordingMaxBytes(): int {
    return 30 * 1024 * 1024;
}

/**
 * Ensure uploads/resumes and uploads/call_recordings exist beside api/ (idempotent).
 * Used on hosts where empty dirs are not deployed.
 */
function ensureUploadDirectoriesExist(): void {
    $parent = __DIR__ . '/../uploads';
    foreach (['resumes', 'call_recordings', 'form_leads'] as $sub) {
        $dir = $parent . DIRECTORY_SEPARATOR . $sub;
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
    }
}

/**
 * Validate and store an uploaded call recording under uploads/call_recordings/.
 *
 * @param array|null $file Single element from $_FILES
 * @return string|null Relative path e.g. /uploads/call_recordings/xxx.webm
 */
function saveCallRecordingUpload(?array $file): ?string {
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
    $uploadParent = __DIR__ . '/../uploads/call_recordings';
    if (!is_dir($uploadParent)) {
        if (!mkdir($uploadParent, 0755, true)) {
            respond(['error' => 'Cannot create upload directory'], 500);
        }
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        respond(['error' => 'Upload directory unavailable'], 500);
    }
    $orig = basename((string) ($file['name'] ?? 'recording'));
    $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'recording';
    $filename = uniqid('', true) . '_' . $orig;
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $destFs)) {
        respond(['error' => 'Failed to save recording'], 500);
    }
    return '/uploads/call_recordings/' . $filename;
}

/** Remove a stored call recording file (safe path under uploads/call_recordings/). */
function deleteCallRecordingIfExists(?string $relativePath): void {
    if ($relativePath === null || $relativePath === '') {
        return;
    }
    $rel = str_replace('\\', '/', $relativePath);
    $rel = ltrim($rel, '/');
    if ($rel === '' || strpos($rel, '..') !== false) {
        return;
    }
    $uploadRoot = realpath(__DIR__ . '/../uploads/call_recordings');
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

/** Notify assignee when a task is created or reassigned to them. */
function syncpediaNotifyTaskAssignee(
    PDO $db,
    string $assigneeId,
    string $actorUserId,
    string $taskTitle,
    ?string $orgId = null,
): void {
    $assigneeId = trim($assigneeId);
    if ($assigneeId === '' || $assigneeId === $actorUserId) {
        return;
    }
    $actorName = 'A teammate';
    try {
        $st = $db->prepare('SELECT full_name FROM users WHERE id = ? LIMIT 1');
        $st->execute([$actorUserId]);
        $name = trim((string) ($st->fetchColumn() ?: ''));
        if ($name !== '') {
            $actorName = $name;
        }
    } catch (Throwable $e) {
    }
    $title = 'New task assigned';
    $message = $actorName . ' assigned you a task: ' . (trim($taskTitle) !== '' ? trim($taskTitle) : 'Untitled');
    syncpediaNotifyUser($db, $assigneeId, $title, $message, 'task_assigned', '/tasks', $orgId);
}

/** In-app notification for payment link events (webhook). */
function paymentLinkNotifySalesperson(PDO $db, string $salespersonId, string $title, string $message, ?string $orgId = null): void {
    syncpediaNotifyUser($db, $salespersonId, $title, $message, 'payment_link', '/payments', $orgId);
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

