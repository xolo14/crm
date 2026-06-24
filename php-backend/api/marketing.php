<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

$action = $_GET['action'] ?? '';

function marketingNormRole(array $tokenData): string {
    $r = strtolower(trim($tokenData['role'] ?? ''));
    if ($r === 'superadmin') return 'super_admin';
    if (strpos($r, 'marketing') === 0) return 'marketing';
    return $r;
}

function marketingIsPrivileged(array $tokenData): bool {
    $r = marketingNormRole($tokenData);
    return in_array($r, ['super_admin', 'admin', 'marketing', 'manager'], true);
}

/** WHERE fragment + params: SuperAdmin → all rows; everyone else → own org only */
function marketingOrgScope(array $tokenData, string $alias): array {
    $role = marketingNormRole($tokenData);
    $prefix = $alias !== '' ? $alias . '.' : '';
    if ($role === 'super_admin') {
        return ['1=1', []];
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
    $orgId = $tokenData['org_id'] ?? null;
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
            [$w, $params] = marketingOrgScope($tokenData, '');
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        [$w, $params] = marketingOrgScope($tokenData, '');
        $stmt = $db->prepare("SELECT * FROM email_drafts WHERE ($w) ORDER BY updated_at DESC");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO email_drafts (id, name, subject, html_body, plain_text, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['name'] ?? '', $input['subject'] ?? '', $input['html_body'] ?? '', $input['plain_text'] ?? null, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Draft created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        [$w, $params] = marketingOrgScope($tokenData, 'ec');
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['subject'], $input['draft_id'] ?? null, $input['recipient_count'] ?? 0, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Campaign created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        [$w, $params] = marketingOrgScope($tokenData, '');
        $stmt = $db->prepare("SELECT * FROM whatsapp_drafts WHERE ($w) ORDER BY updated_at DESC");
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }
    if ($method === 'POST') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO whatsapp_drafts (id, name, subject, body, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['name'] ?? '', $input['subject'] ?? '', $input['body'] ?? '', $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Draft created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        [$w, $params] = marketingOrgScope($tokenData, 'wc');
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
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
        $input = getInput();
        $id = generateUUID();
        $orgId = marketingResolveOrgId($tokenData, $input, $db);
        $stmt = $db->prepare('INSERT INTO whatsapp_campaigns (id, subject, draft_id, recipient_count, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $input['subject'], $input['draft_id'] ?? null, $input['recipient_count'] ?? 0, $input['status'] ?? 'draft', $userId, $orgId]);
        respond(['id' => $id, 'message' => 'Campaign created'], 201);
    }
    if ($method === 'PUT') {
        requireRole($tokenData, ['admin', 'super_admin', 'marketing', 'manager']);
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

respond(['error' => 'Invalid action. Use ?action=members|email_drafts|email_campaigns|whatsapp_drafts|whatsapp_campaigns|upload_resume'], 400);
