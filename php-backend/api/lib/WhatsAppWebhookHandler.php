<?php
/**
 * Meta WhatsApp webhook handler.
 * Canonical URL: /api/whatsapp/webhook (also /api/whatsapp_webhook.php)
 */
require_once __DIR__ . '/WhatsAppInbox.php';

class WhatsAppWebhookHandler
{
    public static function verifyToken(): string
    {
        $env = getenv('WHATSAPP_VERIFY_TOKEN');
        if (is_string($env) && trim($env) !== '') {
            return trim($env);
        }
        if (defined('WHATSAPP_VERIFY_TOKEN') && WHATSAPP_VERIFY_TOKEN !== '') {
            return (string) WHATSAPP_VERIFY_TOKEN;
        }
        if (defined('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN') && META_WHATSAPP_WEBHOOK_VERIFY_TOKEN !== '') {
            return (string) META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        }
        return '';
    }

    public static function appSecret(): string
    {
        $env = getenv('WHATSAPP_APP_SECRET');
        if (is_string($env) && trim($env) !== '') {
            return trim($env);
        }
        if (defined('WHATSAPP_APP_SECRET') && WHATSAPP_APP_SECRET !== '') {
            return (string) WHATSAPP_APP_SECRET;
        }
        if (defined('META_WHATSAPP_APP_SECRET') && META_WHATSAPP_APP_SECRET !== '') {
            return (string) META_WHATSAPP_APP_SECRET;
        }
        return '';
    }

    public static function handleGet(PDO $db): void
    {
        $mode = (string) ($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '');
        $token = (string) ($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '');
        $challenge = (string) ($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '');

        if ($mode === 'subscribe' && self::tokenMatches($db, $token)) {
            header('Content-Type: text/plain; charset=UTF-8');
            http_response_code(200);
            echo $challenge;
            exit;
        }

        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'Forbidden';
        exit;
    }

    private static function tokenMatches(PDO $db, string $token): bool
    {
        if ($token === '') {
            return false;
        }
        $expected = self::verifyToken();
        if ($expected !== '' && hash_equals($expected, $token)) {
            return true;
        }
        commEnsureOrgWhatsappTable($db);
        try {
            $stmt = $db->prepare('SELECT id FROM org_whatsapp_config WHERE webhook_verify_token = ? AND is_active = 1 LIMIT 1');
            $stmt->execute([$token]);
            return (bool) $stmt->fetchColumn();
        } catch (Throwable $e) {
            return false;
        }
    }

    public static function handlePost(PDO $db): void
    {
        $raw = file_get_contents('php://input') ?: '';
        $payload = json_decode($raw, true);

        if (!self::verifyMetaSignature($db, $raw, $payload)) {
            WhatsAppInbox::logWebhook($db, 'signature_failed', null, null, null, '403', 'Invalid X-Hub-Signature-256', null);
            http_response_code(403);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode(['error' => 'Invalid signature']);
            exit;
        }

        if (!is_array($payload)) {
            http_response_code(400);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode(['error' => 'Invalid JSON body']);
            exit;
        }

        self::ackFast();
        self::processMeta($db, $payload);
    }

    private static function ackFast(): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => true]);
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        } else {
            if (ob_get_level() > 0) {
                @ob_end_flush();
            }
            @flush();
        }
    }

    private static function verifyMetaSignature(PDO $db, string $raw, ?array $payload): bool
    {
        $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? null;
        if (!is_string($sig) || $sig === '') {
            return false;
        }

        $phoneNumberId = null;
        $wabaId = null;
        if (is_array($payload)) {
            foreach ($payload['entry'] ?? [] as $entry) {
                $wabaId = (string) ($entry['id'] ?? '');
                foreach ($entry['changes'] ?? [] as $change) {
                    $phoneNumberId = (string) (($change['value']['metadata']['phone_number_id'] ?? '') ?: $phoneNumberId);
                }
            }
        }

        $orgCfg = self::findOrgConfig($db, $phoneNumberId, $wabaId);
        if ($orgCfg) {
            $meta = MetaWhatsApp::fromPlatformConfig($orgCfg);
            return $meta->verifyWebhookSignature($raw, $sig);
        }

        $secret = self::appSecret();
        if ($secret === '') {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
        return hash_equals($expected, $sig);
    }

    /** @return array<string,mixed>|null */
    private static function findOrgConfig(PDO $db, ?string $phoneNumberId, ?string $wabaId): ?array
    {
        $orgId = commResolveOrgFromMetaIds($db, $phoneNumberId, $wabaId);
        if (!$orgId) {
            return null;
        }
        $cfg = commLoadOrgConfig($db, $orgId);
        return $cfg !== [] ? $cfg : null;
    }

    private static function processMeta(PDO $db, array $payload): void
    {
        foreach ($payload['entry'] ?? [] as $entry) {
            $wabaId = (string) ($entry['id'] ?? '');
            foreach ($entry['changes'] ?? [] as $change) {
                $value = $change['value'] ?? [];
                $phoneNumberId = (string) ($value['metadata']['phone_number_id'] ?? '');
                $orgId = commResolveOrgFromMetaIds($db, $phoneNumberId, $wabaId);
                if (!$orgId) {
                    WhatsAppInbox::logWebhook($db, 'unknown_org', null, null, null, 'skip', 'No org for phone_number_id', $value);
                    continue;
                }

                $contactName = null;
                foreach ($value['contacts'] ?? [] as $c) {
                    if (!empty($c['profile']['name'])) {
                        $contactName = (string) $c['profile']['name'];
                        break;
                    }
                }

                foreach ($value['statuses'] ?? [] as $st) {
                    $wamid = (string) ($st['id'] ?? '');
                    if ($wamid === '') {
                        continue;
                    }
                    $status = self::mapStatus((string) ($st['status'] ?? ''));
                    $ts = isset($st['timestamp']) ? date('Y-m-d H:i:s', (int) $st['timestamp']) : date('Y-m-d H:i:s');
                    $err = $st['errors'][0]['message'] ?? null;
                    self::updateMessageStatus($db, $wamid, $status, $ts, is_string($err) ? $err : null);
                    WhatsAppInbox::logWebhook($db, 'status', $orgId, $wamid, (string) ($st['recipient_id'] ?? ''), $status, is_string($err) ? $err : null, $st);
                }

                foreach ($value['messages'] ?? [] as $msg) {
                    $from = (string) ($msg['from'] ?? '');
                    $displayPhone = (string) ($value['metadata']['display_phone_number'] ?? '');
                    $conv = WhatsAppInbox::findOrCreateConversation($db, $orgId, $from, $contactName, $wabaId, $phoneNumberId);
                    if ($conv) {
                        $storedId = WhatsAppInbox::storeInboundMessage($db, $orgId, $conv, $msg, $contactName, $displayPhone);
                        WhatsAppInbox::logWebhook($db, 'inbound', $orgId, (string) ($msg['id'] ?? ''), $from, 'received', null, [
                            'message_id' => $storedId,
                            'type' => $msg['type'] ?? 'text',
                        ]);
                    }
                }

                if (($change['field'] ?? '') === 'message_template_status_update') {
                    self::processTemplateStatus($db, $value, $orgId, $wabaId, $phoneNumberId);
                }
            }
        }
    }

    private static function processTemplateStatus(PDO $db, array $value, ?string $orgId, string $wabaId, string $phoneNumberId): void
    {
        $tplName = $value['message_template_name'] ?? ($value['message_template_id'] ?? '');
        $event = strtoupper((string) ($value['event'] ?? ''));
        if ($tplName === '') {
            return;
        }
        $scopeOrgId = $orgId ?: commResolveOrgFromMetaIds($db, $phoneNumberId, $wabaId);
        $newStatus = 'pending_approval';
        if ($event === 'APPROVED') {
            $newStatus = 'approved';
        }
        if ($event === 'REJECTED') {
            $newStatus = 'rejected';
        }
        try {
            if ($scopeOrgId) {
                $db->prepare('UPDATE whatsapp_message_templates SET status = ?, rejection_reason = ? WHERE org_id = ? AND (provider_template_id = ? OR name = ?)')
                    ->execute([
                        $newStatus,
                        $event === 'REJECTED' ? ($value['reason'] ?? 'Rejected by Meta') : null,
                        $scopeOrgId,
                        $tplName,
                        $tplName,
                    ]);
            } else {
                $db->prepare('UPDATE whatsapp_message_templates SET status = ?, rejection_reason = ? WHERE provider_template_id = ? OR name = ?')
                    ->execute([
                        $newStatus,
                        $event === 'REJECTED' ? ($value['reason'] ?? 'Rejected by Meta') : null,
                        $tplName,
                        $tplName,
                    ]);
            }
        } catch (Throwable $e) {
            error_log('[wa_webhook] template status: ' . $e->getMessage());
        }
    }

    private static function mapStatus(string $metaStatus): string
    {
        $s = strtolower($metaStatus);
        return in_array($s, ['sent', 'delivered', 'read', 'failed'], true) ? $s : 'queued';
    }

    private static function updateMessageStatus(PDO $db, string $providerMessageId, string $status, ?string $ts, ?string $err = null): void
    {
        if ($providerMessageId === '') {
            return;
        }
        try {
            if ($status === 'delivered') {
                $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, delivered_at = COALESCE(delivered_at, ?) WHERE provider_message_id = ?')
                    ->execute([$status, $ts, $providerMessageId]);
            } elseif ($status === 'read') {
                $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, read_at = COALESCE(read_at, ?), delivered_at = COALESCE(delivered_at, ?) WHERE provider_message_id = ?')
                    ->execute([$status, $ts, $ts, $providerMessageId]);
            } elseif ($status === 'failed') {
                $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, error_message = ? WHERE provider_message_id = ?')
                    ->execute([$status, $err, $providerMessageId]);
            } else {
                $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, sent_at = COALESCE(sent_at, ?) WHERE provider_message_id = ?')
                    ->execute([$status, $ts, $providerMessageId]);
            }
        } catch (Throwable $e) {
            error_log('[wa_webhook] status update: ' . $e->getMessage());
        }
    }
}
