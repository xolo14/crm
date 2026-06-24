<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/MetaWhatsApp.php';
require_once __DIR__ . '/communications_org.php';
require_once __DIR__ . '/communications_templates.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$userId = $tokenData['user_id'];
$input = getInput();

function commNormRole(array $tokenData): string {
    $r = strtolower(trim($tokenData['role'] ?? ''));
    if ($r === 'superadmin') return 'super_admin';
    if ($r === 'organisation') return 'org';
    return $r;
}

function commIsSuperAdmin(array $tokenData): bool {
    return commNormRole($tokenData) === 'super_admin';
}

function commIsAdmin(array $tokenData): bool {
    $r = commNormRole($tokenData);
    return in_array($r, ['super_admin', 'admin', 'org', 'manager'], true);
}

function commResolveOrgId(PDO $db, array $tokenData, array $input = []): ?string {
    if (commIsSuperAdmin($tokenData) && !empty($input['org_id'])) {
        return (string) $input['org_id'];
    }
    return resolveCreatorOrgId($db, $tokenData);
}

function commEnsureTables(PDO $db): void {
    static $done = false;
    if ($done) return;
    foreach (['communications_hub_2026_06_18.sql'] as $file) {
        $migration = __DIR__ . '/../migrations/' . $file;
        if (!is_readable($migration)) continue;
        $sql = file_get_contents($migration);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt === '' || stripos($stmt, 'CREATE TABLE') === false) continue;
            try { $db->exec($stmt); } catch (Throwable $e) {}
        }
    }
    commEnsureMetaColumns($db);
    commEnsureOrgWhatsappTable($db);
    commEnsurePartnerTables($db);
    $done = true;
}

function commEnsureMetaColumns(PDO $db): void {
    static $ok = false;
    if ($ok) return;
    $alters = [
        "ALTER TABLE `platform_whatsapp_config` ADD COLUMN `app_secret` VARCHAR(255) DEFAULT NULL",
        "ALTER TABLE `platform_whatsapp_config` ADD COLUMN `webhook_verify_token` VARCHAR(128) DEFAULT NULL",
        "ALTER TABLE `platform_whatsapp_config` ADD COLUMN `graph_api_version` VARCHAR(10) NOT NULL DEFAULT 'v21.0'",
        "ALTER TABLE `comm_whatsapp_messages` ADD COLUMN `delivered_at` TIMESTAMP NULL DEFAULT NULL",
        "ALTER TABLE `comm_whatsapp_messages` ADD COLUMN `read_at` TIMESTAMP NULL DEFAULT NULL",
        "ALTER TABLE `whatsapp_message_templates` ADD COLUMN `meta_template_id` VARCHAR(100) DEFAULT NULL",
        "ALTER TABLE `whatsapp_message_templates` ADD COLUMN `meta_status` VARCHAR(30) DEFAULT NULL",
    ];
    foreach ($alters as $sql) {
        try { $db->exec($sql); } catch (Throwable $e) {}
    }
    $ok = true;
}

function commCanManageOrgWhatsapp(array $tokenData): bool
{
    $r = commNormRole($tokenData);
    return in_array($r, ['super_admin', 'admin', 'org'], true);
}

function commCanAssignVirtualNumbers(array $tokenData): bool
{
    return commIsSuperAdmin($tokenData);
}

function commCanAssignNumbersToEmployees(array $tokenData): bool
{
    $r = commNormRole($tokenData);
    return in_array($r, ['super_admin', 'admin', 'org', 'manager'], true);
}

commEnsureTables($db);

/** Render template body with {{1}}, {{name}} style variables */
function commRenderTemplate(string $body, array $vars): string {
    $out = $body;
    foreach ($vars as $i => $val) {
        $n = (int) $i + 1;
        $out = str_replace('{{' . $n . '}}', (string) $val, $out);
        if (is_string($i)) {
            $out = str_replace('{{' . $i . '}}', (string) $val, $out);
        }
    }
    return $out;
}

/**
 * @deprecated Use commSendViaOrgProvider
 */
function commSendViaProvider(PDO $db, array $config, string $phone, array $template, array $bodyParams = []): array
{
    unset($config);
    return ['ok' => false, 'error' => 'Use organization Meta WhatsApp configuration'];
}

// ─── Per-organization Meta WhatsApp config ───
if ($action === 'org_config' || $action === 'platform_config') {
    $targetOrgId = commResolveOrgId($db, $tokenData, array_merge($_GET, $input));
    if ($method === 'GET') {
        if (!$targetOrgId) {
            respond(['data' => null, 'webhook_url_suggested' => commOrgWebhookUrl()]);
        }
        commAssertOrgAccess($tokenData, $targetOrgId);
        $row = commLoadOrgConfig($db, $targetOrgId);
        if ($row === []) {
            respond(['data' => null, 'org_id' => $targetOrgId, 'webhook_url_suggested' => commOrgWebhookUrl()]);
        }
        $includeSecrets = commCanManageOrgWhatsapp($tokenData);
        respond(['data' => commFormatOrgConfigForResponse($row, $includeSecrets), 'org_id' => $targetOrgId]);
    }
    if ($method === 'PUT' || $method === 'POST') {
        requireRole($tokenData, ['super_admin', 'admin', 'org']);
        if (!$targetOrgId) {
            respond(['error' => 'Organization required'], 400);
        }
        commAssertOrgAccess($tokenData, $targetOrgId);
        $existing = commLoadOrgConfig($db, $targetOrgId);
        $fields = ['provider', 'phone_number_id', 'business_phone', 'waba_id', 'is_active', 'graph_api_version'];
        if ($existing !== []) {
            $sets = [];
            $params = [];
            foreach ($fields as $f) {
                if (array_key_exists($f, $input)) {
                    $sets[] = "$f = ?";
                    $params[] = $input[$f];
                }
            }
            foreach (['api_key', 'app_secret', 'webhook_verify_token'] as $secretField) {
                if (array_key_exists($secretField, $input) && trim((string) $input[$secretField]) !== '') {
                    $sets[] = "$secretField = ?";
                    $params[] = trim((string) $input[$secretField]);
                }
            }
            if (!$sets) {
                respond(['error' => 'Nothing to update'], 400);
            }
            $sets[] = 'configured_by = ?';
            $sets[] = "connection_status = 'configured'";
            $params[] = $userId;
            $params[] = $existing['id'];
            $db->prepare('UPDATE org_whatsapp_config SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
            respond(['message' => 'Organization WhatsApp config saved', 'id' => $existing['id'], 'org_id' => $targetOrgId, 'webhook_url_suggested' => commOrgWebhookUrl()]);
        }
        $id = generateUUID();
        $verifyToken = trim((string) ($input['webhook_verify_token'] ?? ''));
        if ($verifyToken === '') {
            $verifyToken = bin2hex(random_bytes(16));
        }
        $db->prepare('INSERT INTO org_whatsapp_config (id, org_id, provider, api_key, app_secret, phone_number_id, business_phone, waba_id, webhook_verify_token, graph_api_version, connection_status, is_active, configured_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([
                $id,
                $targetOrgId,
                $input['provider'] ?? 'meta',
                $input['api_key'] ?? null,
                $input['app_secret'] ?? null,
                $input['phone_number_id'] ?? null,
                $input['business_phone'] ?? null,
                $input['waba_id'] ?? null,
                $verifyToken,
                $input['graph_api_version'] ?? 'v21.0',
                'configured',
                isset($input['is_active']) ? (int) $input['is_active'] : 1,
                $userId,
            ]);
        respond(['message' => 'Organization WhatsApp config created', 'id' => $id, 'org_id' => $targetOrgId, 'webhook_verify_token' => $verifyToken, 'webhook_url_suggested' => commOrgWebhookUrl()], 201);
    }
}

// ─── Super admin: all orgs WhatsApp connection overview ───
if ($action === 'orgs_overview' && $method === 'GET') {
    requireRole($tokenData, ['super_admin']);
    commEnsureOrgWhatsappTable($db);
    $stmt = $db->query("SELECT o.id, o.name, o.slug, c.business_phone, c.connection_status, c.is_active, c.phone_number_id, c.waba_id, c.updated_at,
        (SELECT COUNT(*) FROM org_virtual_numbers vn WHERE vn.org_id = o.id AND vn.is_active = 1) AS virtual_numbers,
        (SELECT COUNT(*) FROM whatsapp_message_templates t WHERE t.org_id = o.id AND t.status = 'approved') AS approved_templates
        FROM organizations o
        LEFT JOIN org_whatsapp_config c ON c.org_id = o.id
        WHERE o.is_active = 1
        ORDER BY o.name");
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── Meta: test org Graph API connection ───
if ($action === 'test_meta_connection' && $method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'org']);
    $orgId = commResolveOrgId($db, $tokenData, $input);
    if (!$orgId) {
        respond(['error' => 'Organization required'], 400);
    }
    commAssertOrgAccess($tokenData, $orgId);
    $meta = commMetaClientForOrg($db, $orgId);
    $test = $meta->testConnection();
    if (!$test['ok']) {
        respond(['error' => $test['error'] ?? 'Connection failed', 'details' => $test], 502);
    }
    $db->prepare("UPDATE org_whatsapp_config SET connection_status = 'connected' WHERE org_id = ?")->execute([$orgId]);
    respond(['message' => 'Connected to Meta WhatsApp Cloud API', 'data' => $test, 'org_id' => $orgId]);
}

// ─── Meta: sync approved templates from org WABA ───
if ($action === 'sync_meta_templates' && $method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
    $orgId = commResolveOrgId($db, $tokenData, $input);
    if (!$orgId) {
        respond(['error' => 'Organization required'], 400);
    }
    commAssertOrgAccess($tokenData, $orgId);
    $sync = commSyncMetaTemplatesForOrg($db, $orgId, $userId);
    if (empty($sync['ok'])) {
        respond(['error' => $sync['error'] ?? 'Sync failed'], 502);
    }
    respond(['message' => 'Meta templates synced for organization', 'imported' => $sync['imported'], 'updated' => $sync['updated'], 'total' => $sync['total'], 'org_id' => $orgId]);
}

// ─── Meta: submit org template to Meta for official approval ───
if ($action === 'submit_template_meta' && $method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
    $tplId = trim((string) ($input['template_id'] ?? ''));
    if ($tplId === '') {
        respond(['error' => 'template_id required'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM whatsapp_message_templates WHERE id = ?');
    $stmt->execute([$tplId]);
    $tpl = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$tpl) {
        respond(['error' => 'Template not found'], 404);
    }
    $orgId = (string) ($tpl['org_id'] ?? '');
    if ($orgId === '') {
        respond(['error' => 'Template must belong to an organization'], 400);
    }
    commAssertOrgAccess($tokenData, $orgId);

    $library = null;
    if (!empty($tpl['platform_template_id'])) {
        $library = commLoadLibraryTemplate($db, (string) $tpl['platform_template_id']);
    }
    $result = commSubmitOrgTemplateToMeta($db, $orgId, $tpl, $library);
    if (!$result['ok']) {
        respond(['error' => $result['error'] ?? 'Meta submission failed'], 502);
    }
    $metaName = $result['name'] ?? MetaWhatsApp::sanitizeTemplateName((string) $tpl['name']);
    $db->prepare('UPDATE whatsapp_message_templates SET provider_template_id = ?, meta_template_id = ?, meta_status = ?, status = ? WHERE id = ?')
        ->execute([
            $metaName,
            $result['meta_template_id'] ?? null,
            $result['status'] ?? 'PENDING',
            'pending_approval',
            $tplId,
        ]);
    $msg = $result['message_hint'] ?? 'Template submitted to Meta for official approval';
    respond(['message' => $msg, 'data' => $result, 'partner_preapproved' => !empty($result['partner_preapproved'])]);
}

// ─── Virtual numbers ───
if ($action === 'virtual_numbers') {
    if ($method === 'GET') {
        $orgId = commResolveOrgId($db, $tokenData, $_GET);
        if (commIsSuperAdmin($tokenData) && empty($_GET['org_id'])) {
            $stmt = $db->query("SELECT vn.*, o.name AS org_name FROM org_virtual_numbers vn LEFT JOIN organizations o ON o.id = vn.org_id WHERE vn.is_active = 1 ORDER BY o.name, vn.label");
            respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        }
        if (!$orgId) respond(['data' => []]);
        $stmt = $db->prepare("SELECT vn.*, o.name AS org_name FROM org_virtual_numbers vn LEFT JOIN organizations o ON o.id = vn.org_id WHERE vn.org_id = ? AND vn.is_active = 1 ORDER BY vn.label");
        $stmt->execute([$orgId]);
        respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['super_admin']);
        $orgId = trim((string) ($input['org_id'] ?? ''));
        if ($orgId === '') {
            respond(['error' => 'Organization required — platform admin assigns numbers to orgs'], 400);
        }
        $phone = preg_replace('/\s+/', '', trim((string) ($input['phone_number'] ?? '')));
        if ($phone === '') respond(['error' => 'Phone number required'], 400);
        $id = generateUUID();
        $db->prepare('INSERT INTO org_virtual_numbers (id, org_id, phone_number, label, provider, provider_sid, whatsapp_enabled, calls_enabled, is_active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([
                $id, $orgId, $phone,
                trim((string) ($input['label'] ?? 'Virtual Number')),
                $input['provider'] ?? 'exotel',
                $input['provider_sid'] ?? null,
                isset($input['whatsapp_enabled']) ? (int) $input['whatsapp_enabled'] : 1,
                isset($input['calls_enabled']) ? (int) $input['calls_enabled'] : 1,
                1, $userId,
            ]);
        respond(['id' => $id, 'message' => 'Virtual number added'], 201);
    }
    if ($method === 'PUT') {
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        requireRole($tokenData, ['super_admin']);
        $fields = [];
        $params = [];
        foreach (['phone_number', 'label', 'provider', 'provider_sid', 'whatsapp_enabled', 'calls_enabled', 'is_active'] as $f) {
            if (array_key_exists($f, $input)) {
                $fields[] = "$f = ?";
                $params[] = $input[$f];
            }
        }
        if (!$fields) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $db->prepare('UPDATE org_virtual_numbers SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        respond(['message' => 'Virtual number updated']);
    }
    if ($method === 'DELETE') {
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        requireRole($tokenData, ['super_admin']);
        $db->prepare('UPDATE org_virtual_numbers SET is_active = 0 WHERE id = ?')->execute([$id]);
        respond(['message' => 'Virtual number removed']);
    }
}

// ─── User ↔ number assignments ───
if ($action === 'number_assignments') {
    if ($method === 'GET') {
        $vnId = $_GET['virtual_number_id'] ?? '';
        if ($vnId) {
            $stmt = $db->prepare("SELECT a.*, u.full_name, u.email FROM user_number_assignments a JOIN users u ON u.id = a.user_id WHERE a.virtual_number_id = ?");
            $stmt->execute([$vnId]);
            respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        }
        // My assignments
        $stmt = $db->prepare("SELECT a.*, vn.phone_number, vn.label, vn.whatsapp_enabled, vn.calls_enabled, vn.org_id, o.name AS org_name
            FROM user_number_assignments a
            JOIN org_virtual_numbers vn ON vn.id = a.virtual_number_id
            LEFT JOIN organizations o ON o.id = vn.org_id
            WHERE a.user_id = ? AND vn.is_active = 1");
        $stmt->execute([$userId]);
        respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
        $vnId = trim((string) ($input['virtual_number_id'] ?? ''));
        $assignUserId = trim((string) ($input['user_id'] ?? ''));
        if ($vnId === '' || $assignUserId === '') respond(['error' => 'virtual_number_id and user_id required'], 400);
        $vnStmt = $db->prepare('SELECT org_id FROM org_virtual_numbers WHERE id = ? AND is_active = 1');
        $vnStmt->execute([$vnId]);
        $vnRow = $vnStmt->fetch(PDO::FETCH_ASSOC);
        if (!$vnRow) respond(['error' => 'Virtual number not found'], 404);
        if (!commIsSuperAdmin($tokenData)) {
            $callerOrg = commResolveOrgId($db, $tokenData, $input);
            if (($vnRow['org_id'] ?? '') !== $callerOrg) {
                respond(['error' => 'You can only assign numbers from your organization'], 403);
            }
        }
        $id = generateUUID();
        try {
            $db->prepare('INSERT INTO user_number_assignments (id, virtual_number_id, user_id, assigned_by) VALUES (?,?,?,?)')
                ->execute([$id, $vnId, $assignUserId, $userId]);
        } catch (PDOException $e) {
            respond(['error' => 'User already assigned to this number'], 409);
        }
        respond(['id' => $id, 'message' => 'Number assigned'], 201);
    }
    if ($method === 'DELETE') {
        $id = $_GET['id'] ?? ($input['id'] ?? '');
        if (!$id) respond(['error' => 'ID required'], 400);
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
        $db->prepare('DELETE FROM user_number_assignments WHERE id = ?')->execute([$id]);
        respond(['message' => 'Assignment removed']);
    }
}

// ─── WhatsApp templates + approval ───
if ($action === 'templates') {
    if ($method === 'GET') {
        $status = $_GET['status'] ?? '';
        $orgId = commResolveOrgId($db, $tokenData, $_GET);
        $sql = "SELECT t.*, u.full_name AS created_by_name, o.name AS org_name FROM whatsapp_message_templates t
            LEFT JOIN users u ON u.id = t.created_by LEFT JOIN organizations o ON o.id = t.org_id WHERE 1=1";
        $params = [];
        if (!commIsSuperAdmin($tokenData)) {
            $sql .= ' AND t.org_id = ?';
            $params[] = $orgId;
        } elseif (!empty($_GET['org_id'])) {
            $sql .= ' AND t.org_id = ?';
            $params[] = $_GET['org_id'];
        }
        if ($status !== '') {
            $sql .= ' AND t.status = ?';
            $params[] = $status;
        }
        $sql .= ' ORDER BY t.updated_at DESC';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
        $orgId = commResolveOrgId($db, $tokenData, $input);
        if (!$orgId) respond(['error' => 'Organization required'], 400);
        $body = trim((string) ($input['body'] ?? ''));
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '' || $body === '') respond(['error' => 'Name and body required'], 400);
        $id = generateUUID();
        $status = 'draft';
        $vars = $input['variables'] ?? null;
        $db->prepare('INSERT INTO whatsapp_message_templates (id, org_id, name, category, language, header_type, header_text, body, footer, variables, provider_template_id, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([
                $id, $orgId, $name,
                $input['category'] ?? 'marketing',
                $input['language'] ?? 'en',
                $input['header_type'] ?? 'none',
                $input['header_text'] ?? null,
                $body,
                $input['footer'] ?? null,
                $vars ? json_encode($vars) : null,
                $input['provider_template_id'] ?? null,
                $status,
                $userId,
            ]);
        respond(['id' => $id, 'status' => $status, 'message' => 'Template saved — submit to Meta for official approval'], 201);
    }
    if ($method === 'PUT') {
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        $stmt = $db->prepare('SELECT * FROM whatsapp_message_templates WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) respond(['error' => 'Not found'], 404);

        if (!commIsSuperAdmin($tokenData) && ($row['org_id'] ?? '') !== commResolveOrgId($db, $tokenData, $input)) {
            respond(['error' => 'Forbidden'], 403);
        }
        $fields = [];
        $params = [];
        foreach (['name', 'category', 'language', 'header_type', 'header_text', 'body', 'footer', 'provider_template_id', 'variables'] as $f) {
            if (array_key_exists($f, $input)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'variables' && is_array($input[$f]) ? json_encode($input[$f]) : $input[$f];
            }
        }
        if (!empty($input['submit_for_approval'])) {
            respond(['error' => 'Use submit_template_meta to apply for Meta official approval'], 400);
        }
        if (!$fields) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $db->prepare('UPDATE whatsapp_message_templates SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        respond(['message' => 'Template updated']);
    }
}

// ─── Send WhatsApp message (approved templates only) ───
if ($action === 'send_whatsapp' && $method === 'POST') {
    $phone = preg_replace('/\s+/', '', trim((string) ($input['recipient_phone'] ?? '')));
    $templateId = trim((string) ($input['template_id'] ?? ''));
    if ($phone === '' || $templateId === '') respond(['error' => 'recipient_phone and template_id required'], 400);

    $tStmt = $db->prepare('SELECT * FROM whatsapp_message_templates WHERE id = ? AND status = ?');
    $tStmt->execute([$templateId, 'approved']);
    $template = $tStmt->fetch(PDO::FETCH_ASSOC);
    if (!$template) respond(['error' => 'Template not found or not Meta-approved yet'], 400);

    $vars = $input['variables'] ?? [];
    if (!is_array($vars)) $vars = [];
    $body = commRenderTemplate((string) $template['body'], $vars);
    $orgId = (string) ($template['org_id'] ?? '');
    if ($orgId === '') {
        $orgId = (string) (commResolveOrgId($db, $tokenData, $input) ?? '');
    }
    if ($orgId === '') respond(['error' => 'Organization required'], 400);
    commAssertOrgAccess($tokenData, $orgId);
    $vnId = $input['virtual_number_id'] ?? null;

    $send = commSendViaOrgProvider($db, $orgId, $phone, $template, $vars);

    $msgId = generateUUID();
    $status = $send['ok'] ? 'sent' : 'failed';
    $db->prepare('INSERT INTO comm_whatsapp_messages (id, org_id, user_id, virtual_number_id, template_id, recipient_phone, recipient_name, variables, message_body, status, provider_message_id, error_message, lead_id, sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $msgId, $orgId, $userId, $vnId,
            $templateId, $phone,
            $input['recipient_name'] ?? null,
            json_encode($vars),
            $body, $status,
            $send['provider_message_id'] ?? null,
            $send['error'] ?? null,
            $input['lead_id'] ?? null,
            $send['ok'] ? date('Y-m-d H:i:s') : null,
        ]);

    if (!$send['ok']) {
        respond(['error' => $send['error'] ?? 'Send failed', 'id' => $msgId], 502);
    }
    respond(['id' => $msgId, 'message' => 'WhatsApp message queued', 'status' => $status], 201);
}

// ─── Message history ───
if ($action === 'messages' && $method === 'GET') {
    $orgId = commResolveOrgId($db, $tokenData, $_GET);
    $limit = min(100, max(10, (int) ($_GET['limit'] ?? 50)));
    if (commIsSuperAdmin($tokenData) && empty($_GET['org_id'])) {
        $stmt = $db->prepare("SELECT m.*, u.full_name AS sender_name FROM comm_whatsapp_messages m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC LIMIT ?");
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    if (commIsAdmin($tokenData) && $orgId) {
        $stmt = $db->prepare("SELECT m.*, u.full_name AS sender_name FROM comm_whatsapp_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at DESC LIMIT ?");
        $stmt->bindValue(1, $orgId);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->execute();
        respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    $stmt = $db->prepare("SELECT m.* FROM comm_whatsapp_messages m WHERE m.user_id = ? ORDER BY m.created_at DESC LIMIT ?");
    $stmt->bindValue(1, $userId, PDO::PARAM_STR);
    $stmt->bindValue(2, $limit, PDO::PARAM_INT);
    $stmt->execute();
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── Dialer contacts (recent leads with phone) ───
if ($action === 'dialer_contacts' && $method === 'GET') {
    $orgId = commResolveOrgId($db, $tokenData, $_GET);
    $search = trim((string) ($_GET['search'] ?? ''));
    $sql = "SELECT id, full_name, phone, email, status, source FROM leads WHERE phone IS NOT NULL AND TRIM(phone) != ''";
    $params = [];
    if ($orgId) {
        $sql .= ' AND org_id = ?';
        $params[] = $orgId;
    }
    $role = commNormRole($tokenData);
    if (in_array($role, ['sales_representative', 'sales_marketing', 'marketing', 'hr'], true)) {
        $sql .= ' AND (assigned_to = ? OR created_by = ?)';
        $params[] = $userId;
        $params[] = $userId;
    }
    if ($search !== '') {
        $sql .= ' AND (full_name LIKE ? OR phone LIKE ?)';
        $params[] = '%' . $search . '%';
        $params[] = '%' . $search . '%';
    }
    $sql .= ' ORDER BY updated_at DESC LIMIT 50';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── Meta Official Partner config (super admin) ───
if ($action === 'meta_partner_config') {
    if ($method === 'GET') {
        $row = commLoadPartnerConfig($db);
        $includeSecrets = commIsSuperAdmin($tokenData);
        respond(['data' => commFormatPartnerConfigForResponse($row, $includeSecrets)]);
    }
    if ($method === 'PUT' || $method === 'POST') {
        requireRole($tokenData, ['super_admin']);
        $existing = commLoadPartnerConfig($db);
        $fields = [
            'partner_status', 'business_verification', 'meta_app_id', 'meta_partner_business_id',
            'master_waba_id', 'embedded_signup_config_id', 'solution_name', 'partner_contact_email',
            'onboarding_notes', 'is_active',
        ];
        if ($existing !== []) {
            $sets = [];
            $params = [];
            foreach ($fields as $f) {
                if (array_key_exists($f, $input)) {
                    $sets[] = "$f = ?";
                    $params[] = $input[$f];
                }
            }
            if (array_key_exists('system_user_token', $input) && trim((string) $input['system_user_token']) !== '') {
                $sets[] = 'system_user_token = ?';
                $params[] = trim((string) $input['system_user_token']);
            }
            if (!$sets) {
                respond(['error' => 'Nothing to update'], 400);
            }
            $sets[] = 'updated_by = ?';
            $params[] = $userId;
            $params[] = $existing['id'];
            $db->prepare('UPDATE meta_partner_config SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
            respond(['message' => 'Meta Partner config saved', 'data' => commFormatPartnerConfigForResponse(commLoadPartnerConfig($db), true)]);
        }
        $id = generateUUID();
        $db->prepare('INSERT INTO meta_partner_config (id, partner_status, business_verification, meta_app_id, meta_partner_business_id, master_waba_id, system_user_token, embedded_signup_config_id, solution_name, partner_contact_email, onboarding_notes, is_active, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([
                $id,
                $input['partner_status'] ?? 'pending',
                $input['business_verification'] ?? 'not_started',
                $input['meta_app_id'] ?? null,
                $input['meta_partner_business_id'] ?? null,
                $input['master_waba_id'] ?? null,
                $input['system_user_token'] ?? null,
                $input['embedded_signup_config_id'] ?? null,
                $input['solution_name'] ?? 'Syncpedia CRM',
                $input['partner_contact_email'] ?? null,
                $input['onboarding_notes'] ?? null,
                isset($input['is_active']) ? (int) $input['is_active'] : 0,
                $userId,
            ]);
        respond(['message' => 'Meta Partner config created', 'id' => $id], 201);
    }
}

// ─── Platform template library ───
if ($action === 'template_library') {
    commEnsurePartnerTables($db);
    if ($method === 'GET') {
        $category = $_GET['category'] ?? '';
        $sql = 'SELECT * FROM platform_template_library WHERE is_active = 1';
        $params = [];
        if ($category !== '') {
            $sql .= ' AND category = ?';
            $params[] = $category;
        }
        if (!commIsSuperAdmin($tokenData)) {
            $partner = commLoadPartnerConfig($db);
            if (empty($partner['is_active'])) {
                $sql .= ' AND meta_partner_preapproved = 1';
            }
        }
        $sql .= ' ORDER BY sort_order ASC, name ASC';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            if (!empty($r['variables']) && is_string($r['variables'])) {
                $r['variables'] = json_decode($r['variables'], true);
            }
            if (!empty($r['editable_fields']) && is_string($r['editable_fields'])) {
                $r['editable_fields'] = json_decode($r['editable_fields'], true);
            }
        }
        unset($r);
        respond(['data' => $rows, 'partner_active' => !empty(commLoadPartnerConfig($db)['is_active'])]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['super_admin']);
        $name = trim((string) ($input['name'] ?? ''));
        $body = trim((string) ($input['body'] ?? ''));
        $slug = trim((string) ($input['slug'] ?? ''));
        if ($name === '' || $body === '') {
            respond(['error' => 'name and body required'], 400);
        }
        if ($slug === '') {
            $slug = MetaWhatsApp::sanitizeTemplateName($name);
        }
        $id = generateUUID();
        $db->prepare('INSERT INTO platform_template_library (id, slug, name, description, use_case, category, template_type, language, header_type, header_text, body, footer, variables, editable_fields, meta_partner_preapproved, meta_quality_tier, sort_order, is_active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([
                $id, $slug, $name,
                $input['description'] ?? null,
                $input['use_case'] ?? null,
                $input['category'] ?? 'utility',
                $input['template_type'] ?? 'general',
                $input['language'] ?? 'en',
                $input['header_type'] ?? 'none',
                $input['header_text'] ?? null,
                $body,
                $input['footer'] ?? null,
                isset($input['variables']) ? json_encode($input['variables']) : null,
                isset($input['editable_fields']) ? json_encode($input['editable_fields']) : json_encode(['body' => true, 'footer' => true, 'name' => true]),
                isset($input['meta_partner_preapproved']) ? (int) $input['meta_partner_preapproved'] : 1,
                $input['meta_quality_tier'] ?? 'high',
                (int) ($input['sort_order'] ?? 0),
                isset($input['is_active']) ? (int) $input['is_active'] : 1,
                $userId,
            ]);
        respond(['id' => $id, 'message' => 'Library template created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, ['super_admin']);
        $id = $_GET['id'] ?? ($input['id'] ?? '');
        if ($id === '') {
            respond(['error' => 'ID required'], 400);
        }
        $lib = commLoadLibraryTemplate($db, $id);
        if (!$lib) {
            respond(['error' => 'Not found'], 404);
        }
        $fields = ['slug', 'name', 'description', 'use_case', 'category', 'template_type', 'language', 'header_type', 'header_text', 'body', 'footer', 'meta_partner_preapproved', 'meta_quality_tier', 'sort_order', 'is_active'];
        $sets = [];
        $params = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $input)) {
                $sets[] = "$f = ?";
                $params[] = $input[$f];
            }
        }
        foreach (['variables', 'editable_fields'] as $jf) {
            if (array_key_exists($jf, $input)) {
                $sets[] = "$jf = ?";
                $params[] = is_array($input[$jf]) ? json_encode($input[$jf]) : $input[$jf];
            }
        }
        if (!$sets) {
            respond(['error' => 'Nothing to update'], 400);
        }
        $params[] = $id;
        $db->prepare('UPDATE platform_template_library SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        respond(['message' => 'Library template updated']);
    }
    if ($method === 'DELETE') {
        requireRole($tokenData, ['super_admin']);
        $id = $_GET['id'] ?? '';
        if ($id === '') {
            respond(['error' => 'ID required'], 400);
        }
        $db->prepare('UPDATE platform_template_library SET is_active = 0 WHERE id = ?')->execute([$id]);
        respond(['message' => 'Template removed from library']);
    }
}

// ─── Org applies official library template ───
if ($action === 'apply_library_template' && $method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
    $libraryId = trim((string) ($input['platform_template_id'] ?? $input['library_template_id'] ?? ''));
    if ($libraryId === '') {
        respond(['error' => 'platform_template_id required'], 400);
    }
    $orgId = commResolveOrgId($db, $tokenData, $input);
    if (!$orgId) {
        respond(['error' => 'Organization required'], 400);
    }
    commAssertOrgAccess($tokenData, $orgId);
    $library = commLoadLibraryTemplate($db, $libraryId);
    if (!$library || !(int) ($library['is_active'] ?? 0)) {
        respond(['error' => 'Library template not found'], 404);
    }
    $custom = is_array($input['customization'] ?? null) ? $input['customization'] : [];
    $merged = commMergeTemplateCustomization($library, $custom);
    $id = generateUUID();
    $vars = $library['variables'];
    if (is_string($vars)) {
        $vars = json_decode($vars, true);
    }
    $db->prepare('INSERT INTO whatsapp_message_templates (id, org_id, name, category, language, header_type, header_text, body, footer, variables, provider_template_id, status, created_by, platform_template_id, application_source, customization_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $id,
            $orgId,
            $merged['name'],
            $library['category'] ?? 'utility',
            $library['language'] ?? 'en',
            $library['header_type'] ?? 'none',
            $merged['header_text'],
            $merged['body'],
            $merged['footer'],
            $vars ? json_encode($vars) : null,
            null,
            'draft',
            $userId,
            $libraryId,
            'official_library',
            json_encode($merged['customization_json']),
        ]);
    $submitNow = !empty($input['submit_to_meta']);
    $response = [
        'id' => $id,
        'status' => 'draft',
        'message' => 'Official template applied — review and submit to Meta',
        'partner_preapproved' => !empty($library['meta_partner_preapproved']),
        'library' => ['id' => $libraryId, 'slug' => $library['slug'], 'name' => $library['name']],
    ];
    if ($submitNow) {
        $tpl = [
            'name' => $merged['name'],
            'category' => $library['category'],
            'language' => $library['language'],
            'body' => $merged['body'],
            'footer' => $merged['footer'],
            'header_type' => $library['header_type'],
            'header_text' => $merged['header_text'],
            'platform_template_id' => $libraryId,
        ];
        $result = commSubmitOrgTemplateToMeta($db, $orgId, $tpl, $library);
        if ($result['ok']) {
            $metaName = $result['name'] ?? MetaWhatsApp::sanitizeTemplateName($merged['name']);
            $db->prepare('UPDATE whatsapp_message_templates SET provider_template_id = ?, meta_template_id = ?, meta_status = ?, status = ? WHERE id = ?')
                ->execute([$metaName, $result['meta_template_id'] ?? null, $result['status'] ?? 'PENDING', 'pending_approval', $id]);
            $response['status'] = 'pending_approval';
            $response['message'] = $result['message_hint'] ?? 'Submitted to Meta for approval';
            $response['meta'] = $result;
        } else {
            $response['submit_error'] = $result['error'] ?? 'Meta submit failed';
        }
    }
    respond($response, $submitNow && empty($response['submit_error']) ? 200 : 201);
}

// ─── Publish library template to partner master WABA ───
if ($action === 'publish_partner_template' && $method === 'POST') {
    requireRole($tokenData, ['super_admin']);
    $libraryId = trim((string) ($input['platform_template_id'] ?? ''));
    if ($libraryId === '') {
        respond(['error' => 'platform_template_id required'], 400);
    }
    $partner = commLoadPartnerConfig($db);
    if (empty($partner['is_active']) || empty($partner['master_waba_id'])) {
        respond(['error' => 'Meta Partner not active or master WABA not configured'], 400);
    }
    $library = commLoadLibraryTemplate($db, $libraryId);
    if (!$library) {
        respond(['error' => 'Library template not found'], 404);
    }
    $meta = commMetaPartnerClient($db);
    $result = $meta->createMessageTemplate(
        (string) $library['slug'],
        (string) ($library['category'] ?? 'utility'),
        (string) ($library['language'] ?? 'en'),
        (string) $library['body'],
        $library['footer'] ?? null,
        (string) ($library['header_type'] ?? 'none'),
        $library['header_text'] ?? null
    );
    if (!$result['ok']) {
        respond(['error' => $result['error'] ?? 'Publish failed'], 502);
    }
    respond(['message' => 'Published to partner master WABA', 'data' => $result]);
}

// ─── Hub summary (one call for dashboard) ───
if ($action === 'hub_summary' && $method === 'GET') {
    $orgId = commResolveOrgId($db, $tokenData, $_GET);
    $orgWa = $orgId ? commLoadOrgConfig($db, $orgId) : [];
    $aStmt = $db->prepare("SELECT COUNT(*) FROM user_number_assignments a JOIN org_virtual_numbers vn ON vn.id = a.virtual_number_id WHERE a.user_id = ? AND vn.is_active = 1");
    $aStmt->execute([$userId]);
    $myNumbers = (int) $aStmt->fetchColumn();
    $approvedTemplates = 0;
    if ($orgId) {
        $tStmt = $db->prepare("SELECT COUNT(*) FROM whatsapp_message_templates WHERE status = 'approved' AND org_id = ?");
        $tStmt->execute([$orgId]);
        $approvedTemplates = (int) $tStmt->fetchColumn();
    }
    respond([
        'org_whatsapp' => $orgWa !== [] ? [
            'provider' => $orgWa['provider'] ?? 'meta',
            'business_phone' => $orgWa['business_phone'] ?? null,
            'is_active' => $orgWa['is_active'] ?? 0,
            'connection_status' => $orgWa['connection_status'] ?? 'not_connected',
        ] : null,
        'my_assigned_numbers' => $myNumbers,
        'approved_templates' => $approvedTemplates,
        'org_id' => $orgId,
        'meta_partner_active' => !empty(commLoadPartnerConfig($db)['is_active']),
        'official_templates_available' => (int) $db->query('SELECT COUNT(*) FROM platform_template_library WHERE is_active = 1')->fetchColumn(),
    ]);
}

respond(['error' => 'Invalid action'], 400);
