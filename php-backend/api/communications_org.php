<?php
/**
 * Org-scoped WhatsApp helpers (Meta Cloud API or Interakt).
 */
require_once __DIR__ . '/lib/MetaWhatsApp.php';
require_once __DIR__ . '/lib/InteraktWhatsApp.php';

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
    $p = strtolower(trim((string) $provider));
    if ($p === 'interakt') {
        return 'interakt';
    }
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
    $cfg = commLoadOrgConfig($db, $orgId);
    return commNormalizeWhatsappProvider($cfg['provider'] ?? 'meta');
}

function commMetaClientForOrg(PDO $db, string $orgId): MetaWhatsApp
{
    $cfg = commLoadOrgConfig($db, $orgId);
    return MetaWhatsApp::fromPlatformConfig($cfg);
}

function commInteraktClientForOrg(PDO $db, string $orgId): InteraktWhatsApp
{
    $cfg = commLoadOrgConfig($db, $orgId);
    return InteraktWhatsApp::fromPlatformConfig($cfg);
}

function commOrgWebhookUrl(): string
{
    if (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '') {
        return rtrim((string) CRM_PUBLIC_URL, '/') . '/api/whatsapp_webhook.php';
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host . '/api/whatsapp_webhook.php';
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

/** Resolve org for Interakt webhooks. */
function commResolveOrgFromInteraktWebhook(PDO $db, ?string $providerMessageId, ?string $callbackData): ?string
{
    commEnsureOrgWhatsappTable($db);
    if ($callbackData) {
        $st = $db->prepare('SELECT org_id FROM comm_whatsapp_messages WHERE id = ? LIMIT 1');
        $st->execute([$callbackData]);
        $org = $st->fetchColumn();
        if ($org) {
            return (string) $org;
        }
    }
    if ($providerMessageId) {
        $st = $db->prepare('SELECT org_id FROM comm_whatsapp_messages WHERE provider_message_id = ? LIMIT 1');
        $st->execute([$providerMessageId]);
        $org = $st->fetchColumn();
        if ($org) {
            return (string) $org;
        }
    }
    $st = $db->query("SELECT org_id FROM org_whatsapp_config WHERE provider = 'interakt' AND is_active = 1 ORDER BY updated_at DESC LIMIT 1");
    $org = $st ? $st->fetchColumn() : false;
    return $org ? (string) $org : null;
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
    if (!$includeSecrets) {
        unset($row['api_key'], $row['app_secret'], $row['webhook_verify_token']);
        $row['api_key_set'] = !empty($row['api_key']);
        $row['app_secret_set'] = !empty($row['app_secret']);
    } else {
        $row['api_key_masked'] = commMaskKey($row['api_key'] ?? '');
        $row['app_secret_set'] = !empty($row['app_secret']);
    }
    $row['provider'] = commNormalizeWhatsappProvider($row['provider'] ?? 'meta');
    $row['webhook_url_suggested'] = commOrgWebhookUrl();
    return $row;
}

function commTestWhatsappConnectionForOrg(PDO $db, string $orgId): array
{
    $provider = commOrgWhatsappProvider($db, $orgId);
    if ($provider === 'interakt') {
        $client = commInteraktClientForOrg($db, $orgId);
        if (!$client->isConfigured()) {
            return ['ok' => false, 'error' => 'Interakt API key is required'];
        }
        return $client->testConnection();
    }

    $meta = commMetaClientForOrg($db, $orgId);
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
 * Send via org's WhatsApp provider (Meta or Interakt).
 * @param array<int,string> $bodyParams
 */
function commSendViaOrgProvider(PDO $db, string $orgId, string $phone, array $template, array $bodyParams = [], ?string $callbackData = null): array
{
    $cfg = commLoadOrgConfig($db, $orgId);
    if ($cfg === [] || !(int) ($cfg['is_active'] ?? 0)) {
        return ['ok' => false, 'error' => 'Your organization has not connected WhatsApp yet. Ask your admin to set it up in Communications → WhatsApp Setup.'];
    }

    $provider = commNormalizeWhatsappProvider($cfg['provider'] ?? 'meta');
    $templateName = trim((string) ($template['provider_template_id'] ?? ''));
    if ($templateName === '') {
        $templateName = MetaWhatsApp::sanitizeTemplateName((string) ($template['name'] ?? ''));
    }
    $lang = (string) ($template['language'] ?? 'en');

    if ($provider === 'interakt') {
        $interakt = commInteraktClientForOrg($db, $orgId);
        if (!$interakt->isConfigured()) {
            return ['ok' => false, 'error' => 'Interakt API key is missing. Add it in WhatsApp Setup.'];
        }
        return $interakt->sendTemplateMessage($phone, $templateName, $lang, $bodyParams, [], $callbackData);
    }

    $meta = commMetaClientForOrg($db, $orgId);
    if (!$meta->isConfigured()) {
        return ['ok' => false, 'error' => 'Meta WhatsApp credentials incomplete (access token + phone number ID required)'];
    }
    return $meta->sendTemplateMessage($phone, $templateName, $lang, $bodyParams);
}

function commSyncMetaTemplatesForOrg(PDO $db, string $orgId, string $userId): array
{
    if (commOrgWhatsappProvider($db, $orgId) === 'interakt') {
        return [
            'ok' => false,
            'error' => 'Template sync from API is not available for Interakt. Create templates in Interakt dashboard, then add matching code names in CRM and mark them approved.',
        ];
    }

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
        $lang = (string) ($mt['language'] ?? 'en');
        $cat = strtolower((string) ($mt['category'] ?? 'marketing'));
        $metaId = (string) ($mt['id'] ?? '');

        $existing = $db->prepare('SELECT id FROM whatsapp_message_templates WHERE org_id = ? AND (provider_template_id = ? OR name = ?) LIMIT 1');
        $existing->execute([$orgId, $name, $name]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $db->prepare('UPDATE whatsapp_message_templates SET body = ?, language = ?, category = ?, status = ?, meta_template_id = ?, meta_status = ?, provider_template_id = ? WHERE id = ?')
                ->execute([$body ?: $name, $lang, $cat, $crmStatus, $metaId, strtoupper($status), $name, $row['id']]);
            $updated++;
        } else {
            $id = generateUUID();
            $db->prepare('INSERT INTO whatsapp_message_templates (id, org_id, name, category, language, body, provider_template_id, meta_template_id, meta_status, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $orgId, $name, $cat, $lang, $body ?: $name, $name, $metaId, strtoupper($status), $crmStatus, $userId]);
            $imported++;
        }
    }
    return ['ok' => true, 'imported' => $imported, 'updated' => $updated, 'total' => count($list['templates'])];
}
