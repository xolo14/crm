<?php
declare(strict_types=1);

/**
 * Org-admin Razorpay credential settings.
 * GET  /api/razorpay-settings.php
 * PUT  /api/razorpay-settings.php?action=setup
 * POST /api/razorpay-settings.php?action=clear
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/org_razorpay_service.php';
require_once __DIR__ . '/razorpay_service.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$input = getInput();
if (!is_array($input)) {
    $input = [];
}

function razorpaySettingsResolveOrg(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        $switched = trim((string) (getOrgId($tokenData) ?: ''));
        if ($switched !== '') {
            $st = $db->prepare('SELECT id, name, slug FROM organizations WHERE id = ? AND is_active = 1 LIMIT 1');
            $st->execute([$switched]);
            $org = $st->fetch(PDO::FETCH_ASSOC);
            if (is_array($org)) {
                return $org;
            }
        }
        $st = $db->query("SELECT id, name, slug FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
        $org = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
        if (!is_array($org)) {
            respond(['error' => 'Syncpedia organization not found — switch into an organization first'], 404);
        }
        return $org;
    }
    if (!in_array($role, ['admin', 'org'], true)) {
        respond(['error' => 'Only organization admins can manage Razorpay setup'], 403);
    }
    $orgId = trim((string) ($tokenData['org_id'] ?? ''));
    if ($orgId === '') {
        respond(['error' => 'Organization context required'], 403);
    }
    $st = $db->prepare('SELECT id, name, slug FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    $org = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($org)) {
        respond(['error' => 'Organization not found'], 404);
    }
    return $org;
}

function razorpaySettingsRespond(PDO $db, array $org): void
{
    $status = syncpediaOrgRazorpayPublicStatus($db, (string) $org['id']);
    $platformFallback = false;
    if (defined('RAZORPAY_KEY_ID') && defined('RAZORPAY_KEY_SECRET')) {
        $platformFallback = trim((string) RAZORPAY_KEY_ID) !== ''
            && trim((string) RAZORPAY_KEY_SECRET) !== ''
            && str_starts_with(trim((string) RAZORPAY_KEY_ID), 'rzp_');
    }
    respond([
        'data' => [
            'organization' => $org,
            'razorpay' => $status,
            'platform_fallback_available' => $platformFallback,
            'webhook_url_hint' => (function_exists('razorpayCallbackBase')
                ? rtrim(razorpayCallbackBase(), '/')
                : '') . '/api/payment-links.php?action=webhook',
        ],
    ]);
}

$org = razorpaySettingsResolveOrg($db, $tokenData);
syncpediaEnsureOrgRazorpaySchema($db);

if ($method === 'GET') {
    razorpaySettingsRespond($db, $org);
}

if ($method === 'PUT' && ($action === 'setup' || $action === '')) {
    $orgId = (string) $org['id'];
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $keyId = trim((string) ($input['key_id'] ?? $input['keyId'] ?? ''));
    $keySecret = trim((string) ($input['key_secret'] ?? $input['keySecret'] ?? ''));
    $webhookSecret = trim((string) ($input['webhook_secret'] ?? $input['webhookSecret'] ?? ''));
    $mode = strtolower(trim((string) ($input['mode'] ?? 'live')));
    if (!in_array($mode, ['live', 'test'], true)) {
        $mode = 'live';
    }
    $clearSecrets = !empty($input['clear_secrets']);

    $existing = $db->prepare('SELECT * FROM org_razorpay_config WHERE org_id = ? LIMIT 1');
    $existing->execute([$orgId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    $hadRow = is_array($row);

    if ($keyId === '' && $hadRow) {
        $keyId = trim((string) ($row['key_id'] ?? ''));
    }
    if ($keyId === '' || !str_starts_with($keyId, 'rzp_')) {
        respond(['error' => 'Razorpay Key ID is required and must start with rzp_'], 400);
    }

    $keyEnc = null;
    $whEnc = null;
    if ($keySecret !== '') {
        $keyEnc = syncpediaEncryptOrgRazorpaySecret($keySecret, $orgId, 'key');
    } elseif (!$hadRow || trim((string) ($row['key_secret_ciphertext'] ?? '')) === '') {
        respond(['error' => 'Razorpay Key Secret is required on first save'], 400);
    }
    if ($webhookSecret !== '') {
        $whEnc = syncpediaEncryptOrgRazorpaySecret($webhookSecret, $orgId, 'webhook');
    }

    if ($clearSecrets) {
        $db->prepare(
            'UPDATE org_razorpay_config SET
                key_secret_ciphertext = NULL, key_secret_nonce = NULL, key_secret_tag = NULL,
                webhook_secret_ciphertext = NULL, webhook_secret_nonce = NULL, webhook_secret_tag = NULL,
                is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE org_id = ?',
        )->execute([$userId !== '' ? $userId : null, $orgId]);
        razorpaySettingsRespond($db, $org);
    }

    if ($hadRow) {
        $sets = ['key_id = ?', 'mode = ?', 'is_active = 1', 'updated_by = ?', 'updated_at = CURRENT_TIMESTAMP'];
        $params = [$keyId, $mode, $userId !== '' ? $userId : null];
        if ($keyEnc !== null) {
            $sets[] = 'key_secret_ciphertext = ?';
            $sets[] = 'key_secret_nonce = ?';
            $sets[] = 'key_secret_tag = ?';
            $params[] = $keyEnc['ciphertext'];
            $params[] = $keyEnc['nonce'];
            $params[] = $keyEnc['tag'];
        }
        if ($whEnc !== null) {
            $sets[] = 'webhook_secret_ciphertext = ?';
            $sets[] = 'webhook_secret_nonce = ?';
            $sets[] = 'webhook_secret_tag = ?';
            $params[] = $whEnc['ciphertext'];
            $params[] = $whEnc['nonce'];
            $params[] = $whEnc['tag'];
        }
        $params[] = $orgId;
        $db->prepare('UPDATE org_razorpay_config SET ' . implode(', ', $sets) . ' WHERE org_id = ?')->execute($params);
    } else {
        if ($keyEnc === null) {
            respond(['error' => 'Razorpay Key Secret is required on first save'], 400);
        }
        $db->prepare(
            'INSERT INTO org_razorpay_config (
                org_id, key_id, key_secret_ciphertext, key_secret_nonce, key_secret_tag,
                webhook_secret_ciphertext, webhook_secret_nonce, webhook_secret_tag,
                mode, is_active, updated_by
            ) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
        )->execute([
            $orgId,
            $keyId,
            $keyEnc['ciphertext'],
            $keyEnc['nonce'],
            $keyEnc['tag'],
            $whEnc['ciphertext'] ?? null,
            $whEnc['nonce'] ?? null,
            $whEnc['tag'] ?? null,
            $mode,
            $userId !== '' ? $userId : null,
        ]);
    }

    razorpaySettingsRespond($db, $org);
}

if ($method === 'POST' && $action === 'clear') {
    $orgId = (string) $org['id'];
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $db->prepare(
        'UPDATE org_razorpay_config SET
            key_id = \'\',
            key_secret_ciphertext = NULL, key_secret_nonce = NULL, key_secret_tag = NULL,
            webhook_secret_ciphertext = NULL, webhook_secret_nonce = NULL, webhook_secret_tag = NULL,
            is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE org_id = ?',
    )->execute([$userId !== '' ? $userId : null, $orgId]);
    // If no row, insert inactive empty
    $chk = $db->prepare('SELECT org_id FROM org_razorpay_config WHERE org_id = ? LIMIT 1');
    $chk->execute([$orgId]);
    if (!$chk->fetch()) {
        $db->prepare(
            'INSERT INTO org_razorpay_config (org_id, key_id, is_active, updated_by) VALUES (?, \'\', 0, ?)',
        )->execute([$orgId, $userId !== '' ? $userId : null]);
    }
    razorpaySettingsRespond($db, $org);
}

respond(['error' => 'Method not allowed'], 405);
