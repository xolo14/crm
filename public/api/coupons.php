<?php
/**
 * Coupons API — per-person discount codes.
 *
 * GET: list (hierarchy-scoped)
 * POST: create (all fields required)
 * DELETE: ?id=  (creator, or org/manager+)
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = (string) ($tokenData['user_id'] ?? '');

function couponsEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS coupons (
                id CHAR(36) NOT NULL PRIMARY KEY,
                org_id CHAR(36) DEFAULT NULL,
                lead_id CHAR(36) DEFAULT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                discount DECIMAL(12,2) NOT NULL,
                min_amount DECIMAL(12,2) NOT NULL,
                code VARCHAR(64) NOT NULL,
                created_by CHAR(36) DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        error_log('[coupons] schema: ' . $e->getMessage());
    }
    if (function_exists('syncpediaEnsureIndex')) {
        syncpediaEnsureIndex($db, 'idx_coupons_org', 'coupons', 'org_id');
        syncpediaEnsureIndex($db, 'idx_coupons_created_by', 'coupons', 'created_by');
        syncpediaEnsureIndex($db, 'idx_coupons_lead', 'coupons', 'lead_id');
    }
    if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'expires_at')) {
        try {
            $db->exec('ALTER TABLE coupons ADD COLUMN expires_at DATE DEFAULT NULL');
        } catch (Throwable $e) {
            error_log('[coupons] expires_at column: ' . $e->getMessage());
        }
    }
    if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'phone')) {
        try {
            $db->exec('ALTER TABLE coupons ADD COLUMN phone VARCHAR(32) DEFAULT NULL');
        } catch (Throwable $e) {
            error_log('[coupons] phone column: ' . $e->getMessage());
        }
    }
    if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'used_at')) {
        try {
            $db->exec('ALTER TABLE coupons ADD COLUMN used_at DATETIME DEFAULT NULL');
        } catch (Throwable $e) {
            error_log('[coupons] used_at column: ' . $e->getMessage());
        }
    }
    try {
        $db->exec('ALTER TABLE coupons ADD UNIQUE KEY uq_coupons_org_code (org_id, code)');
    } catch (Throwable $e) {
        /* already exists or engine cannot add — create still checks duplicates */
    }
    $done = true;
}

function couponsEnsureApiKeySchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS org_coupon_api_keys (
                org_id CHAR(36) NOT NULL PRIMARY KEY,
                api_key VARCHAR(96) NOT NULL,
                created_by CHAR(36) DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        error_log('[coupons] api key schema: ' . $e->getMessage());
    }
    try {
        $db->exec('ALTER TABLE org_coupon_api_keys ADD UNIQUE KEY uq_org_coupon_api_key (api_key)');
    } catch (Throwable $e) {
        /* already exists */
    }
    $done = true;
}

function couponsEnsureMinAmountSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS org_coupon_settings (
                org_id CHAR(36) NOT NULL PRIMARY KEY,
                min_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                updated_by CHAR(36) DEFAULT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        error_log('[coupons] min amount schema: ' . $e->getMessage());
    }
    $done = true;
}

function couponsNormalizeCode(string $raw): string
{
    $code = strtoupper(trim($raw));
    $code = preg_replace('/[^A-Z0-9_-]/', '', $code) ?? '';
    return substr($code, 0, 64);
}

function couponsGenerateCode(): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $len = strlen($alphabet);
    $out = '';
    for ($i = 0; $i < 8; $i++) {
        $out .= $alphabet[random_int(0, $len - 1)];
    }
    return $out;
}

function couponsNormalizePhone(string $raw): string
{
    $s = trim($raw);
    if ($s === '') {
        respond(['error' => 'Phone number is required'], 400);
    }
    $digits = preg_replace('/\D+/', '', $s) ?? '';
    if (strlen($digits) < 10) {
        respond(['error' => 'Enter a valid phone number'], 400);
    }
    return substr($s, 0, 32);
}

function couponsWantSendEmail(array $input): bool
{
    $v = $input['send_email'] ?? $input['send_mail'] ?? false;
    if (is_bool($v)) {
        return $v;
    }
    $s = strtolower(trim((string) $v));
    return in_array($s, ['1', 'true', 'yes', 'on'], true);
}

function couponsLoadMailbox(PDO $db, string $orgId, string $accountId): ?array
{
    if ($orgId === '' || $accountId === '') {
        return null;
    }
    if (function_exists('syncpediaEnsureOrgEmailSchema')) {
        syncpediaEnsureOrgEmailSchema($db);
    }
    $st = $db->prepare(
        'SELECT id, slot, label, email, from_name FROM org_smtp_accounts
         WHERE org_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    );
    $st->execute([$orgId, $accountId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }
    $email = strtolower(trim((string) ($row['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    return [
        'id' => (string) ($row['id'] ?? ''),
        'email' => $email,
        'from_name' => trim((string) ($row['from_name'] ?? '')),
        'label' => trim((string) ($row['label'] ?? '')),
        'slot' => (int) ($row['slot'] ?? 0),
    ];
}

function couponsSendIssuedEmail(
    PDO $db,
    string $orgId,
    array $mailbox,
    array $coupon
): array {
    require_once __DIR__ . '/mail_transport.php';
    if (function_exists('syncpediaSetMailContext')) {
        syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'coupons');
    }
    if (function_exists('syncpediaSetPreferredSmtpAccountId')) {
        syncpediaSetPreferredSmtpAccountId((string) ($mailbox['id'] ?? ''));
    }
    $to = strtolower(trim((string) ($coupon['email'] ?? '')));
    $name = htmlspecialchars((string) ($coupon['name'] ?? ''), ENT_QUOTES, 'UTF-8');
    $code = htmlspecialchars((string) ($coupon['code'] ?? ''), ENT_QUOTES, 'UTF-8');
    $phone = htmlspecialchars((string) ($coupon['phone'] ?? ''), ENT_QUOTES, 'UTF-8');
    $discount = htmlspecialchars((string) ($coupon['discount_fmt'] ?? $coupon['discount'] ?? ''), ENT_QUOTES, 'UTF-8');
    $min = htmlspecialchars((string) ($coupon['min_fmt'] ?? $coupon['min_amount'] ?? ''), ENT_QUOTES, 'UTF-8');
    $expires = htmlspecialchars((string) ($coupon['expires_at'] ?? ''), ENT_QUOTES, 'UTF-8');
    $orgName = '';
    try {
        $st = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $orgName = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $e) {
        $orgName = '';
    }
    $orgSafe = htmlspecialchars($orgName !== '' ? $orgName : 'SYNCPedia', ENT_QUOTES, 'UTF-8');
    $subject = 'Your coupon code ' . (string) ($coupon['code'] ?? '');
    $html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        . '<p>Hi ' . $name . ',</p>'
        . '<p>Here are your coupon details from <strong>' . $orgSafe . '</strong>.</p>'
        . '<table style="border-collapse:collapse;width:100%;max-width:480px">'
        . '<tr><td style="padding:6px 0;color:#555">Coupon code</td><td style="padding:6px 0;font-weight:700;letter-spacing:0.04em">' . $code . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Discount</td><td style="padding:6px 0">' . $discount . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Min amount</td><td style="padding:6px 0">' . $min . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Expires</td><td style="padding:6px 0">' . $expires . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Phone</td><td style="padding:6px 0">' . $phone . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Email</td><td style="padding:6px 0">' . htmlspecialchars($to, ENT_QUOTES, 'UTF-8') . '</td></tr>'
        . '<tr><td style="padding:6px 0;color:#555">Use</td><td style="padding:6px 0">Single use — one reduction before expiry</td></tr>'
        . '</table>'
        . '<p style="margin-top:16px">Use this code once at checkout before the expiry date. The discount applies when the bill is at least the min amount. After one use the code will not work again.</p>'
        . '</div>';
    $fromName = trim((string) ($mailbox['from_name'] ?? ''));
    if ($fromName === '') {
        $fromName = $orgName !== '' ? $orgName : 'SYNCPedia';
    }
    if (!function_exists('syncpediaSendHtmlEmailViaSmtp')) {
        return ['ok' => false, 'error' => 'Mail transport unavailable'];
    }
    return syncpediaSendHtmlEmailViaSmtp(
        $to,
        $subject,
        $html,
        (string) ($mailbox['email'] ?? ''),
        $fromName
    );
}

function couponsParseExpiresAt($raw): string
{
    $s = trim((string) $raw);
    if ($s === '') {
        respond(['error' => 'Expiry date is required'], 400);
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $s, $m)) {
        $s = $m[1];
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $s);
    if (!$dt || $dt->format('Y-m-d') !== $s) {
        respond(['error' => 'Expiry date must be YYYY-MM-DD'], 400);
    }
    if ($s < date('Y-m-d')) {
        respond(['error' => 'Expiry date must be today or later'], 400);
    }
    return $s;
}

function couponsCanEditMinAmount(array $tokenData): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($role, ['super_admin', 'admin', 'org'], true);
}

function couponsResolveSettingsOrgId(PDO $db, array $tokenData): string
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        $orgId = trim((string) ($_GET['org_id'] ?? ''));
        if ($orgId === '') {
            respond(['error' => 'Select an organization'], 400);
        }
        $st = $db->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        if (!$st->fetch(PDO::FETCH_ASSOC)) {
            respond(['error' => 'Organization not found'], 404);
        }
        return $orgId;
    }

    $orgId = trim((string) (getOrgId($tokenData) ?? ''));
    if ($orgId === '') {
        $orgId = trim((string) (resolveWriteOrgId($db, $tokenData) ?? ''));
    }
    if ($orgId === '') {
        respond(['error' => 'No organization on this account'], 400);
    }
    return $orgId;
}

function couponsGetOrgMinAmount(PDO $db, string $orgId): float
{
    try {
        $st = $db->prepare('SELECT min_amount FROM org_coupon_settings WHERE org_id = ? LIMIT 1');
        $st->execute([$orgId]);
        $v = $st->fetchColumn();
        if ($v === false || $v === null) {
            return 0.0;
        }
        return round((float) $v, 2);
    } catch (Throwable $e) {
        return 0.0;
    }
}

function couponsSetOrgMinAmount(PDO $db, string $orgId, float $amount, string $userId): void
{
    $st = $db->prepare(
        'INSERT INTO org_coupon_settings (org_id, min_amount, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE min_amount = VALUES(min_amount), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP'
    );
    $st->execute([$orgId, round($amount, 2), $userId !== '' ? $userId : null]);
    try {
        $up = $db->prepare('UPDATE coupons SET min_amount = ? WHERE org_id = ?');
        $up->execute([round($amount, 2), $orgId]);
    } catch (Throwable $e) {
        error_log('[coupons] sync min amount: ' . $e->getMessage());
    }
}

function couponsCanManageApiKey(array $tokenData): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($role, ['super_admin', 'admin', 'org'], true);
}

function couponsGenerateApiKeyRaw(): string
{
    $raw = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    return 'cpn_' . $raw;
}

function couponsResolveApiKeyOrgId(PDO $db, array $tokenData): string
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        $orgId = trim((string) ($_GET['org_id'] ?? ''));
        if ($orgId === '') {
            respond(['error' => 'Select an organization'], 400);
        }
        $st = $db->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        if (!$st->fetch(PDO::FETCH_ASSOC)) {
            respond(['error' => 'Organization not found'], 404);
        }
        return $orgId;
    }

    $orgId = trim((string) (getOrgId($tokenData) ?? ''));
    if ($orgId === '') {
        respond(['error' => 'No organization on this account'], 400);
    }
    return $orgId;
}

couponsEnsureSchema($db);
couponsEnsureApiKeySchema($db);
couponsEnsureMinAmountSchema($db);

$action = strtolower(trim((string) ($_GET['action'] ?? '')));

if ($action === 'min_amount') {
    $orgId = couponsResolveSettingsOrgId($db, $tokenData);

    if ($method === 'GET') {
        respond([
            'org_id' => $orgId,
            'min_amount' => couponsGetOrgMinAmount($db, $orgId),
            'can_edit' => couponsCanEditMinAmount($tokenData),
        ]);
    }

    if ($method === 'POST' || $method === 'PUT') {
        if (!couponsCanEditMinAmount($tokenData)) {
            respond(['error' => 'Only Admin or Super Admin can change the organization min amount'], 403);
        }
        $input = getInput();
        $minAmount = isset($input['min_amount']) ? (float) $input['min_amount'] : -1;
        if (!is_finite($minAmount) || $minAmount < 0) {
            respond(['error' => 'Min amount must be 0 or greater'], 400);
        }
        try {
            couponsSetOrgMinAmount($db, $orgId, $minAmount, $userId);
        } catch (Throwable $e) {
            error_log('[coupons] save min amount: ' . $e->getMessage());
            respond(['error' => 'Could not save min amount'], 500);
        }
        respond([
            'org_id' => $orgId,
            'min_amount' => round($minAmount, 2),
            'message' => 'Organization min amount saved',
        ]);
    }

    respond(['error' => 'Method not allowed'], 405);
}

if ($action === 'mailboxes') {
    if ($method !== 'GET') {
        respond(['error' => 'Method not allowed'], 405);
    }
    $orgId = couponsResolveSettingsOrgId($db, $tokenData);
    require_once __DIR__ . '/org_email_service.php';
    syncpediaEnsureOrgEmailSchema($db);
    try {
        $st = $db->prepare(
            'SELECT id, slot, label, email, from_name FROM org_smtp_accounts
             WHERE org_id = ? AND is_active = 1 ORDER BY slot ASC'
        );
        $st->execute([$orgId]);
        $rows = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $mbEmail = trim((string) ($row['email'] ?? ''));
            if ($mbEmail === '') {
                continue;
            }
            $rows[] = [
                'id' => (string) ($row['id'] ?? ''),
                'slot' => (int) ($row['slot'] ?? 0),
                'label' => trim((string) ($row['label'] ?? '')),
                'email' => $mbEmail,
                'from_name' => trim((string) ($row['from_name'] ?? '')),
            ];
        }
        respond(['data' => $rows]);
    } catch (Throwable $e) {
        error_log('[coupons] mailboxes: ' . $e->getMessage());
        respond(['error' => 'Could not load Email Setup accounts'], 500);
    }
}

if ($action === 'api_key') {
    if (!couponsCanManageApiKey($tokenData)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }
    $orgId = couponsResolveApiKeyOrgId($db, $tokenData);

    if ($method === 'GET') {
        try {
            $st = $db->prepare('SELECT api_key, updated_at FROM org_coupon_api_keys WHERE org_id = ? LIMIT 1');
            $st->execute([$orgId]);
            $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            error_log('[coupons] api key get: ' . $e->getMessage());
            respond(['error' => 'Could not load API key'], 500);
        }
        respond([
            'org_id' => $orgId,
            'api_key' => $row ? (string) ($row['api_key'] ?? '') : '',
            'updated_at' => $row ? ($row['updated_at'] ?? null) : null,
        ]);
    }

    if ($method === 'POST') {
        try {
            $plain = couponsGenerateApiKeyRaw();
            $st = $db->prepare(
                'INSERT INTO org_coupon_api_keys (org_id, api_key, created_by)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE api_key = VALUES(api_key), created_by = VALUES(created_by), updated_at = CURRENT_TIMESTAMP'
            );
            $st->execute([$orgId, $plain, $userId !== '' ? $userId : null]);
        } catch (Throwable $e) {
            error_log('[coupons] api key generate: ' . $e->getMessage());
            respond(['error' => 'Could not generate API key'], 500);
        }
        respond([
            'org_id' => $orgId,
            'api_key' => $plain,
            'message' => 'API key generated. Previous keys for this organization no longer work.',
        ]);
    }

    respond(['error' => 'Method not allowed'], 405);
}

if ($method === 'GET') {
    try {
        $scope = tenantCouponListScopeSql($db, $tokenData);
        $sql = 'SELECT c.*,
                       COALESCE(NULLIF(TRIM(u.full_name), \'\'), NULLIF(TRIM(u.email), \'\'), NULL) AS created_by_name,
                       COALESCE(NULLIF(TRIM(o.name), \'\'), NULL) AS org_name
                FROM coupons c
                LEFT JOIN users u ON u.id = c.created_by
                LEFT JOIN organizations o ON o.id = c.org_id
                WHERE 1=1' . $scope['sql'] . '
                ORDER BY c.created_at DESC
                LIMIT 1000';
        $st = $db->prepare($sql);
        $st->execute($scope['params']);
        respond(['data' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
    } catch (Throwable $e) {
        error_log('[coupons] list: ' . $e->getMessage());
        respond(['error' => 'Could not load coupons'], 500);
    }
}

if ($method === 'POST') {
    $input = getInput();
    $name = trim((string) ($input['name'] ?? ''));
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $phone = couponsNormalizePhone((string) ($input['phone'] ?? ''));
    $discount = isset($input['discount']) ? (float) $input['discount'] : -1;
    $leadId = trim((string) ($input['lead_id'] ?? ''));
    if ($leadId === '') {
        $leadId = null;
    }

    if ($name === '') {
        respond(['error' => 'Name is required'], 400);
    }
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'A valid email is required'], 400);
    }
    if (!is_finite($discount) || $discount <= 0) {
        respond(['error' => 'Discount must be greater than 0'], 400);
    }
    $expiresAt = couponsParseExpiresAt($input['expires_at'] ?? $input['expiry_date'] ?? '');

    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $requestedOrg = trim((string) ($_GET['org_id'] ?? $input['org_id'] ?? ''));
    if ($role === 'super_admin') {
        if ($requestedOrg === '') {
            respond(['error' => 'Select an organization'], 400);
        }
        $chk = $db->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
        $chk->execute([$requestedOrg]);
        if (!$chk->fetch(PDO::FETCH_ASSOC)) {
            respond(['error' => 'Organization not found'], 404);
        }
        $orgId = $requestedOrg;
    } else {
        $orgId = resolveWriteOrgId($db, $tokenData);
        if ($orgId === null || trim((string) $orgId) === '') {
            respond(['error' => 'No organization on this account'], 400);
        }
    }

    $wantSend = couponsWantSendEmail($input);
    $mailbox = null;
    if ($wantSend) {
        $smtpAccountId = trim((string) ($input['smtp_account_id'] ?? $input['from_account_id'] ?? ''));
        if ($smtpAccountId === '') {
            respond(['error' => 'Select an Email Setup mailbox to send from'], 400);
        }
        $mailbox = couponsLoadMailbox($db, (string) $orgId, $smtpAccountId);
        if ($mailbox === null) {
            respond(['error' => 'Choose a mailbox from Email Setup'], 400);
        }
    }

    $id = generateUUID();
    $minAmount = couponsGetOrgMinAmount($db, (string) $orgId);
    if (couponsCanEditMinAmount($tokenData) && array_key_exists('min_amount', $input) && $input['min_amount'] !== '' && $input['min_amount'] !== null) {
        $requestedMin = (float) $input['min_amount'];
        if (!is_finite($requestedMin) || $requestedMin < 0) {
            respond(['error' => 'Min amount must be 0 or greater'], 400);
        }
        $requestedMin = round($requestedMin, 2);
        if ($requestedMin !== $minAmount) {
            try {
                couponsSetOrgMinAmount($db, (string) $orgId, $requestedMin, $userId);
            } catch (Throwable $e) {
                error_log('[coupons] create min amount: ' . $e->getMessage());
                respond(['error' => 'Could not save min amount'], 500);
            }
            $minAmount = $requestedMin;
        }
    }

    $code = '';
    $preferred = couponsNormalizeCode((string) ($input['code'] ?? ''));
    if (!preg_match('/^[A-Z0-9]{8}$/', $preferred)) {
        $preferred = '';
    }
    try {
        $dup = $db->prepare('SELECT id FROM coupons WHERE org_id <=> ? AND code = ? LIMIT 1');
        $candidates = [];
        if ($preferred !== '') {
            $candidates[] = $preferred;
        }
        for ($attempt = 0; $attempt < 12; $attempt++) {
            $candidates[] = couponsGenerateCode();
        }
        foreach ($candidates as $try) {
            $dup->execute([$orgId, $try]);
            if (!$dup->fetchColumn()) {
                $code = $try;
                break;
            }
        }
        if ($code === '') {
            respond(['error' => 'Could not generate a unique coupon code'], 500);
        }
        $st = $db->prepare(
            'INSERT INTO coupons (id, org_id, lead_id, name, email, phone, discount, min_amount, code, expires_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $id,
            $orgId,
            $leadId,
            $name,
            $email,
            $phone,
            round($discount, 2),
            round($minAmount, 2),
            $code,
            $expiresAt,
            $userId !== '' ? $userId : null,
        ]);
    } catch (Throwable $e) {
        if (isMysqlDuplicateKey($e)) {
            respond(['error' => 'This coupon code already exists'], 409);
        }
        error_log('[coupons] create: ' . $e->getMessage());
        respond(['error' => 'Could not create coupon'], 500);
    }

    $emailSent = false;
    $emailError = null;
    if ($wantSend && is_array($mailbox)) {
        $inr = static function (float $n): string {
            return '₹' . number_format($n, 2);
        };
        $sendRes = couponsSendIssuedEmail($db, (string) $orgId, $mailbox, [
            'name' => $name,
            'email' => $email,
            'phone' => $phone,
            'code' => $code,
            'discount' => round($discount, 2),
            'min_amount' => round($minAmount, 2),
            'discount_fmt' => $inr(round($discount, 2)),
            'min_fmt' => $inr(round($minAmount, 2)),
            'expires_at' => $expiresAt,
        ]);
        $emailSent = !empty($sendRes['ok']);
        if (!$emailSent) {
            $emailError = (string) ($sendRes['error'] ?? 'Could not send coupon email');
        }
    }

    $row = $db->prepare('SELECT c.*, COALESCE(NULLIF(TRIM(u.full_name), \'\'), NULLIF(TRIM(u.email), \'\'), NULL) AS created_by_name FROM coupons c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ? LIMIT 1');
    $row->execute([$id]);
    respond([
        'data' => $row->fetch(PDO::FETCH_ASSOC),
        'message' => $emailSent ? 'Coupon created and emailed' : 'Coupon created',
        'email_sent' => $emailSent,
        'email_error' => $emailError,
    ], 201);
}

if ($method === 'DELETE') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $st = $db->prepare('SELECT * FROM coupons WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Coupon not found'], 404);
    }
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $isOwner = $userId !== '' && (string) ($row['created_by'] ?? '') === $userId;
    $canManage = in_array($role, ['super_admin', 'admin', 'org', 'manager', 'operational_manager'], true);
    if (!$isOwner && !$canManage) {
        respond(['error' => 'Insufficient permissions'], 403);
    }
    if (!$isOwner && $canManage && !tenantIsMasterView($tokenData)) {
        $orgId = resolveWriteOrgId($db, $tokenData);
        if ($orgId && (string) ($row['org_id'] ?? '') !== (string) $orgId && $role !== 'super_admin') {
            respond(['error' => 'Insufficient permissions'], 403);
        }
        if ($role === 'manager') {
            $ids = hierarchyGetVisibleUserIds($db, $tokenData);
            if (!in_array((string) ($row['created_by'] ?? ''), $ids, true)) {
                respond(['error' => 'Insufficient permissions'], 403);
            }
        }
    }
    try {
        $db->prepare('DELETE FROM coupons WHERE id = ?')->execute([$id]);
    } catch (Throwable $e) {
        error_log('[coupons] delete: ' . $e->getMessage());
        respond(['error' => 'Could not delete coupon'], 500);
    }
    respond(['ok' => true]);
}

respond(['error' => 'Method not allowed'], 405);
