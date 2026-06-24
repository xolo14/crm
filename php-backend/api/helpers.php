<?php
// Capture BOM, notices, or any stray output from includes before JSON is sent.
if (ob_get_level() === 0) {
    ob_start();
}
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/mail_transport.php';
ini_set('display_errors', '0');
ini_set('log_errors', '1');

class Database {
    private $conn;

    public function getConnection() {
        if ($this->conn === null) {
            try {
                $this->conn = new PDO(
                    "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                    DB_USER,
                    DB_PASS,
                    [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                        PDO::ATTR_EMULATE_PREPARES => false,
                    ]
                );
            } catch (PDOException $e) {
                respond(['error' => 'Database connection failed'], 500);
            }
        }
        return $this->conn;
    }
}

function cors() {
    // Buffer output so stray notices/BOM from includes cannot break JSON responses.
    if (ob_get_level() === 0) {
        ob_start();
    }
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header("Access-Control-Allow-Origin: " . FRONTEND_URL);
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

    return $data;
}

function requireRole($tokenData, $roles) {
    if (!in_array($tokenData['role'], $roles)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }
}

// Get org_id from token - super_admin can override via query param
function getOrgId($tokenData) {
    // Super admin can switch orgs
    if ($tokenData['role'] === 'super_admin' && !empty($_GET['org_id'])) {
        return $_GET['org_id'];
    }
    return $tokenData['org_id'] ?? null;
}

// Build org filter for queries - returns WHERE clause fragment + params
function orgFilter($tokenData, $tableAlias = '') {
    $prefix = $tableAlias ? "$tableAlias." : '';
    $orgId = getOrgId($tokenData);
    
    // Super admin with no org filter sees everything
    if ($tokenData['role'] === 'super_admin' && !$orgId) {
        return ['where' => '1=1', 'params' => []];
    }
    
    if ($orgId) {
        return ['where' => "{$prefix}org_id = ?", 'params' => [$orgId]];
    }
    
    // Fallback: no org filter (backward compat for users without org)
    return ['where' => "({$prefix}org_id IS NULL)", 'params' => []];
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
    return $r;
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
        'sales_marketing' => 1,
        'trainer' => 1,
        'finance' => 1,
        'student' => 0,
    ];
    return $levels[$r] ?? 0;
}

function syncpediaL1AssignableRoles(): array
{
    return ['sales_representative', 'hr', 'marketing', 'sales_marketing'];
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
        $chk = $db->query("SHOW COLUMNS FROM `users` LIKE 'reports_to_id'");
        if (!$chk || !$chk->fetch()) {
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
                    (p.org_id IS NULL OR TRIM(CAST(p.org_id AS CHAR)) = '')
                    AND (u.org_id IS NULL OR TRIM(CAST(u.org_id AS CHAR)) = '')
                  OR (
                    p.org_id IS NOT NULL AND TRIM(CAST(p.org_id AS CHAR)) <> ''
                    AND u.org_id IS NOT NULL AND TRIM(CAST(u.org_id AS CHAR)) <> ''
                    AND u.org_id = p.org_id
                  ))
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
 * Downline lead filter: assigned_to or referral_code from visible user ids.
 *
 * @param string[] $visibleIds
 * @return array{sql: string, params: array}
 */
function hierarchyLeadDownlineScopeSql(array $visibleIds, string $alias = ''): array
{
    if (empty($visibleIds)) {
        return ['sql' => ' AND 1=0', 'params' => []];
    }
    $col = $alias !== '' ? "{$alias}." : '';
    $in = implode(',', array_fill(0, count($visibleIds), '?'));
    return [
        'sql' => " AND ({$col}assigned_to IN ({$in}) OR {$col}referred_by IN (SELECT referral_code FROM users WHERE id IN ({$in})))",
        'params' => array_merge($visibleIds, $visibleIds),
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

/** L2 managers scope list endpoints to reporting downline; L3 admin/org see full tenant (see leads.php). */
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
function hierarchyOrgUserIdsScopeSql(array $tokenData, string $columnExpr): array
{
    $orgId = getOrgId($tokenData);
    if (!$orgId) {
        return ['sql' => '', 'params' => []];
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
    return in_array($r, ['sales_representative', 'sales_marketing', 'marketing', 'hr'], true);
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
function reportsOrgScopeSql(array $tokenData, string $alias = ''): array
{
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        return ['sql' => '', 'params' => []];
    }
    $orgId = getOrgId($tokenData);
    if (!$orgId) {
        return ['sql' => '', 'params' => []];
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
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        return hierarchyL1OwnLeadsScopeSql($tokenData, $alias);
    }
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyLeadDownlineScopeSql($visibleIds, $alias);
    }
    return reportsOrgScopeSql($tokenData, $alias);
}

/**
 * @return array{sql: string, params: array}
 */
function reportsDealScopeSql(PDO $db, array $tokenData, string $alias = 'd'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyBuildInClause("{$col}owner_id", $visibleIds);
    }
    return reportsOrgScopeSql($tokenData, $alias);
}

/**
 * @return array{sql: string, params: array}
 */
function reportsTaskScopeSql(PDO $db, array $tokenData, string $alias = 't'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyTaskListScopeSql($visibleIds, $alias);
    }
    return reportsOrgScopeSql($tokenData, $alias);
}

/**
 * @return array{sql: string, params: array}
 */
function reportsContactScopeSql(PDO $db, array $tokenData, string $alias = 'c'): array
{
    $col = $alias !== '' ? "{$alias}." : '';
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyBuildInClause("{$col}owner_id", $visibleIds);
    }
    return reportsOrgScopeSql($tokenData, $alias);
}

/**
 * Paid student payments visible to managers via downline lead / mentor ownership.
 *
 * @return array{sql: string, params: array}
 */
function reportsPaymentScopeSql(PDO $db, array $tokenData, string $alias = 'p'): array
{
    if (!hierarchyRoleUsesDownlineScope($tokenData)) {
        return reportsOrgScopeSql($tokenData, $alias);
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
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        return hierarchyBuildInClause('u.id', $visibleIds);
    }
    return reportsOrgScopeSql($tokenData, 'u');
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
    $fromAddr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia';

    if (syncpediaSmtpIsReady()) {
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
            $smtp['from'] = $fromAddr;
            return $smtp;
        }
    }

    $fallback = syncpediaDeliverHtmlEmail($to, $subject, $htmlBody, $fromAddr, $disp);
    if ($fallback['ok']) {
        $fallback['from'] = $fromAddr;
        if ($attachments !== []) {
            $fallback['warning'] = 'Invoice PDF could not be attached (configure SMTP for attachments).';
        }
    }
    return $fallback;
}

/** Base URL for CRM login links in emails. Override with SYNCPIEDIA_CRM_URL (no trailing slash). */
function syncpediaCrmAppBaseUrl(): string {
    $e = getenv('SYNCPIEDIA_CRM_URL');
    if ($e !== false && trim($e) !== '') {
        return rtrim(trim($e), '/');
    }
    return 'https://crm.syncpedia.in';
}

function syncpediaTeamWelcomeRoleLabel(string $roleKey): string {
    $k = strtolower(trim($roleKey));
    $map = [
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'manager' => 'Manager',
        'sales_representative' => 'Sales Rep',
        'marketing' => 'Marketing',
        'sales_marketing' => 'Sales Marketing',
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
    $loginUrl = $h(syncpediaCrmAppBaseUrl() . '/');
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
 * Deliver HTML email: SMTP (Gmail / Google Workspace) when configured, else PHP mail().
 *
 * @return array{ok: bool, error?: string}
 */
function syncpediaDeliverHtmlEmail(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
): array {
    if (syncpediaSmtpIsReady()) {
        $smtp = syncpediaSendHtmlEmailViaSmtp($to, $subject, $htmlBody, $fromAddr, $fromDisplayName);
        if ($smtp['ok']) {
            return $smtp;
        }
    }

    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid recipient email'];
    }
    $fromAddr = trim($fromAddr);
    if (!filter_var($fromAddr, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid from email'];
    }
    $disp = trim($fromDisplayName) !== '' ? trim($fromDisplayName) : 'Syncpedia';
    $subj = $subject;
    if (function_exists('mb_encode_mimeheader')) {
        $subj = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
    }
    $fromHeader = function_exists('mb_encode_mimeheader')
        ? mb_encode_mimeheader($disp, 'UTF-8', 'B', "\r\n") . ' <' . $fromAddr . '>'
        : $disp . ' <' . $fromAddr . '>';
    $headers = [
        'MIME-Version: 1.0',
        'Content-type: text/html; charset=UTF-8',
        'From: ' . $fromHeader,
        'Reply-To: ' . $fromAddr,
        'X-Mailer: Syncpedia-CRM/' . PHP_VERSION,
    ];
    $extraParams = '-f' . $fromAddr;
    $ok = @mail($to, $subj, $htmlBody, implode("\r\n", $headers), $extraParams);
    if ($ok) {
        return ['ok' => true];
    }
    $hint = syncpediaSmtpIsReady()
        ? 'SMTP send failed and PHP mail() fallback failed.'
        : 'Enable SMTP in api/config.php (Google App Passwords) or configure Hostinger PHP mail.';
    return ['ok' => false, 'error' => $hint];
}

/**
 * Send HTML email as support@syncpedia.in (or SYNCPIEDIA_MAIL_FROM).
 *
 * @return array{ok: bool, error?: string}
 */
function syncpediaSendHtmlEmail(string $to, string $subject, string $htmlBody): array
{
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
): array {
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
    $fromAddr = syncpediaSupportMailAddress();
    $name = getenv('SYNCPIEDIA_MAIL_FROM_NAME');
    $disp = ($name !== false && trim($name) !== '') ? trim($name) : 'Syncpedia Certifications';
    $html = syncpediaCertificateEmailHtml($plainBody);

    if (syncpediaSmtpIsReady()) {
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
            $smtp['from'] = $fromAddr;
            return $smtp;
        }
    }

    $fallback = syncpediaDeliverHtmlEmail($to, $subject, $html, $fromAddr, $disp);
    if ($fallback['ok']) {
        $fallback['from'] = $fromAddr;
        return $fallback;
    }
    return $fallback;
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
    $fromAddr = syncpediaHrMailAddress();
    $disp = 'Syncpedia HR';
    $html = syncpediaCertificateEmailHtml($plainBody);

    if (syncpediaSmtpIsReady()) {
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
            $smtp['from'] = $fromAddr;
            return $smtp;
        }
    }

    $fallback = syncpediaDeliverHtmlEmail($to, $subject, $html, $fromAddr, $disp);
    if ($fallback['ok']) {
        $fallback['from'] = $fromAddr;
        return $fallback;
    }
    return $fallback;
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
    $fromAddr = syncpediaHrMailAddress();
    $disp = 'Syncpedia HR';

    if (syncpediaSmtpIsReady()) {
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
            $smtp['from'] = $fromAddr;
            return $smtp;
        }
    }

    $fallback = syncpediaDeliverHtmlEmail(
        $to,
        $subject,
        $htmlBody,
        $fromAddr,
        $disp,
    );
    if ($fallback['ok']) {
        $fallback['from'] = $fromAddr;
    }
    return $fallback;
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
    @syncpediaSendHtmlEmail($notify, $subj, $html);
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

/** MySQL duplicate key / unique constraint (idempotent enroll, etc.) */
function isMysqlDuplicateKey(Throwable $e): bool {
    if ($e instanceof PDOException && isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1062) {
        return true;
    }
    $m = $e->getMessage();
    return stripos($m, '1062') !== false || stripos($m, 'Duplicate') !== false;
}

/** True when INSERT failed because listed columns are missing (older DB). */
function isStudentInsertUnknownColumn(Throwable $e, string $column): bool {
    $m = $e->getMessage();
    if (stripos($m, 'Unknown column') === false) {
        return false;
    }
    $col = preg_quote($column, '/');
    return preg_match('/Unknown column\s+[\'`]?' . $col . '[\'`]?/i', $m) === 1;
}

/** True when INSERT failed because lead_id/org_id columns are missing (older DB). */
function isStudentInsertUnknownColumnFallback(Throwable $e): bool {
    return isStudentInsertUnknownColumn($e, 'lead_id') || isStudentInsertUnknownColumn($e, 'org_id');
}

/** MySQL foreign key violation (e.g. invalid org_id on students). */
function isMysqlForeignKeyViolation(Throwable $e): bool {
    if ($e instanceof PDOException && isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1452) {
        return true;
    }
    $m = $e->getMessage();
    return stripos($m, '1452') !== false || stripos($m, 'foreign key constraint') !== false;
}

/**
 * True when this lead already has a student row (duplicate enroll is safe to ignore).
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

/** Pipeline statuses on `leads.status` (aligned with leads.php PUT). */
function leadsAllowedStatuses(): array {
    return ['new', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'];
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

/** Same idea as editing a lead from CRM: rep sees assigned/referred; org roles same-org. */
function userCanUpdateLeadForCallLog(PDO $db, array $tokenData, string $userId, string $rawRole, array $leadRow): bool {
    if ($rawRole === 'super_admin') {
        return true;
    }
    if ($rawRole === 'sales_representative' || $rawRole === 'sales_executive') {
        if (($leadRow['assigned_to'] ?? '') === $userId) {
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
    if (in_array($rawRole, ['admin', 'org', 'manager'], true)) {
        $orgId = userEffectiveOrgId($db, $tokenData, $userId);
        $leadOrg = trim((string) ($leadRow['org_id'] ?? ''));

        return $orgId !== null && $orgId !== '' && $leadOrg === $orgId;
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
            } catch (Throwable $ignored) {
            }
        }
    }
}

/**
 * Apply CRM pipeline status from Log Call flow.
 *
 * @return string|null error message, or null when OK
 */
function leadsSyncPipelineStatusFromCallLog(PDO $db, array $tokenData, string $userId, string $rawRole, string $leadId, string $newStatus): ?string {
    $newStatus = strtolower(trim($newStatus));
    if (!in_array($newStatus, leadsAllowedStatuses(), true)) {
        return 'Invalid lead_status';
    }
    $st = $db->prepare('SELECT id, org_id, assigned_to, referred_by, email FROM leads WHERE id = ? LIMIT 1');
    $st->execute([$leadId]);
    $leadRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$leadRow) {
        return 'Lead not found';
    }
    if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $rawRole, $leadRow)) {
        return 'Not allowed to update this lead';
    }
    if ($newStatus === 'enrolled') {
        $em = trim((string) ($leadRow['email'] ?? ''));
        if ($em === '') {
            return 'Lead must have an email before Enroll status';
        }
    }
    try {
        $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')->execute([$newStatus, $leadId]);
    } catch (Throwable $e) {
        return 'Could not update lead status';
    }
    if ($newStatus === 'enrolled') {
        try {
            leadsTryAttachStudentForEnrollment($db, $tokenData, $leadId);
        } catch (Throwable $ignored) {
        }
    }

    return null;
}

/** Tables allowed for trash archive (whitelist). */
function trashAllowedTables(): array {
    return [
        'leads', 'students', 'contacts', 'deals', 'tasks', 'courses', 'batches', 'payments', 'holidays', 'lead_assignments',
    ];
}

/**
 * Insert a full row snapshot into trash_items (used when row was loaded with permission checks).
 */
function trashArchivePayload(PDO $db, string $entityType, array $row, array $tokenData): void {
    if (empty($row['id'])) {
        return;
    }
    try {
        $flags = JSON_UNESCAPED_UNICODE;
        if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
            $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
        }
        $json = json_encode($row, $flags);
        if ($json === false) {
            $json = '{}';
        }
        $tid = generateUUID();
        $orgId = $row['org_id'] ?? null;
        $by = $tokenData['user_id'] ?? null;
        $ins = $db->prepare('INSERT INTO trash_items (id, entity_type, entity_id, payload, org_id, deleted_by) VALUES (?,?,?,?,?,?)');
        $ins->execute([$tid, $entityType, (string) $row['id'], $json, $orgId, $by]);
    } catch (Throwable $ignored) {
    }
}

/**
 * Snapshot a row into trash_items before hard DELETE. No-op if table unknown or trash_items missing.
 */
function trashArchiveRow(PDO $db, string $entityType, string $table, string $id, array $tokenData): void {
    if (!in_array($table, trashAllowedTables(), true)) {
        return;
    }
    try {
        $sel = $db->prepare("SELECT * FROM `{$table}` WHERE id = ? LIMIT 1");
        $sel->execute([$id]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if (!$row || empty($row['id'])) {
            return;
        }
        trashArchivePayload($db, $entityType, $row, $tokenData);
    } catch (Throwable $ignored) {
    }
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

    if (($tokenData['role'] ?? '') === 'super_admin') {
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
    if (($tokenData['role'] ?? '') === 'super_admin' && !empty($_GET['org_id'])) {
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
            CREATE TABLE IF NOT EXISTS `lead_forms` (
              `id` CHAR(36) NOT NULL,
              `name` VARCHAR(255) NOT NULL,
              `slug` VARCHAR(255) NOT NULL,
              `description` TEXT DEFAULT NULL,
              `fields_json` JSON DEFAULT NULL,
              `is_active` TINYINT(1) NOT NULL DEFAULT 1,
              `created_by` CHAR(36) NOT NULL,
              `org_id` CHAR(36) DEFAULT NULL,
              `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              UNIQUE KEY `uq_lead_forms_slug_org` (`slug`, `org_id`),
              KEY `idx_lead_forms_org` (`org_id`),
              KEY `idx_lead_forms_active` (`is_active`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $chk = $db->query("SHOW COLUMNS FROM `lead_forms` LIKE 'fields_json'");
        if ($chk && !$chk->fetch()) {
            $db->exec("ALTER TABLE `lead_forms` ADD COLUMN `fields_json` JSON DEFAULT NULL AFTER `description`");
        }
        $chk2 = $db->query("SHOW COLUMNS FROM `lead_forms` LIKE 'meta_json'");
        if ($chk2 && !$chk2->fetch()) {
            $db->exec("ALTER TABLE `lead_forms` ADD COLUMN `meta_json` JSON DEFAULT NULL AFTER `fields_json`");
        }

        $db->exec("
            CREATE TABLE IF NOT EXISTS `lead_form_assignments` (
              `id` CHAR(36) NOT NULL,
              `form_id` CHAR(36) NOT NULL,
              `member_id` CHAR(36) NOT NULL,
              `assigned_by` CHAR(36) NOT NULL,
              `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              UNIQUE KEY `uq_form_member` (`form_id`, `member_id`),
              KEY `idx_lfa_form` (`form_id`),
              KEY `idx_lfa_member` (`member_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $ignored) {
    }

    $done = true;
}

/**
 * Platform-global builtin forms for Syncpedia (org_id NULL): slug `default` + `normal`.
 * Recreates rows if they were deleted; safe to call on every request.
 */
function ensureGlobalBuiltinLeadForms(PDO $db): void {
    try {
        ensureLeadFormsTables($db);

        $st = $db->query("SELECT id FROM users WHERE LOWER(TRIM(role)) = 'super_admin' ORDER BY created_at ASC LIMIT 1");
        $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
        $createdBy = !empty($row['id']) ? (string) $row['id'] : '';
        if ($createdBy === '') {
            $st2 = $db->query("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
            $row2 = $st2 ? $st2->fetch(PDO::FETCH_ASSOC) : false;
            $createdBy = !empty($row2['id']) ? (string) $row2['id'] : '';
        }
        if ($createdBy === '') {
            return;
        }

        $pairs = [
            ['Default Capture', 'default', 'System global capture form (platform / Syncpedia sales)'],
            ['Normal', 'normal', 'Standard global lead form (tenant sales)'],
        ];
        foreach ($pairs as [$name, $slug, $desc]) {
            $ins = $db->prepare("
                INSERT INTO lead_forms (id, name, slug, description, fields_json, meta_json, is_active, created_by, org_id)
                SELECT UUID(), ?, ?, ?, NULL, NULL, 1, ?, NULL
                WHERE NOT EXISTS (
                    SELECT 1 FROM lead_forms lf WHERE lf.slug = ? AND lf.org_id IS NULL
                )
            ");
            $ins->execute([$name, $slug, $desc, $createdBy, $slug]);
        }
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
            CREATE TABLE IF NOT EXISTS `lead_form_assignments` (
              `id` CHAR(36) NOT NULL,
              `form_id` CHAR(36) NOT NULL,
              `member_id` CHAR(36) NOT NULL,
              `assigned_by` CHAR(36) NOT NULL,
              `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              UNIQUE KEY `uq_form_member` (`form_id`, `member_id`),
              KEY `idx_lfa_form` (`form_id`),
              KEY `idx_lfa_member` (`member_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $ignored) {
    }
    $done = true;
}

/**
 * Resolve lead_form IDs for auto-assign:
 * - Platform members (no org): global active `default` AND global active `normal` (both existing system forms).
 * - Syncpedia org members: same as platform (default + normal globals).
 * - Other org members: active `normal` preferring org row, else global (matches Form Management rules).
 *
 * @return string[] distinct form UUIDs
 */
function lfResolveAutoAssignLeadFormIds(PDO $db, ?string $memberOrg): array {
    $ids = [];
    try {
        $effectiveOrg = $memberOrg;
        if ($effectiveOrg !== null && $effectiveOrg !== '') {
            $chk = $db->prepare('SELECT LOWER(TRIM(slug)) AS s FROM organizations WHERE id = ? LIMIT 1');
            $chk->execute([$effectiveOrg]);
            $orow = $chk->fetch(PDO::FETCH_ASSOC);
            if (($orow['s'] ?? '') === syncpediaPlatformOrgSlug()) {
                $effectiveOrg = null;
            }
        }

        if ($effectiveOrg === null || $effectiveOrg === '') {
            foreach (['default', 'normal'] as $slug) {
                $st = $db->prepare("SELECT id FROM lead_forms WHERE slug = ? AND is_active = 1 AND org_id IS NULL LIMIT 1");
                $st->execute([$slug]);
                $row = $st->fetch(PDO::FETCH_ASSOC);
                if (!empty($row['id'])) {
                    $fid = (string)$row['id'];
                    if (!in_array($fid, $ids, true)) {
                        $ids[] = $fid;
                    }
                }
            }
        } else {
            $st = $db->prepare("SELECT id FROM lead_forms WHERE slug = 'normal' AND is_active = 1 AND (org_id IS NULL OR org_id = ?) ORDER BY (org_id <=> ?) DESC LIMIT 1");
            $st->execute([$effectiveOrg, $effectiveOrg]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!empty($row['id'])) {
                $ids[] = (string)$row['id'];
            }
        }
    } catch (Throwable $ignored) {
    }

    return $ids;
}

/** Upsert lead_form_assignments for default/normal rules. Returns number of rows touched. */
function assignLeadFormsToSalesMember(PDO $db, string $assignedByUserId, string $memberId, ?string $memberOrgId): int {
    ensureLeadFormAssignmentsTable($db);
    $org = lfNormalizeMemberOrg($memberOrgId);
    $formIds = lfResolveAutoAssignLeadFormIds($db, $org);
    $n = 0;
    foreach ($formIds as $fid) {
        try {
            $ins = $db->prepare("
                INSERT INTO lead_form_assignments (id, form_id, member_id, assigned_by)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by)
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
    foreach (['resumes', 'call_recordings'] as $sub) {
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

/** In-app notification for payment link events (webhook). */
function paymentLinkNotifySalesperson(PDO $db, string $salespersonId, string $title, string $message, ?string $orgId = null): void {
    try {
        $nid = generateUUID();
        $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$nid, $salespersonId, $title, $message, 'payment_link', '/payments', $orgId]);
    } catch (Throwable $e) {
        try {
            $nid = generateUUID();
            $stmt = $db->prepare('INSERT INTO notifications (id, user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$nid, $salespersonId, $title, $message, 'payment_link', '/payments']);
        } catch (Throwable $e2) {
        }
    }
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
    $payload = ['error' => 'Internal server error', 'detail' => $detail, 'file' => $file, 'line' => $line];
    $json = json_encode($payload, $flags);
    echo $json !== false ? $json : '{"error":"Internal server error"}';
});

