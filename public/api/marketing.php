<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

$action = $_GET['action'] ?? '';

function marketingNormRole(array $tokenData): string {
    return syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
}

function marketingIsPrivileged(array $tokenData): bool
{
    $r = marketingNormRole($tokenData);
    return in_array($r, ['super_admin', 'admin', 'org', 'marketing', 'manager'], true);
}

function marketingGateRoles(): array
{
    return ['super_admin', 'admin', 'org', 'marketing', 'manager'];
}

function marketingAdminRoles(): array
{
    return ['super_admin', 'admin', 'org', 'manager'];
}

/** WHERE fragment + params: SuperAdmin master view → all rows; switched org / tenant → own org only */
function marketingOrgScope(PDO $db, array $tokenData, string $alias): array {
    $role = marketingNormRole($tokenData);
    $prefix = $alias !== '' ? $alias . '.' : '';
    if ($role === 'super_admin') {
        $oid = getOrgId($tokenData);
        if ($oid === null || trim((string) $oid) === '') {
            return ['1=1', []];
        }
        return ["{$prefix}org_id = ?", [$oid]];
    }
    $resolved = resolveCreatorOrgId($db, $tokenData);
    if ($resolved !== null && $resolved !== '') {
        return ["{$prefix}org_id = ?", [$resolved]];
    }
    $orgId = $tokenData['org_id'] ?? null;
    if ($orgId !== null && $orgId !== '') {
        return ["{$prefix}org_id = ?", [$orgId]];
    }
    return ["({$prefix}org_id IS NULL OR {$prefix}org_id = '')", []];
}

function marketingResolveOrgId(array $tokenData, array $input, ?PDO $db = null): ?string {
    $role = marketingNormRole($tokenData);
    if ($role === 'super_admin') {
        $o = $input['org_id'] ?? null;
        if ($o !== null && $o !== '') {
            return (string) $o;
        }
    }
    if ($db instanceof PDO) {
        return resolveCreatorOrgId($db, $tokenData);
    }
    $orgId = $tokenData['org_id'] ?? null;
    return ($orgId !== null && $orgId !== '') ? (string) $orgId : null;
}

/** @return array<string,mixed> */
function marketingAssertRowInScope(PDO $db, string $table, string $id, array $tokenData): array {
    static $allowed = ['marketing_members', 'email_drafts', 'email_campaigns', 'whatsapp_drafts', 'whatsapp_campaigns'];
    if (!in_array($table, $allowed, true)) {
        respond(['error' => 'Invalid resource'], 400);
    }
    $stmt = $db->prepare("SELECT * FROM `$table` WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    $role = marketingNormRole($tokenData);
    if ($role === 'super_admin') {
        return $row;
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $rowOrg = $row['org_id'] ?? null;
    if ($orgId !== null && $orgId !== '') {
        if ($rowOrg !== $orgId) {
            respond(['error' => 'Forbidden'], 403);
        }
        return $row;
    }
    if ($rowOrg === null || $rowOrg === '') {
        return $row;
    }
    respond(['error' => 'Forbidden'], 403);
}

// ---- Marketing Members ----
if ($action === 'members') {
    if ($method === 'GET') {
        if (marketingIsPrivileged($tokenData)) {
            [$w, $params] = marketingOrgScope($db, $tokenData, '');
            $stmt = $db->prepare("SELECT * FROM marketing_members WHERE ($w) ORDER BY created_at DESC");
            $stmt->execute($params);
            respond(['data' => $stmt->fetchAll()]);
        }
        // Marketing portal bootstrap: non-privileged users only see their own membership row(s)
        $uStmt = $db->prepare('SELECT email FROM users WHERE id = ? LIMIT 1');
        $uStmt->execute([$userId]);
        $email = (string) (($uStmt->fetch()['email'] ?? ''));
        $stmt = $db->prepare('SELECT * FROM marketing_members WHERE user_id = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?)) ORDER BY created_at DESC');
        $stmt->execute([$userId, $email]);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO marketing_members (id, user_id, name, email, phone, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id, $input['user_id'], $input['name'], $input['email'],
            $input['phone'] ?? null, $input['status'] ?? 'active', $userId, $orgId,
        ]);
        respond(['id' => $id, 'message' => 'Member added'], 201);
    }
    if ($method === 'PUT') {
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        requireRole($tokenData, marketingGateRoles());
        marketingAssertRowInScope($db, 'marketing_members', $id, $tokenData);
        $input = getInput();
        $fields = []; $params = [];
        foreach (['name', 'email', 'phone', 'status'] as $f) {
            if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $stmt = $db->prepare('UPDATE marketing_members SET ' . implode(', ', $fields) . ' WHERE id = ?');
        $stmt->execute($params);
        respond(['message' => 'Member updated']);
    }
    if ($method === 'DELETE') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing']);
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'marketing_members', $id, $tokenData);
        $stmt = $db->prepare('DELETE FROM marketing_members WHERE id = ?');
        $stmt->execute([$id]);
        respond(['message' => 'Member deleted']);
    }
}

// ---- Email Drafts ----
if ($action === 'email_drafts') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        [$w, $params] = marketingOrgScope($db, $tokenData, '');
        if ((!empty($_GET['mine']) && $_GET['mine'] !== '0') || marketingNormRole($tokenData) === 'marketing') {
            $w .= ' AND created_by = ?';
            $params[] = $userId;
        }
        $stmt = $db->prepare("SELECT * FROM email_drafts WHERE ($w) ORDER BY updated_at DESC");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO email_drafts (id, name, subject, html_body, plain_text, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['name'] ?? '', $input['subject'] ?? '', $input['html_body'] ?? '', $input['plain_text'] ?? null, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Draft created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'email_drafts', $id, $tokenData);
        $input = getInput();
        $fields = []; $params = [];
        foreach (['name', 'subject', 'html_body', 'plain_text', 'status'] as $f) {
            if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $stmt = $db->prepare('UPDATE email_drafts SET ' . implode(', ', $fields) . ' WHERE id = ?');
        $stmt->execute($params);
        respond(['message' => 'Draft updated']);
    }
    if ($method === 'DELETE') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'email_drafts', $id, $tokenData);
        $stmt = $db->prepare('DELETE FROM email_drafts WHERE id = ?');
        $stmt->execute([$id]);
        respond(['message' => 'Draft deleted']);
    }
}

// ---- Email Campaigns ----
if ($action === 'email_campaigns') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        [$w, $params] = marketingOrgScope($db, $tokenData, 'ec');
        if ((!empty($_GET['mine']) && $_GET['mine'] !== '0') || marketingNormRole($tokenData) === 'marketing') {
            $w .= ' AND ec.created_by = ?';
            $params[] = $userId;
        }
        $stmt = $db->prepare("
            SELECT ec.*, ed.name as draft_name
            FROM email_campaigns ec
            LEFT JOIN email_drafts ed ON ec.draft_id = ed.id
            WHERE ($w)
            ORDER BY ec.created_at DESC
        ");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, pending_count, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $pending = (int) ($input['pending_count'] ?? $input['recipient_count'] ?? 0);
        $stmt->execute([$id, $input['subject'], $input['draft_id'] ?? null, $input['recipient_count'] ?? 0, $pending, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Campaign created', 'data' => [
            'id' => $id,
            'subject' => $input['subject'] ?? '',
            'draft_id' => $input['draft_id'] ?? null,
            'recipient_count' => (int) ($input['recipient_count'] ?? 0),
            'pending_count' => $pending,
            'status' => $input['status'] ?? 'draft',
            'created_by' => $userId,
        ]], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'email_campaigns', $id, $tokenData);
        $input = getInput();
        $fields = []; $params = [];
        foreach (['subject', 'draft_id', 'recipient_count', 'sent_count', 'failed_count', 'pending_count', 'status'] as $f) {
            if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $stmt = $db->prepare('UPDATE email_campaigns SET ' . implode(', ', $fields) . ' WHERE id = ?');
        $stmt->execute($params);
        respond(['message' => 'Campaign updated']);
    }
}

// ---- WhatsApp Drafts ----
if ($action === 'whatsapp_drafts') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        [$w, $params] = marketingOrgScope($db, $tokenData, '');
        if ((!empty($_GET['mine']) && $_GET['mine'] !== '0') || marketingNormRole($tokenData) === 'marketing') {
            $w .= ' AND created_by = ?';
            $params[] = $userId;
        }
        $stmt = $db->prepare("SELECT * FROM whatsapp_drafts WHERE ($w) ORDER BY updated_at DESC");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO whatsapp_drafts (id, name, subject, body, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['name'] ?? '', $input['subject'] ?? '', $input['body'] ?? '', $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Draft created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'whatsapp_drafts', $id, $tokenData);
        $input = getInput();
        $fields = []; $params = [];
        foreach (['name', 'subject', 'body', 'status'] as $f) {
            if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $stmt = $db->prepare('UPDATE whatsapp_drafts SET ' . implode(', ', $fields) . ' WHERE id = ?');
        $stmt->execute($params);
        respond(['message' => 'Draft updated']);
    }
    if ($method === 'DELETE') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'whatsapp_drafts', $id, $tokenData);
        $stmt = $db->prepare('DELETE FROM whatsapp_drafts WHERE id = ?');
        $stmt->execute([$id]);
        respond(['message' => 'Draft deleted']);
    }
}

// ---- WhatsApp Campaigns ----
if ($action === 'whatsapp_campaigns') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        [$w, $params] = marketingOrgScope($db, $tokenData, 'wc');
        if ((!empty($_GET['mine']) && $_GET['mine'] !== '0') || marketingNormRole($tokenData) === 'marketing') {
            $w .= ' AND wc.created_by = ?';
            $params[] = $userId;
        }
        $stmt = $db->prepare("
            SELECT wc.*, wd.name as draft_name
            FROM whatsapp_campaigns wc
            LEFT JOIN whatsapp_drafts wd ON wc.draft_id = wd.id
            WHERE ($w)
            ORDER BY wc.created_at DESC
        ");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO whatsapp_campaigns (id, subject, draft_id, recipient_count, pending_count, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $pending = (int) ($input['pending_count'] ?? $input['recipient_count'] ?? 0);
        $stmt->execute([$id, $input['subject'], $input['draft_id'] ?? null, $input['recipient_count'] ?? 0, $pending, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Campaign created', 'data' => [
            'id' => $id,
            'subject' => $input['subject'] ?? '',
            'draft_id' => $input['draft_id'] ?? null,
            'recipient_count' => (int) ($input['recipient_count'] ?? 0),
            'pending_count' => $pending,
            'status' => $input['status'] ?? 'draft',
            'created_by' => $userId,
        ]], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, marketingGateRoles());
        $id = $_GET['id'] ?? '';
        if (!$id) respond(['error' => 'ID required'], 400);
        marketingAssertRowInScope($db, 'whatsapp_campaigns', $id, $tokenData);
        $input = getInput();
        $fields = []; $params = [];
        foreach (['subject', 'draft_id', 'recipient_count', 'sent_count', 'failed_count', 'pending_count', 'status'] as $f) {
            if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $stmt = $db->prepare('UPDATE whatsapp_campaigns SET ' . implode(', ', $fields) . ' WHERE id = ?');
        $stmt->execute($params);
        respond(['message' => 'Campaign updated']);
    }
}

// ---- Email Sends ----
if ($action === 'email_sends') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        $idsRaw = trim((string) ($_GET['campaign_ids'] ?? $_GET['campaign_id'] ?? ''));
        if ($idsRaw === '') {
            respond(['data' => []]);
        }
        $idList = array_values(array_filter(array_map('trim', explode(',', $idsRaw))));
        if ($idList === []) {
            respond(['data' => []]);
        }
        [$w, $scopeParams] = marketingOrgScope($db, $tokenData, 'ec');
        $placeholders = implode(',', array_fill(0, count($idList), '?'));
        $stmt = $db->prepare("
            SELECT es.*
            FROM email_sends es
            INNER JOIN email_campaigns ec ON ec.id = es.campaign_id
            WHERE es.campaign_id IN ($placeholders) AND ($w)
            ORDER BY es.created_at DESC
            LIMIT 1000
        ");
        $stmt->execute(array_merge($idList, $scopeParams));
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $campaignId = trim((string) ($input['campaign_id'] ?? ''));
        $recipients = $input['recipients'] ?? [];
        if ($campaignId === '' || !is_array($recipients)) {
            respond(['error' => 'campaign_id and recipients array required'], 400);
        }
        marketingAssertRowInScope($db, 'email_campaigns', $campaignId, $tokenData);
        $stmt = $db->prepare('INSERT INTO email_sends (id, campaign_id, recipient_email, status) VALUES (?, ?, ?, ?)');
        $count = 0;
        foreach ($recipients as $row) {
            $email = is_array($row)
                ? trim((string) ($row['recipient_email'] ?? $row['email'] ?? ''))
                : trim((string) $row);
            if ($email === '') {
                continue;
            }
            $status = is_array($row) ? (string) ($row['status'] ?? 'pending') : 'pending';
            $stmt->execute([generateUUID(), $campaignId, $email, $status]);
            $count++;
        }
        respond(['message' => 'Sends recorded', 'count' => $count], 201);
    }
}

// ---- WhatsApp Sends ----
if ($action === 'whatsapp_sends') {
    if ($method === 'GET') {
        requireRole($tokenData, marketingGateRoles());
        $idsRaw = trim((string) ($_GET['campaign_ids'] ?? $_GET['campaign_id'] ?? ''));
        if ($idsRaw === '') {
            respond(['data' => []]);
        }
        $idList = array_values(array_filter(array_map('trim', explode(',', $idsRaw))));
        if ($idList === []) {
            respond(['data' => []]);
        }
        [$w, $scopeParams] = marketingOrgScope($db, $tokenData, 'wc');
        $placeholders = implode(',', array_fill(0, count($idList), '?'));
        $stmt = $db->prepare("
            SELECT ws.*
            FROM whatsapp_sends ws
            INNER JOIN whatsapp_campaigns wc ON wc.id = ws.campaign_id
            WHERE ws.campaign_id IN ($placeholders) AND ($w)
            ORDER BY ws.created_at DESC
            LIMIT 1000
        ");
        $stmt->execute(array_merge($idList, $scopeParams));
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, marketingGateRoles());
        $input = getInput();
        $campaignId = trim((string) ($input['campaign_id'] ?? ''));
        $recipients = $input['recipients'] ?? [];
        if ($campaignId === '' || !is_array($recipients)) {
            respond(['error' => 'campaign_id and recipients array required'], 400);
        }
        marketingAssertRowInScope($db, 'whatsapp_campaigns', $campaignId, $tokenData);
        $stmt = $db->prepare('INSERT INTO whatsapp_sends (id, campaign_id, recipient_phone, status) VALUES (?, ?, ?, ?)');
        $count = 0;
        foreach ($recipients as $row) {
            $phone = is_array($row)
                ? trim((string) ($row['recipient_phone'] ?? $row['phone'] ?? ''))
                : trim((string) $row);
            if ($phone === '') {
                continue;
            }
            $status = is_array($row) ? (string) ($row['status'] ?? 'pending') : 'pending';
            $stmt->execute([generateUUID(), $campaignId, $phone, $status]);
            $count++;
        }
        respond(['message' => 'Sends recorded', 'count' => $count], 201);
    }
}

if ($action === 'upload_resume' && $method === 'POST') {
    if (!marketingIsPrivileged($tokenData)) {
        respond(['error' => 'Forbidden'], 403);
    }
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'multipart/form-data') === false) {
        respond(['error' => 'Expected multipart/form-data'], 400);
    }
    if (empty($_FILES['resume'])) {
        respond(['error' => 'resume file required'], 400);
    }
    $path = saveLeadResumeUpload($_FILES['resume']);
    if ($path === null) {
        respond(['error' => 'Resume file required'], 400);
    }
    respond(['success' => true, 'resume_path' => $path]);
}

if ($action === 'n8n_webhook' && $method === 'POST') {
    requireRole($tokenData, marketingGateRoles());
    $input = getInput();
    $channel = strtolower(trim((string) ($input['channel'] ?? '')));
    $payload = $input['payload'] ?? null;
    if (!is_array($payload)) {
        respond(['error' => 'payload object is required'], 400);
    }
    $url = '';
    if ($channel === 'whatsapp' && defined('N8N_WHATSAPP_WEBHOOK')) {
        $url = trim((string) N8N_WHATSAPP_WEBHOOK);
    } elseif ($channel === 'email' && defined('N8N_EMAIL_WEBHOOK')) {
        $url = trim((string) N8N_EMAIL_WEBHOOK);
    }
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        respond(['ok' => false, 'skipped' => true, 'message' => 'n8n webhook not configured on server'], 200);
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno) {
        respond(['ok' => false, 'error' => 'Webhook request failed'], 502);
    }
    respond(['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => is_string($body) ? substr($body, 0, 500) : '']);
}

// ---- Dispatch email campaign via org SMTP (Email Setup) ----
if ($action === 'dispatch_email_campaign' && $method === 'POST') {
    requireRole($tokenData, marketingGateRoles());
    require_once __DIR__ . '/org_email_service.php';
    require_once __DIR__ . '/mail_transport.php';

    $input = getInput();
    $draftId = trim((string) ($input['draft_id'] ?? ''));
    $recipientsIn = $input['recipients'] ?? [];
    if ($draftId === '' || !is_array($recipientsIn)) {
        respond(['error' => 'draft_id and recipients array required'], 400);
    }

    $draft = marketingAssertRowInScope($db, 'email_drafts', $draftId, $tokenData);
    $orgId = trim((string) ($draft['org_id'] ?? ''));
    if ($orgId === '') {
        $orgId = trim((string) (marketingResolveOrgId($tokenData, $input, $db) ?? ''));
    }

    $emails = [];
    foreach ($recipientsIn as $row) {
        $email = is_array($row)
            ? trim((string) ($row['recipient_email'] ?? $row['email'] ?? ''))
            : trim((string) $row);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $emails[strtolower($email)] = $email;
        }
    }
    $emails = array_values($emails);
    if ($emails === []) {
        respond(['error' => 'No valid recipient emails'], 400);
    }

    $campaignId = generateUUID();
    $subject = (string) ($draft['subject'] ?? $draft['name'] ?? 'Campaign');
    $html = (string) ($draft['html_body'] ?? '');
    if ($html === '') {
        $html = '<p>' . nl2br(htmlspecialchars((string) ($draft['plain_text'] ?? ''), ENT_QUOTES, 'UTF-8')) . '</p>';
    }

    $db->prepare('INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $campaignId,
            $subject,
            $draftId,
            count($emails),
            count($emails),
            0,
            0,
            'sending',
            $userId,
            $orgId !== '' ? $orgId : null,
        ]);

    $sendStmt = $db->prepare('INSERT INTO email_sends (id, campaign_id, recipient_email, status, error_message) VALUES (?,?,?,?,?)');
    $sent = 0;
    $failed = 0;
    $firstError = null;
    $fromAddr = function_exists('syncpediaSupportMailAddress') ? syncpediaSupportMailAddress() : 'support@syncpedia.in';
    $fromName = 'Syncpedia';

    if ($orgId !== '') {
        syncpediaSetMailContext($orgId, 'marketing_campaigns');
    } else {
        syncpediaSetMailContext(null, 'marketing_campaigns');
    }

    foreach ($emails as $email) {
        $res = syncpediaSendHtmlEmailViaSmtp($email, $subject, $html, $fromAddr, $fromName);
        $ok = !empty($res['ok']);
        if ($ok) {
            $sent++;
        } else {
            $failed++;
            if ($firstError === null) {
                $firstError = trim((string) ($res['error'] ?? 'SMTP send failed'));
            }
        }
        $sendStmt->execute([
            generateUUID(),
            $campaignId,
            $email,
            $ok ? 'sent' : 'failed',
            $ok ? null : ($res['error'] ?? 'Send failed'),
        ]);
    }

    $pending = max(0, count($emails) - $sent - $failed);
    $status = ($sent === 0 && $failed > 0) ? 'failed' : 'completed';
    $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
        ->execute([$sent, $failed, $pending, $status, $campaignId]);

    // Optional n8n mirror (does not block SMTP delivery)
    $n8nUrl = (defined('N8N_EMAIL_WEBHOOK') ? trim((string) N8N_EMAIL_WEBHOOK) : '');
    if ($n8nUrl !== '' && preg_match('#^https?://#i', $n8nUrl)) {
        $ch = curl_init($n8nUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode([
                'campaign_id' => $campaignId,
                'subject' => $subject,
                'html_body' => $html,
                'recipients' => $emails,
            ]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }

    respond([
        'ok' => $sent > 0,
        'campaign_id' => $campaignId,
        'sent' => $sent,
        'failed' => $failed,
        'pending' => $pending,
        'error' => $sent === 0 ? ($firstError ?: 'No emails were sent. Configure Email Setup for your organization.') : null,
        'message' => $sent > 0
            ? "Sent {$sent} email(s)" . ($failed ? ", {$failed} failed" : '')
            : ($firstError ?: 'Send failed'),
    ], $sent > 0 ? 200 : 502);
}

// ---- Dispatch WhatsApp campaign via Meta (templates) or session text (drafts) ----
if ($action === 'dispatch_whatsapp_campaign' && $method === 'POST') {
    requireRole($tokenData, marketingGateRoles());
    require_once __DIR__ . '/communications_org.php';

    $input = getInput();
    $source = strtolower(trim((string) ($input['source'] ?? 'communications')));
    $templateId = trim((string) ($input['template_id'] ?? $input['draft_id'] ?? ''));
    $recipientsIn = $input['recipients'] ?? [];
    $variablesIn = $input['variables'] ?? [];
    if ($templateId === '' || !is_array($recipientsIn)) {
        respond(['error' => 'template_id/draft_id and recipients array required'], 400);
    }
    $baseVars = [];
    if (is_array($variablesIn)) {
        foreach ($variablesIn as $v) {
            $baseVars[] = trim((string) $v);
        }
    }

    $recipients = [];
    foreach ($recipientsIn as $row) {
        $phone = is_array($row)
            ? trim((string) ($row['recipient_phone'] ?? $row['phone'] ?? ''))
            : trim((string) $row);
        $phone = preg_replace('/\s+/', '', $phone) ?? '';
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if ($phone === '' || strlen($digits) < 10) {
            continue;
        }
        $name = is_array($row) ? trim((string) ($row['name'] ?? $row['full_name'] ?? '')) : '';
        if (!isset($recipients[$digits])) {
            $recipients[$digits] = ['phone' => $phone, 'name' => $name];
        } elseif ($name !== '' && $recipients[$digits]['name'] === '') {
            $recipients[$digits]['name'] = $name;
        }
    }
    $recipients = array_values($recipients);
    if ($recipients === []) {
        respond(['error' => 'No valid recipient phone numbers'], 400);
    }

    $orgId = trim((string) (marketingResolveOrgId($tokenData, $input, $db) ?? ''));
    $subject = 'WhatsApp campaign';
    $bodyText = '';
    $template = null;

    if ($source === 'communications') {
        $tst = $db->prepare("SELECT * FROM whatsapp_message_templates WHERE id = ? AND status = 'approved' LIMIT 1");
        $tst->execute([$templateId]);
        $template = $tst->fetch(PDO::FETCH_ASSOC);
        if (!$template) {
            respond(['error' => 'Approved WhatsApp template not found. Complete Setup step 2: Sync Meta templates.'], 404);
        }
        $templateOrg = trim((string) ($template['org_id'] ?? ''));
        if ($orgId === '') {
            $orgId = $templateOrg;
        }
        if ($templateOrg !== '' && $orgId !== '' && $templateOrg !== $orgId && marketingNormRole($tokenData) !== 'super_admin') {
            respond(['error' => 'Template belongs to another organization'], 403);
        }
        if ($templateOrg !== '') {
            $orgId = $templateOrg;
        }
        $subject = (string) ($template['name'] ?? 'WhatsApp template');
        $bodyText = (string) ($template['body'] ?? '');
        $needed = 0;
        if (preg_match_all('/\{\{(\d+)\}\}/', $bodyText, $m)) {
            $nums = array_map('intval', $m[1]);
            $needed = $nums !== [] ? max($nums) : 0;
        }
        if ($needed === 0 && !empty($template['variables'])) {
            $decoded = is_string($template['variables'])
                ? json_decode($template['variables'], true)
                : $template['variables'];
            if (is_array($decoded)) {
                $needed = count($decoded);
            }
        }
        // Pad / trim shared template vars to Meta's expected count.
        while (count($baseVars) < $needed) {
            $baseVars[] = '';
        }
        if ($needed > 0) {
            $baseVars = array_slice($baseVars, 0, $needed);
        }
        // Require all params except {{1}}, which may be filled per-recipient from name.
        for ($i = 0; $i < $needed; $i++) {
            if ($i === 0) {
                continue;
            }
            if ($baseVars[$i] === '') {
                respond([
                    'error' => "Template requires {{" . ($i + 1) . "}}. Fill all parameters before sending.",
                ], 400);
            }
        }
        if ($needed > 0 && $baseVars[0] === '') {
            $anyNamed = false;
            foreach ($recipients as $rec) {
                if (trim((string) ($rec['name'] ?? '')) !== '') {
                    $anyNamed = true;
                    break;
                }
            }
            if (!$anyNamed) {
                respond([
                    'error' => 'Template requires {{1}}. Enter a value, or select named leads/members so {{1}} can use each recipient name.',
                ], 400);
            }
        }
    } else {
        $draft = marketingAssertRowInScope($db, 'whatsapp_drafts', $templateId, $tokenData);
        if ($orgId === '') {
            $orgId = trim((string) ($draft['org_id'] ?? ''));
        }
        $subject = (string) ($draft['subject'] ?? $draft['name'] ?? 'WhatsApp campaign');
        $bodyText = trim((string) ($draft['body'] ?? ''));
        if ($bodyText === '') {
            respond(['error' => 'Draft body is empty'], 400);
        }
    }

    if ($orgId === '') {
        respond(['error' => 'Organization is required. Complete Setup step 1: Connect WhatsApp.'], 400);
    }

    $cfg = commLoadOrgConfig($db, $orgId);
    if ($cfg === [] || !(int) ($cfg['is_active'] ?? 0)) {
        respond(['error' => 'WhatsApp is not connected for your organization. Complete Setup step 1 in WhatsApp Marketing.'], 400);
    }

    $campaignId = generateUUID();
    $db->prepare('INSERT INTO whatsapp_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $campaignId,
            $subject,
            $source === 'marketing' ? $templateId : null,
            count($recipients),
            count($recipients),
            0,
            0,
            'sending',
            $userId,
            $orgId,
        ]);

    $sendStmt = $db->prepare('INSERT INTO whatsapp_sends (id, campaign_id, recipient_phone, status, error_message) VALUES (?,?,?,?,?)');
    $sent = 0;
    $failed = 0;
    $firstError = null;
    $phoneList = [];

    foreach ($recipients as $rec) {
        $phone = (string) $rec['phone'];
        $name = trim((string) ($rec['name'] ?? ''));
        $phoneList[] = $phone;
        $res = ['ok' => false, 'error' => 'Send failed'];
        if ($source === 'communications' && is_array($template)) {
            $vars = $baseVars;
            if ($vars !== [] && ($vars[0] ?? '') === '' && $name !== '') {
                $vars[0] = $name;
            } elseif ($vars === [] && $name !== '') {
                $vars = [$name];
            }
            $missingParam = null;
            foreach ($vars as $vi => $vv) {
                if (trim((string) $vv) === '') {
                    $missingParam = $vi + 1;
                    break;
                }
            }
            if ($missingParam !== null) {
                $res = [
                    'ok' => false,
                    'error' => 'Missing template parameter {{' . $missingParam . '}} for ' . $phone,
                ];
            } else {
                $res = commSendViaOrgProvider($db, $orgId, $phone, $template, $vars, null);
            }
        } else {
            $personalized = $bodyText;
            if ($name !== '') {
                $personalized = str_replace(
                    ['{{name}}', '{name}', '{{1}}', '{{Name}}'],
                    $name,
                    $personalized
                );
            }
            $res = commSendTextViaOrgProvider($db, $orgId, $phone, $personalized);
        }
        $ok = !empty($res['ok']);
        if ($ok) {
            $sent++;
        } else {
            $failed++;
            if ($firstError === null) {
                $firstError = trim((string) ($res['error'] ?? 'WhatsApp send failed'));
            }
        }
        $sendStmt->execute([
            generateUUID(),
            $campaignId,
            $phone,
            $ok ? 'sent' : 'failed',
            $ok ? null : ($res['error'] ?? 'Send failed'),
        ]);
    }

    $pending = max(0, count($recipients) - $sent - $failed);
    $status = ($sent === 0 && $failed > 0) ? 'failed' : 'completed';
    $db->prepare('UPDATE whatsapp_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
        ->execute([$sent, $failed, $pending, $status, $campaignId]);

    $n8nUrl = (defined('N8N_WHATSAPP_WEBHOOK') ? trim((string) N8N_WHATSAPP_WEBHOOK) : '');
    if ($n8nUrl !== '' && preg_match('#^https?://#i', $n8nUrl)) {
        $ch = curl_init($n8nUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode([
                'campaign_id' => $campaignId,
                'subject' => $subject,
                'body' => $bodyText,
                'recipients' => $phoneList,
                'source' => $source,
            ]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }

    $hint = '';
    if ($source !== 'communications' && $failed > 0) {
        $hint = ' Free-text drafts only work inside the 24-hour customer care window. Use Setup step 2 templates for cold outreach.';
    }

    respond([
        'ok' => $sent > 0,
        'campaign_id' => $campaignId,
        'sent' => $sent,
        'failed' => $failed,
        'pending' => $pending,
        'source' => $source,
        'error' => $sent === 0 ? (($firstError ?: 'No WhatsApp messages were sent') . $hint) : null,
        'message' => $sent > 0
            ? ("Sent {$sent} message(s)" . ($failed ? ", {$failed} failed" : '') . $hint)
            : (($firstError ?: 'Send failed') . $hint),
    ], $sent > 0 ? 200 : 502);
}

respond(['error' => 'Invalid action. Use ?action=members|email_drafts|email_campaigns|email_sends|whatsapp_drafts|whatsapp_campaigns|whatsapp_sends|upload_resume|n8n_webhook|dispatch_email_campaign|dispatch_whatsapp_campaign'], 400);
