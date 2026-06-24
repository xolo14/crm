<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/communications_org.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = (new Database())->getConnection();

function waWebhookEnsureStatusColumn(PDO $db): void
{
    try {
        $dbName = $db->query('SELECT DATABASE()')->fetchColumn();
        if (!$dbName) return;
        $stmt = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $stmt->execute([(string) $dbName, 'comm_whatsapp_messages', 'delivered_at']);
        if ((int) $stmt->fetchColumn() === 0) {
            $db->exec('ALTER TABLE `comm_whatsapp_messages` ADD COLUMN `delivered_at` TIMESTAMP NULL DEFAULT NULL AFTER `sent_at`');
        }
        $stmt->execute([(string) $dbName, 'comm_whatsapp_messages', 'read_at']);
        if ((int) $stmt->fetchColumn() === 0) {
            $db->exec('ALTER TABLE `comm_whatsapp_messages` ADD COLUMN `read_at` TIMESTAMP NULL DEFAULT NULL AFTER `delivered_at`');
        }
    } catch (Throwable $e) {
    }
}
waWebhookEnsureStatusColumn($db);

function waWebhookLoadConfig(PDO $db): ?array
{
    return null;
}

function waWebhookVerifyTokenMatches(PDO $db, string $token): bool
{
    if ($token === '') {
        return false;
    }
    if (defined('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN') && META_WHATSAPP_WEBHOOK_VERIFY_TOKEN !== '' && hash_equals(META_WHATSAPP_WEBHOOK_VERIFY_TOKEN, $token)) {
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

function waWebhookFindOrgConfigForSignature(PDO $db, ?string $phoneNumberId, ?string $wabaId): ?array
{
    commEnsureOrgWhatsappTable($db);
    $orgId = commResolveOrgFromMetaIds($db, $phoneNumberId, $wabaId);
    if (!$orgId) {
        return null;
    }
    $cfg = commLoadOrgConfig($db, $orgId);
    return $cfg !== [] ? $cfg : null;
}

function waWebhookMapStatus(string $metaStatus): string
{
    $s = strtolower($metaStatus);
    if (in_array($s, ['sent', 'delivered', 'read', 'failed'], true)) {
        return $s;
    }
    return 'queued';
}

// ─── GET: Meta webhook verification ───
if ($method === 'GET') {
    $mode = $_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '';
    $token = $_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '';
    $challenge = $_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '';

    $cfg = waWebhookLoadConfig($db);
    $expected = trim((string) ($cfg['webhook_verify_token'] ?? ''));
    if (defined('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN') && META_WHATSAPP_WEBHOOK_VERIFY_TOKEN !== '') {
        $expected = META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    }

    if ($mode === 'subscribe' && waWebhookVerifyTokenMatches($db, (string) $token)) {
        header('Content-Type: text/plain');
        http_response_code(200);
        echo $challenge;
        exit;
    }
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

// ─── POST: status updates & inbound messages ───
if ($method === 'POST') {
    $raw = file_get_contents('php://input') ?: '';
    $payload = json_decode($raw, true);
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
    $orgCfg = waWebhookFindOrgConfigForSignature($db, $phoneNumberId, $wabaId);
    if ($orgCfg) {
        $meta = MetaWhatsApp::fromPlatformConfig($orgCfg);
        $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? null;
        if (!$meta->verifyWebhookSignature($raw, $sig)) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid signature']);
            exit;
        }
    }

    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON']);
        exit;
    }

    $entries = $payload['entry'] ?? [];
    foreach ($entries as $entry) {
        $changes = $entry['changes'] ?? [];
        foreach ($changes as $change) {
            $value = $change['value'] ?? [];
            // Message delivery status
            $statuses = $value['statuses'] ?? [];
            foreach ($statuses as $st) {
                $wamid = $st['id'] ?? '';
                $status = waWebhookMapStatus((string) ($st['status'] ?? ''));
                if ($wamid === '') continue;
                $ts = isset($st['timestamp']) ? date('Y-m-d H:i:s', (int) $st['timestamp']) : date('Y-m-d H:i:s');
                $err = $st['errors'][0]['message'] ?? null;
                try {
                    if ($status === 'delivered') {
                        $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, delivered_at = COALESCE(delivered_at, ?) WHERE provider_message_id = ?')
                            ->execute([$status, $ts, $wamid]);
                    } elseif ($status === 'read') {
                        $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, read_at = COALESCE(read_at, ?), delivered_at = COALESCE(delivered_at, ?) WHERE provider_message_id = ?')
                            ->execute([$status, $ts, $ts, $wamid]);
                    } elseif ($status === 'failed') {
                        $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, error_message = ? WHERE provider_message_id = ?')
                            ->execute([$status, $err, $wamid]);
                    } else {
                        $db->prepare('UPDATE comm_whatsapp_messages SET status = ?, sent_at = COALESCE(sent_at, ?) WHERE provider_message_id = ?')
                            ->execute([$status, $ts, $wamid]);
                    }
                } catch (Throwable $e) {
                }

                // Template status updates (account_update / message_template_status_update)
            }

            // Inbound messages — log for future inbox feature
            $messages = $value['messages'] ?? [];
            foreach ($messages as $msg) {
                // Optional: store inbound in comm_whatsapp_inbound table later
            }

            // Template approval status from Meta
            if (($change['field'] ?? '') === 'message_template_status_update') {
                $tplName = $value['message_template_name'] ?? ($value['message_template_id'] ?? '');
                $event = strtoupper((string) ($value['event'] ?? ''));
                $scopeOrgId = commResolveOrgFromMetaIds($db, $phoneNumberId, $wabaId);
                if ($tplName !== '') {
                    $newStatus = 'pending_approval';
                    if ($event === 'APPROVED') $newStatus = 'approved';
                    if ($event === 'REJECTED') $newStatus = 'rejected';
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
                    }
                }
            }
        }
    }

    http_response_code(200);
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
