<?php
/**
 * Public coupons for partner websites.
 *
 * GET /api/public-coupons.php
 *   Lists unused, unexpired coupons. Optional ?code= looks up one code.
 * POST /api/public-coupons.php
 *   Redeem a code (single use). Body: { "code": "XXXX" }
 *
 * Auth (header only — either one):
 *   X-Coupon-Api-Key: <org coupon API key>
 *   Authorization: Bearer <org coupon API key>
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Coupon-Api-Key');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/helpers.php';

syncpediaSecurityHeaders();
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Coupon-Api-Key');
header('Content-Type: application/json; charset=UTF-8');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

function publicCouponsProvidedKey(): string
{
    $candidates = [
        trim((string) ($_SERVER['HTTP_X_COUPON_API_KEY'] ?? '')),
        trim((string) ($_SERVER['HTTP_X_COUPON_APIKEY'] ?? '')),
    ];
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    if (is_array($headers)) {
        foreach ($headers as $name => $value) {
            if (strcasecmp((string) $name, 'X-Coupon-Api-Key') === 0 || strcasecmp((string) $name, 'X-Coupon-ApiKey') === 0) {
                $candidates[] = trim((string) $value);
            }
        }
    }
    foreach ($candidates as $key) {
        if ($key !== '') {
            return $key;
        }
    }

    $auth = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (is_array($headers)) {
        $auth = (string) ($headers['Authorization'] ?? $headers['authorization'] ?? '');
    }
    if (preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $auth, $m)) {
        return trim($m[1]);
    }
    return '';
}

$providedKey = publicCouponsProvidedKey();
if ($providedKey === '') {
    respond(['error' => 'Missing X-Coupon-Api-Key (or Authorization Bearer) header'], 401);
}

syncpediaRateLimitConsume('public_coupons_get', 600, 900);

$db = (new Database())->getConnection();
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
    error_log('[public-coupons] schema: ' . $e->getMessage());
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
    error_log('[public-coupons] coupons schema: ' . $e->getMessage());
}
if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'expires_at')) {
    try {
        $db->exec('ALTER TABLE coupons ADD COLUMN expires_at DATE DEFAULT NULL');
    } catch (Throwable $e) {
        error_log('[public-coupons] expires_at column: ' . $e->getMessage());
    }
}

if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'phone')) {
    try {
        $db->exec('ALTER TABLE coupons ADD COLUMN phone VARCHAR(32) DEFAULT NULL');
    } catch (Throwable $e) {
        error_log('[public-coupons] phone column: ' . $e->getMessage());
    }
}

if (function_exists('syncpediaColumnExists') && !syncpediaColumnExists($db, 'coupons', 'used_at')) {
    try {
        $db->exec('ALTER TABLE coupons ADD COLUMN used_at DATETIME DEFAULT NULL');
    } catch (Throwable $e) {
        error_log('[public-coupons] used_at column: ' . $e->getMessage());
    }
}

function publicCouponAnnotate(array $item): array
{
    $item['discount'] = isset($item['discount']) ? (float) $item['discount'] : 0.0;
    $item['min_amount'] = isset($item['min_amount']) ? (float) $item['min_amount'] : 0.0;
    $exp = isset($item['expires_at']) ? substr((string) $item['expires_at'], 0, 10) : '';
    $item['expires_at'] = $exp !== '' ? $exp : null;
    $usedRaw = trim((string) ($item['used_at'] ?? ''));
    $used = $usedRaw !== '';
    $expired = $exp !== '' && $exp < date('Y-m-d');
    $item['single_use'] = true;
    $item['used'] = $used;
    $item['used_at'] = $used ? $usedRaw : null;
    $item['expired'] = $expired;
    $item['valid'] = !$used && !$expired;
    return $item;
}

$st = $db->prepare('SELECT org_id, api_key FROM org_coupon_api_keys WHERE api_key = ? LIMIT 1');
$st->execute([$providedKey]);
$row = $st->fetch(PDO::FETCH_ASSOC);
$stored = $row ? (string) ($row['api_key'] ?? '') : '';
$keyOk = false;
try {
    $keyOk = $stored !== '' && hash_equals($stored, $providedKey);
} catch (Throwable $e) {
    $keyOk = false;
}
if (!$keyOk) {
    respond(['error' => 'Invalid coupon API key'], 401);
}

$orgId = trim((string) ($row['org_id'] ?? ''));
if ($orgId === '') {
    respond(['error' => 'Invalid coupon API key'], 401);
}

$code = strtoupper(preg_replace('/[^A-Z0-9_-]/', '', strtoupper(trim((string) ($_GET['code'] ?? '')))) ?? '');

if ($method === 'POST') {
    $input = function_exists('getInput') ? getInput() : [];
    if (!is_array($input)) {
        $input = [];
    }
    $code = strtoupper(preg_replace('/[^A-Z0-9_-]/', '', strtoupper(trim((string) ($input['code'] ?? $_GET['code'] ?? $code)))) ?? '');
    if ($code === '') {
        respond(['error' => 'Coupon code is required'], 400);
    }
    try {
        $st = $db->prepare(
            'SELECT id, name, email, phone, discount, min_amount, code, created_at, expires_at, used_at
             FROM coupons WHERE org_id = ? AND code = ? LIMIT 1'
        );
        $st->execute([$orgId, $code]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('[public-coupons] redeem lookup: ' . $e->getMessage());
        respond(['error' => 'Could not redeem coupon'], 500);
    }
    if (!$row) {
        respond(['error' => 'Coupon not found', 'valid' => false], 404);
    }
    $annotated = publicCouponAnnotate($row);
    if (!empty($annotated['expired'])) {
        respond(['error' => 'This coupon has expired', 'valid' => false, 'data' => $annotated], 410);
    }
    if (!empty($annotated['used'])) {
        respond(['error' => 'This coupon has already been used', 'valid' => false, 'data' => $annotated], 409);
    }
    try {
        $up = $db->prepare(
            'UPDATE coupons SET used_at = NOW()
             WHERE id = ? AND org_id = ? AND used_at IS NULL
               AND (expires_at IS NULL OR expires_at >= CURDATE())'
        );
        $up->execute([(string) $row['id'], $orgId]);
        if ($up->rowCount() < 1) {
            respond(['error' => 'This coupon has already been used', 'valid' => false], 409);
        }
        $st = $db->prepare(
            'SELECT id, name, email, phone, discount, min_amount, code, created_at, expires_at, used_at
             FROM coupons WHERE id = ? LIMIT 1'
        );
        $st->execute([(string) $row['id']]);
        $fresh = $st->fetch(PDO::FETCH_ASSOC) ?: $row;
    } catch (Throwable $e) {
        error_log('[public-coupons] redeem: ' . $e->getMessage());
        respond(['error' => 'Could not redeem coupon'], 500);
    }
    respond([
        'ok' => true,
        'message' => 'Coupon used. This code cannot be used again.',
        'data' => publicCouponAnnotate(is_array($fresh) ? $fresh : $row),
    ]);
}

try {
    if ($code !== '') {
        $sql = 'SELECT id, name, email, phone, discount, min_amount, code, created_at, expires_at, used_at
                FROM coupons WHERE org_id = ? AND code = ? LIMIT 1';
        $params = [$orgId, $code];
    } else {
        $sql = 'SELECT id, name, email, phone, discount, min_amount, code, created_at, expires_at, used_at
                FROM coupons
                WHERE org_id = ?
                  AND used_at IS NULL
                  AND (expires_at IS NULL OR expires_at >= CURDATE())
                ORDER BY created_at DESC
                LIMIT 5000';
        $params = [$orgId];
    }

    $list = $db->prepare($sql);
    $list->execute($params);
    $items = $list->fetchAll(PDO::FETCH_ASSOC) ?: [];
} catch (Throwable $e) {
    error_log('[public-coupons] list: ' . $e->getMessage());
    respond(['error' => 'Could not list coupons'], 500);
}

if ($code !== '') {
    if (!$items) {
        respond(['error' => 'Coupon not found', 'valid' => false], 404);
    }
    $one = publicCouponAnnotate($items[0]);
    respond([
        'org_id' => $orgId,
        'count' => 1,
        'data' => [$one],
        'valid' => !empty($one['valid']),
        'used' => !empty($one['used']),
        'expired' => !empty($one['expired']),
        'single_use' => true,
    ]);
}

foreach ($items as &$item) {
    $item = publicCouponAnnotate($item);
}
unset($item);

respond([
    'org_id' => $orgId,
    'count' => count($items),
    'data' => $items,
]);
