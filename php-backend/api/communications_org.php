<?php
/**
 * Org-scoped WhatsApp helpers (Meta Cloud API).
 */
require_once __DIR__ . '/lib/MetaWhatsApp.php';

function commEnsureOrgWhatsappTable(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $migrationCandidates = [
        __DIR__ . '/../migrations/org_whatsapp_config_2026_06_18.sql',
        __DIR__ . '/../../php-backend/migrations/org_whatsapp_config_2026_06_18.sql',
    ];
    $migration = null;
    foreach ($migrationCandidates as $candidate) {
        if (is_readable($candidate)) {
            $migration = $candidate;
            break;
        }
    }
    if ($migration) {
        $sql = file_get_contents($migration);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt === '' || stripos($stmt, 'CREATE TABLE') === false) {
                continue;
            }
            try {
                $db->exec($stmt);
            } catch (Throwable $e) {
            }
        }
    }
    $done = true;
}

function commNormalizeWhatsappProvider(?string $provider): string
{
    return 'meta';
}

function commAssertOrgAccess(array $tokenData, ?string $orgId): void
{
    if (!$orgId) {
        respond(['error' => 'Organization required'], 400);
    }
    $role = strtolower(trim($tokenData['role'] ?? ''));
    if ($role === 'superadmin') {
        $role = 'super_admin';
    }
    if ($role === 'super_admin') {
        return;
    }
    $userOrg = $tokenData['org_id'] ?? null;
    if ($userOrg !== $orgId) {
        respond(['error' => 'Forbidden — wrong organization'], 403);
    }
}

/** @return array<string,mixed> */
function commLoadOrgConfig(PDO $db, string $orgId): array
{
    commEnsureOrgWhatsappTable($db);
    $stmt = $db->prepare('SELECT * FROM org_whatsapp_config WHERE org_id = ? LIMIT 1');
    $stmt->execute([$orgId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : [];
}

function commOrgWhatsappProvider(PDO $db, string $orgId): string
{
    return 'meta';
}

function commMetaClientForOrg(PDO $db, string $orgId): MetaWhatsApp
{
    $cfg = commLoadOrgConfig($db, $orgId);
    return MetaWhatsApp::fromPlatformConfig($cfg);
}

function commOrgWebhookUrl(): string
{
    $base = (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '')
        ? rtrim((string) CRM_PUBLIC_URL, '/')
        : syncpediaPublicSiteUrl();
    return $base . '/api/whatsapp/webhook';
}

/** Find org_id from Meta phone_number_id or WABA id (webhook routing). */
function commResolveOrgFromMetaIds(PDO $db, ?string $phoneNumberId, ?string $wabaId): ?string
{
    commEnsureOrgWhatsappTable($db);
    if ($phoneNumberId) {
        $st = $db->prepare('SELECT org_id FROM org_whatsapp_config WHERE phone_number_id = ? AND is_active = 1 LIMIT 1');
        $st->execute([$phoneNumberId]);
        $org = $st->fetchColumn();
        if ($org) {
            return (string) $org;
        }
    }
    if ($wabaId) {
        $st = $db->prepare('SELECT org_id FROM org_whatsapp_config WHERE waba_id = ? AND is_active = 1 LIMIT 1');
        $st->execute([$wabaId]);
        $org = $st->fetchColumn();
        if ($org) {
            return (string) $org;
        }
    }
    return null;
}

function commMaskKey(?string $key): ?string
{
    if ($key === null || $key === '') {
        return $key;
    }
    $len = strlen($key);
    if ($len <= 8) {
        return str_repeat('*', $len);
    }
    return substr($key, 0, 4) . str_repeat('*', max(4, $len - 8)) . substr($key, -4);
}

function commFormatOrgConfigForResponse(array $row, bool $includeSecrets): array
{
    $apiSet = !empty($row['api_key']);
    $secretSet = !empty($row['app_secret']);
    $tokenSet = !empty($row['webhook_verify_token']);
    // Never return raw secrets — even to privileged callers.
    unset($row['api_key'], $row['app_secret'], $row['webhook_verify_token']);
    $row['api_key_set'] = $apiSet;
    $row['app_secret_set'] = $secretSet;
    $row['webhook_verify_token_set'] = $tokenSet;
    if ($includeSecrets) {
        $row['api_key_masked'] = $apiSet ? '••••set••••' : '';
    }
    $row['provider'] = 'meta';
    $row['webhook_url_suggested'] = commOrgWebhookUrl();
    return $row;
}

function commTestWhatsappConnectionForOrg(PDO $db, string $orgId, array $overrides = []): array
{
    $cfg = commLoadOrgConfig($db, $orgId);
    if ($cfg === []) {
        $cfg = ['org_id' => $orgId, 'provider' => 'meta'];
    }
    foreach (['api_key', 'app_secret', 'phone_number_id', 'waba_id', 'graph_api_version'] as $field) {
        if (isset($overrides[$field]) && trim((string) $overrides[$field]) !== '') {
            $cfg[$field] = trim((string) $overrides[$field]);
        }
    }

    $meta = MetaWhatsApp::fromPlatformConfig($cfg);
    if (!$meta->isConfigured()) {
        return ['ok' => false, 'error' => 'Meta access token and Phone Number ID are required'];
    }
    $test = $meta->testConnection();
    if ($test['ok']) {
        $test['provider'] = 'meta';
    }
    return $test;
}

/**
 * Finish Meta Embedded Signup: exchange code, persist org config, verify connection.
 *
 * @return array{ok:bool,error?:string,data?:array}
 */
function commCompleteEmbeddedSignup(PDO $db, string $orgId, string $userId, string $code, string $phoneNumberId, string $wabaId, string $appSecret): array
{
    $appId = commResolveMetaAppId($db);
    if ($appId === '') {
        return ['ok' => false, 'error' => 'Meta App ID is not configured. Ask your platform admin to complete Meta Partner setup.'];
    }
    if ($appSecret === '') {
        return ['ok' => false, 'error' => 'Meta App Secret is not configured on the server.'];
    }

    $exchange = commExchangeEmbeddedSignupCode($appId, $appSecret, $code);
    if (!$exchange['ok']) {
        return ['ok' => false, 'error' => $exchange['error'] ?? 'Token exchange failed'];
    }
    $accessToken = (string) $exchange['access_token'];

    $meta = new MetaWhatsApp([
        'api_key' => $accessToken,
        'phone_number_id' => $phoneNumberId,
        'waba_id' => $wabaId,
        'app_secret' => $appSecret,
        'graph_api_version' => 'v21.0',
    ]);

    $register = $meta->registerCloudApiPhone();
    $phoneRegistered = $register['ok'];
    if (!$register['ok']) {
        $regErr = strtolower((string) ($register['error'] ?? ''));
        $phoneRegistered = str_contains($regErr, 'already') || str_contains($regErr, 'registered');
        if (!$phoneRegistered) {
            error_log('[embedded_signup] register phone: ' . ($register['error'] ?? 'unknown'));
        }
    }

    $subscribe = $meta->subscribeAppToWaba();
    $webhooksSubscribed = $subscribe['ok'];
    if (!$subscribe['ok']) {
        error_log('[embedded_signup] subscribe waba: ' . ($subscribe['error'] ?? 'unknown'));
    }

    $test = $meta->testConnection();
    if (!$test['ok']) {
        return ['ok' => false, 'error' => $test['error'] ?? 'Connected to Meta but could not verify the phone number'];
    }

    $businessPhone = (string) ($test['display_phone_number'] ?? '');
    $existing = commLoadOrgConfig($db, $orgId);
    $verifyToken = trim((string) ($existing['webhook_verify_token'] ?? ''));
    if ($verifyToken === '') {
        $verifyToken = bin2hex(random_bytes(16));
    }

    if ($existing !== []) {
        $db->prepare(
            'UPDATE org_whatsapp_config SET provider = ?, api_key = ?, app_secret = ?, phone_number_id = ?, business_phone = ?, waba_id = ?, webhook_verify_token = ?, graph_api_version = ?, connection_status = ?, is_active = 1, configured_by = ? WHERE id = ?',
        )->execute([
            'meta',
            $accessToken,
            $appSecret,
            $phoneNumberId,
            $businessPhone !== '' ? $businessPhone : ($existing['business_phone'] ?? null),
            $wabaId,
            $verifyToken,
            'v21.0',
            'connected',
            $userId,
            $existing['id'],
        ]);
    } else {
        $id = generateUUID();
        $db->prepare(
            'INSERT INTO org_whatsapp_config (id, org_id, provider, api_key, app_secret, phone_number_id, business_phone, waba_id, webhook_verify_token, graph_api_version, connection_status, is_active, configured_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )->execute([
            $id,
            $orgId,
            'meta',
            $accessToken,
            $appSecret,
            $phoneNumberId,
            $businessPhone !== '' ? $businessPhone : null,
            $wabaId,
            $verifyToken,
            'v21.0',
            'connected',
            1,
            $userId,
        ]);
    }

    return [
        'ok' => true,
        'data' => [
            'display_phone_number' => $test['display_phone_number'] ?? null,
            'verified_name' => $test['verified_name'] ?? null,
            'phone_number_id' => $phoneNumberId,
            'waba_id' => $wabaId,
            'webhook_verify_token' => $verifyToken,
            'webhook_url_suggested' => commOrgWebhookUrl(),
            'onboarding' => [
                'phone_registered' => $phoneRegistered,
                'webhooks_subscribed' => $webhooksSubscribed,
                'embedded_signup_version' => 'v4',
            ],
        ],
    ];
}

/**
 * Send via org's Meta WhatsApp Cloud API.
 * @param array<int,string> $bodyParams
 */
function commSendViaOrgProvider(PDO $db, string $orgId, string $phone, array $template, array $bodyParams = [], ?string $callbackData = null): array
{
    $cfg = commLoadOrgConfig($db, $orgId);
    if ($cfg === [] || !(int) ($cfg['is_active'] ?? 0)) {
        return ['ok' => false, 'error' => 'Your organization has not connected WhatsApp yet. Ask your admin to set it up in Communications → WhatsApp Setup.'];
    }

    $templateName = trim((string) ($template['provider_template_id'] ?? ''));
    if ($templateName === '') {
        $templateName = MetaWhatsApp::sanitizeTemplateName((string) ($template['name'] ?? ''));
    }
    $lang = (string) ($template['language'] ?? 'en');

    $meta = commMetaClientForOrg($db, $orgId);
    if (!$meta->isConfigured()) {
        return ['ok' => false, 'error' => 'Meta WhatsApp credentials incomplete (access token + phone number ID required)'];
    }
    return $meta->sendTemplateMessage($phone, $templateName, $lang, $bodyParams);
}

/** Send a session text message (Meta Cloud API — 24h customer care window). */
function commSendTextViaOrgProvider(PDO $db, string $orgId, string $phone, string $text): array
{
    $cfg = commLoadOrgConfig($db, $orgId);
    if ($cfg === [] || !(int) ($cfg['is_active'] ?? 0)) {
        return ['ok' => false, 'error' => 'Your organization has not connected WhatsApp yet.'];
    }

    $meta = commMetaClientForOrg($db, $orgId);
    if (!$meta->isConfigured()) {
        return ['ok' => false, 'error' => 'Meta access token and Phone Number ID are required'];
    }
    return $meta->sendTextMessage($phone, $text);
}

function commSyncMetaTemplatesForOrg(PDO $db, string $orgId, string $userId): array
{
    $meta = commMetaClientForOrg($db, $orgId);
    $list = $meta->listMessageTemplates(200);
    if (!$list['ok']) {
        return $list;
    }
    $imported = 0;
    $updated = 0;
    foreach ($list['templates'] as $mt) {
        $name = (string) ($mt['name'] ?? '');
        if ($name === '') {
            continue;
        }
        $status = strtolower((string) ($mt['status'] ?? ''));
        $crmStatus = $status === 'approved' ? 'approved' : ($status === 'rejected' ? 'rejected' : 'pending_approval');
        $body = MetaWhatsApp::extractBodyFromComponents($mt['components'] ?? []);
        $paramCount = MetaWhatsApp::countBodyParamsFromComponents($mt['components'] ?? []);
        $variablesJson = null;
        if ($paramCount > 0) {
            $labels = [];
            for ($i = 1; $i <= $paramCount; $i++) {
                $labels[] = '{{' . $i . '}}';
            }
            $variablesJson = json_encode($labels);
        }
        $lang = (string) ($mt['language'] ?? 'en');
        $cat = strtolower((string) ($mt['category'] ?? 'marketing'));
        $metaId = (string) ($mt['id'] ?? '');

        $existing = $db->prepare('SELECT id FROM whatsapp_message_templates WHERE org_id = ? AND (provider_template_id = ? OR name = ?) LIMIT 1');
        $existing->execute([$orgId, $name, $name]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $db->prepare('UPDATE whatsapp_message_templates SET body = ?, language = ?, category = ?, status = ?, meta_template_id = ?, meta_status = ?, provider_template_id = ?, variables = ? WHERE id = ?')
                ->execute([$body ?: $name, $lang, $cat, $crmStatus, $metaId, strtoupper($status), $name, $variablesJson, $row['id']]);
            $updated++;
        } else {
            $id = generateUUID();
            $db->prepare('INSERT INTO whatsapp_message_templates (id, org_id, name, category, language, body, variables, provider_template_id, meta_template_id, meta_status, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $orgId, $name, $cat, $lang, $body ?: $name, $variablesJson, $name, $metaId, strtoupper($status), $crmStatus, $userId]);
            $imported++;
        }
    }
    return ['ok' => true, 'imported' => $imported, 'updated' => $updated, 'total' => count($list['templates'])];
}
