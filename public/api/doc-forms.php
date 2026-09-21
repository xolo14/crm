<?php
/**
 * Document Forms API — Certificates & Offer Letters forms (separate from lead_forms).
 *
 * Actions (GET): list, get, access, submissions, issued, link
 * Actions (POST): create, assign, submit, add_manual_row, link_template, unlink_template, save_column_maps, update_submission_values, issue
 * PUT: update form
 * DELETE: form | access row | submission
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$action = trim((string) ($_GET['action'] ?? ''));

function docFormsEnsureSchema(PDO $db): void {
    static $done = false;
    if ($done) return;
    $stmts = [
        "CREATE TABLE IF NOT EXISTS doc_forms (
            id CHAR(36) NOT NULL PRIMARY KEY,
            org_id CHAR(36) DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(120) NOT NULL,
            description TEXT DEFAULT NULL,
            form_type VARCHAR(32) NOT NULL,
            fields_json JSON DEFAULT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by CHAR(36) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_doc_forms_org_slug (org_id, slug),
            INDEX idx_doc_forms_type (form_type),
            INDEX idx_doc_forms_org (org_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS doc_form_access (
            id CHAR(36) NOT NULL PRIMARY KEY,
            form_id CHAR(36) NOT NULL,
            access_type VARCHAR(16) NOT NULL,
            user_id CHAR(36) DEFAULT NULL,
            role_key VARCHAR(64) DEFAULT NULL,
            assigned_by CHAR(36) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_dfa_form (form_id),
            INDEX idx_dfa_user (user_id),
            INDEX idx_dfa_role (role_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS doc_form_template_links (
            id CHAR(36) NOT NULL PRIMARY KEY,
            form_id CHAR(36) NOT NULL,
            org_id CHAR(36) DEFAULT NULL,
            template_kind VARCHAR(32) NOT NULL,
            template_id CHAR(36) NOT NULL,
            column_maps_json JSON DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_dftl_form (form_id),
            INDEX idx_dftl_template (template_kind, template_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS doc_form_submissions (
            id CHAR(36) NOT NULL PRIMARY KEY,
            form_id CHAR(36) NOT NULL,
            org_id CHAR(36) DEFAULT NULL,
            submitted_by CHAR(36) DEFAULT NULL,
            respondent_name VARCHAR(255) DEFAULT NULL,
            respondent_email VARCHAR(255) DEFAULT NULL,
            answers_json JSON DEFAULT NULL,
            values_json JSON DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'submitted',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_dfs_form (form_id),
            INDEX idx_dfs_status (status),
            INDEX idx_dfs_org (org_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS doc_issued_documents (
            id CHAR(36) NOT NULL PRIMARY KEY,
            org_id CHAR(36) DEFAULT NULL,
            doc_kind VARCHAR(32) NOT NULL,
            form_id CHAR(36) DEFAULT NULL,
            submission_id CHAR(36) DEFAULT NULL,
            template_id CHAR(36) DEFAULT NULL,
            recipient_name VARCHAR(255) DEFAULT NULL,
            recipient_email VARCHAR(255) DEFAULT NULL,
            subject VARCHAR(500) DEFAULT NULL,
            pdf_path VARCHAR(500) DEFAULT NULL,
            pdf_url VARCHAR(500) DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'issued',
            issued_by CHAR(36) DEFAULT NULL,
            issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            meta_json JSON DEFAULT NULL,
            INDEX idx_did_kind (doc_kind),
            INDEX idx_did_org (org_id),
            INDEX idx_did_form (form_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];
    foreach ($stmts as $sql) {
        try {
            $db->exec($sql);
        } catch (Throwable $e) {
            /* ignore */
        }
    }
    try {
        if (!syncpediaColumnExists($db, 'offer_letter_templates', 'mail_json')) {
            $db->exec('ALTER TABLE offer_letter_templates ADD COLUMN mail_json JSON DEFAULT NULL');
        }
    } catch (Throwable $e) {
        /* ignore */
    }
    try {
        if (!syncpediaColumnExists($db, 'doc_forms', 'meta_json')) {
            $db->exec('ALTER TABLE doc_forms ADD COLUMN meta_json JSON DEFAULT NULL');
        }
    } catch (Throwable $e) {
        /* ignore */
    }
    try {
        if (!syncpediaColumnExists($db, 'doc_form_submissions', 'referred_by')) {
            $db->exec('ALTER TABLE doc_form_submissions ADD COLUMN referred_by VARCHAR(48) DEFAULT NULL');
        }
    } catch (Throwable $e) {
        /* ignore */
    }
    $done = true;
}

/** Org admins see/manage all tenant doc forms. Managers only see own + assigned. */
function docFormsIsOrgAdmin(array $tokenData): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($role, ['super_admin', 'admin', 'org'], true);
}

/** @deprecated use docFormsIsOrgAdmin — kept name for call sites that mean org admin */
function docFormsIsAdmin(array $tokenData): bool {
    return docFormsIsOrgAdmin($tokenData);
}

function docFormsIsManager(array $tokenData): bool {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($role, ['manager', 'operational_manager'], true);
}

/** Roles that may link templates, manage submissions, and issue documents. */
function docFormsWorkflowRoles(): array
{
    return ['admin', 'super_admin', 'org', 'manager', 'operational_manager', 'hr'];
}

/** Roles that may create forms and manage assignments (not HR). */
function docFormsManagerRoles(): array
{
    return ['admin', 'super_admin', 'org', 'manager', 'operational_manager'];
}

function docFormsUserOwnsForm(PDO $db, array $tokenData, string $formId): bool {
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($userId === '' || $formId === '') {
        return false;
    }
    $st = $db->prepare('SELECT created_by FROM doc_forms WHERE id = ? LIMIT 1');
    $st->execute([$formId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return false;
    }
    return trim((string) ($row['created_by'] ?? '')) === $userId;
}

/** Create/edit/delete/assign: org admin or form creator. */
function docFormsUserCanManageForm(PDO $db, array $tokenData, string $formId): bool {
    if (docFormsIsOrgAdmin($tokenData)) {
        return true;
    }
    return docFormsUserOwnsForm($db, $tokenData, $formId);
}

function docFormsUserIsAssigned(PDO $db, array $tokenData, string $formId): bool {
    $userId = (string) ($tokenData['user_id'] ?? '');
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $st = $db->prepare(
        "SELECT 1 FROM doc_form_access
         WHERE form_id = ?
           AND (
             (access_type = 'user' AND user_id = ?)
             OR (access_type = 'role' AND LOWER(role_key) = ?)
           )
         LIMIT 1"
    );
    $st->execute([$formId, $userId, $role]);
    return (bool) $st->fetchColumn();
}

function docFormsUserCanAccessForm(PDO $db, array $tokenData, string $formId): bool {
    if (docFormsIsOrgAdmin($tokenData)) {
        return true;
    }
    if (docFormsUserOwnsForm($db, $tokenData, $formId)) {
        return true;
    }
    return docFormsUserIsAssigned($db, $tokenData, $formId);
}

function docFormsOrgId(array $tokenData): ?string {
    $orgId = getOrgId($tokenData);
    if (($orgId === null || trim((string) $orgId) === '')
        && syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        return null;
    }
    return $orgId !== null && trim((string) $orgId) !== '' ? (string) $orgId : null;
}

function docFormsDecodeJson(?string $raw): array {
    if ($raw === null || trim($raw) === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function docFormsSlugify(string $name): string {
    $s = strtolower(trim($name));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    $s = trim($s, '-');
    return $s !== '' ? substr($s, 0, 100) : ('form-' . substr(generateUUID(), 0, 8));
}

function docFormsUniqueSlug(PDO $db, ?string $orgId, string $base, string $exceptId = ''): string {
    $root = $base !== '' ? $base : ('form-' . substr(generateUUID(), 0, 8));
    $slug = $root;
    for ($n = 2; $n < 200; $n++) {
        if ($orgId === null || $orgId === '') {
            $st = $db->prepare('SELECT id FROM doc_forms WHERE (org_id IS NULL OR org_id = "") AND slug = ? LIMIT 1');
            $st->execute([$slug]);
        } else {
            $st = $db->prepare('SELECT id FROM doc_forms WHERE org_id = ? AND slug = ? LIMIT 1');
            $st->execute([$orgId, $slug]);
        }
        $hit = $st->fetchColumn();
        if (!$hit || ($exceptId !== '' && (string) $hit === $exceptId)) {
            return $slug;
        }
        $slug = substr($root, 0, 90) . '-' . $n;
    }
    return $root . '-' . substr(generateUUID(), 0, 6);
}

function docFormsFetchForm(PDO $db, string $id): ?array {
    $st = $db->prepare('SELECT * FROM doc_forms WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function docFormsNormalizeFormRow(array $row): array {
    $row['fields_json'] = docFormsDecodeJson($row['fields_json'] ?? null);
    $row['meta_json'] = docFormsDecodeJson($row['meta_json'] ?? null);
    $row['is_active'] = (int) ($row['is_active'] ?? 1) === 1;
    return $row;
}

function docFormsApplyPlaceholders(string $text, array $values): string {
    return preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', static function ($m) use ($values) {
        $key = $m[1];
        if (array_key_exists($key, $values)) {
            return (string) $values[$key];
        }
        return $m[0];
    }, $text) ?? $text;
}

docFormsEnsureSchema($db);

// ---------- GET ----------
if ($method === 'GET') {
    if ($action === 'list' || $action === '') {
        $scope = strtolower(trim((string) ($_GET['scope'] ?? '')));
        $orgId = docFormsOrgId($tokenData);
        $type = trim((string) ($_GET['form_type'] ?? $_GET['type'] ?? ''));
        $userId = (string) ($tokenData['user_id'] ?? '');
        $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

        $whereDf = ['1=1'];
        $paramsDf = [];
        if ($orgId !== null) {
            $whereDf[] = 'df.org_id = ?';
            $paramsDf[] = $orgId;
        }
        if ($type === 'offer_letter' || $type === 'certificate') {
            $whereDf[] = 'df.form_type = ?';
            $paramsDf[] = $type;
        }
        $assignedSqlDf = "df.id IN (
            SELECT form_id FROM doc_form_access
            WHERE (access_type = 'user' AND user_id = ?)
               OR (access_type = 'role' AND LOWER(role_key) = ?)
        )";
        if ($scope === 'assigned') {
            $whereDf[] = $assignedSqlDf;
            $paramsDf[] = $userId;
            $paramsDf[] = $role;
            $whereDf[] = 'df.is_active = 1';
        } elseif (docFormsIsOrgAdmin($tokenData)) {
            // Full org roster for admins.
        } elseif (docFormsIsManager($tokenData)) {
            $whereDf[] = "(df.created_by = ? OR {$assignedSqlDf})";
            $paramsDf[] = $userId;
            $paramsDf[] = $userId;
            $paramsDf[] = $role;
        } else {
            $whereDf[] = $assignedSqlDf;
            $paramsDf[] = $userId;
            $paramsDf[] = $role;
            $whereDf[] = 'df.is_active = 1';
        }
        $sql = 'SELECT df.*,
                       o.name AS org_name,
                       COALESCE(NULLIF(TRIM(p.full_name), \'\'), NULLIF(TRIM(p.email), \'\'), NULL) AS created_by_name
                FROM doc_forms df
                LEFT JOIN organizations o ON o.id = df.org_id
                LEFT JOIN profiles p ON p.id = df.created_by
                WHERE ' . implode(' AND ', $whereDf) . '
                ORDER BY df.updated_at DESC LIMIT 500';
        $st = $db->prepare($sql);
        $st->execute($paramsDf);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $out = [];
        foreach ($rows as $r) {
            $form = docFormsNormalizeFormRow($r);
            $cnt = $db->prepare('SELECT COUNT(*) FROM doc_form_submissions WHERE form_id = ?');
            $cnt->execute([(string) $r['id']]);
            $form['submission_count'] = (int) $cnt->fetchColumn();
            $link = $db->prepare('SELECT * FROM doc_form_template_links WHERE form_id = ? LIMIT 1');
            $link->execute([(string) $r['id']]);
            $linkRow = $link->fetch(PDO::FETCH_ASSOC);
            if ($linkRow) {
                $linkRow['column_maps_json'] = docFormsDecodeJson($linkRow['column_maps_json'] ?? null);
                $form['template_link'] = $linkRow;
            } else {
                $form['template_link'] = null;
            }
            $formId = (string) $r['id'];
            if (docFormsUserCanManageForm($db, $tokenData, $formId)) {
                $acc = $db->prepare('SELECT * FROM doc_form_access WHERE form_id = ? ORDER BY created_at ASC');
                $acc->execute([$formId]);
                $form['access'] = $acc->fetchAll(PDO::FETCH_ASSOC) ?: [];
            }
            $out[] = $form;
        }
        respond(['data' => $out]);
    }

    if ($action === 'get') {
        $id = trim((string) ($_GET['id'] ?? ''));
        if ($id === '') respond(['error' => 'id required'], 400);
        $row = docFormsFetchForm($db, $id);
        if (!$row) respond(['error' => 'Form not found'], 404);
        if (!docFormsUserCanAccessForm($db, $tokenData, $id) && !docFormsIsAdmin($tokenData)) {
            respond(['error' => 'Forbidden'], 403);
        }
        $form = docFormsNormalizeFormRow($row);
        $acc = $db->prepare('SELECT * FROM doc_form_access WHERE form_id = ? ORDER BY created_at ASC');
        $acc->execute([$id]);
        $form['access'] = $acc->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $link = $db->prepare('SELECT * FROM doc_form_template_links WHERE form_id = ? LIMIT 1');
        $link->execute([$id]);
        $linkRow = $link->fetch(PDO::FETCH_ASSOC);
        if ($linkRow) {
            $linkRow['column_maps_json'] = docFormsDecodeJson($linkRow['column_maps_json'] ?? null);
        }
        $form['template_link'] = $linkRow ?: null;
        respond(['data' => $form]);
    }

    if ($action === 'access') {
        requireRole($tokenData, docFormsManagerRoles());
        $formId = trim((string) ($_GET['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $st = $db->prepare('SELECT * FROM doc_form_access WHERE form_id = ? ORDER BY created_at ASC');
        $st->execute([$formId]);
        respond(['data' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
    }

    if ($action === 'submissions') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $formId = trim((string) ($_GET['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $st = $db->prepare('SELECT * FROM doc_form_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT 2000');
        $st->execute([$formId]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as &$r) {
            $r['answers_json'] = docFormsDecodeJson($r['answers_json'] ?? null);
            $r['values_json'] = docFormsDecodeJson($r['values_json'] ?? null);
        }
        unset($r);
        $link = $db->prepare('SELECT * FROM doc_form_template_links WHERE form_id = ? LIMIT 1');
        $link->execute([$formId]);
        $linkRow = $link->fetch(PDO::FETCH_ASSOC);
        if ($linkRow) {
            $linkRow['column_maps_json'] = docFormsDecodeJson($linkRow['column_maps_json'] ?? null);
        }
        respond(['data' => $rows, 'template_link' => $linkRow ?: null]);
    }

    if ($action === 'issued') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $kind = trim((string) ($_GET['doc_kind'] ?? $_GET['kind'] ?? ''));
        $orgId = docFormsOrgId($tokenData);
        $params = [];
        $where = ['1=1'];
        if ($orgId !== null) {
            $where[] = 'org_id = ?';
            $params[] = $orgId;
        }
        if ($kind === 'offer_letter' || $kind === 'certificate') {
            $where[] = 'doc_kind = ?';
            $params[] = $kind;
        }
        $sql = 'SELECT * FROM doc_issued_documents WHERE ' . implode(' AND ', $where) . ' ORDER BY issued_at DESC LIMIT 2000';
        $st = $db->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as &$r) {
            $r['meta_json'] = docFormsDecodeJson($r['meta_json'] ?? null);
        }
        unset($r);
        respond(['data' => $rows]);
    }

    respond(['error' => 'Invalid action'], 400);
}

// ---------- POST ----------
if ($method === 'POST') {
    $input = getInput();
    if (!is_array($input)) $input = [];

    if ($action === 'create') {
        requireRole($tokenData, docFormsManagerRoles());
        $name = trim((string) ($input['name'] ?? ''));
        $formType = trim((string) ($input['form_type'] ?? ''));
        if ($name === '') respond(['error' => 'name is required'], 400);
        if (!in_array($formType, ['offer_letter', 'certificate'], true)) {
            respond(['error' => 'form_type must be offer_letter or certificate'], 400);
        }
        $id = generateUUID();
        $orgId = docFormsOrgId($tokenData);
        $slug = trim((string) ($input['slug'] ?? ''));
        if ($slug === '') $slug = docFormsSlugify($name);
        $slug = docFormsUniqueSlug($db, $orgId, docFormsSlugify($slug));
        $fields = $input['fields_json'] ?? [];
        if (!is_array($fields)) $fields = [];
        $meta = $input['meta_json'] ?? [];
        if (!is_array($meta)) $meta = [];
        $desc = isset($input['description']) ? (string) $input['description'] : null;
        $active = !empty($input['is_active']) || !isset($input['is_active']) ? 1 : 0;
        $st = $db->prepare(
            'INSERT INTO doc_forms (id, org_id, name, slug, description, form_type, fields_json, meta_json, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        try {
            $st->execute([
                $id,
                $orgId,
                $name,
                $slug,
                $desc,
                $formType,
                json_encode($fields, JSON_UNESCAPED_UNICODE),
                json_encode($meta, JSON_UNESCAPED_UNICODE),
                $active,
                $userId !== '' ? $userId : null,
            ]);
        } catch (Throwable $e) {
            // Older schema without meta_json
            $st = $db->prepare(
                'INSERT INTO doc_forms (id, org_id, name, slug, description, form_type, fields_json, is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $st->execute([
                $id,
                $orgId,
                $name,
                $slug,
                $desc,
                $formType,
                json_encode($fields, JSON_UNESCAPED_UNICODE),
                $active,
                $userId !== '' ? $userId : null,
            ]);
        }
        respond(['id' => $id, 'message' => 'Form created', 'slug' => $slug], 201);
    }

    if ($action === 'duplicate') {
        requireRole($tokenData, docFormsManagerRoles());
        $srcId = trim((string) ($input['id'] ?? $input['form_id'] ?? ''));
        if ($srcId === '') respond(['error' => 'id required'], 400);
        $src = docFormsFetchForm($db, $srcId);
        if (!$src) respond(['error' => 'Form not found'], 404);
        if (!docFormsUserCanManageForm($db, $tokenData, $srcId)) {
            respond(['error' => 'Forbidden'], 403);
        }
        $id = generateUUID();
        $orgId = $src['org_id'] ?? docFormsOrgId($tokenData);
        $name = trim((string) ($src['name'] ?? 'Form')) . ' (copy)';
        $slug = docFormsUniqueSlug($db, $orgId !== null ? (string) $orgId : null, docFormsSlugify($name));
        $st = $db->prepare(
            'INSERT INTO doc_forms (id, org_id, name, slug, description, form_type, fields_json, meta_json, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
        );
        $st->execute([
            $id,
            $orgId,
            $name,
            $slug,
            $src['description'] ?? null,
            $src['form_type'] ?? 'offer_letter',
            $src['fields_json'] ?? '[]',
            $src['meta_json'] ?? '{}',
            $userId !== '' ? $userId : null,
        ]);
        respond(['id' => $id, 'name' => $name, 'slug' => $slug, 'message' => 'Form duplicated'], 201);
    }

    if ($action === 'assign') {
        requireRole($tokenData, docFormsManagerRoles());
        $formId = trim((string) ($input['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        if (!docFormsFetchForm($db, $formId)) respond(['error' => 'Form not found'], 404);
        if (!docFormsUserCanManageForm($db, $tokenData, $formId)) {
            respond(['error' => 'Forbidden'], 403);
        }
        $entries = $input['access'] ?? null;
        if (!is_array($entries)) {
            // Convenience: user_ids + role_keys
            $entries = [];
            foreach (($input['user_ids'] ?? []) as $uid) {
                $uid = trim((string) $uid);
                if ($uid !== '') $entries[] = ['access_type' => 'user', 'user_id' => $uid];
            }
            foreach (($input['role_keys'] ?? []) as $rk) {
                $rk = strtolower(trim((string) $rk));
                if ($rk !== '') $entries[] = ['access_type' => 'role', 'role_key' => $rk];
            }
        }
        $db->prepare('DELETE FROM doc_form_access WHERE form_id = ?')->execute([$formId]);
        $ins = $db->prepare(
            'INSERT INTO doc_form_access (id, form_id, access_type, user_id, role_key, assigned_by) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $n = 0;
        foreach ($entries as $e) {
            if (!is_array($e)) continue;
            $atype = strtolower(trim((string) ($e['access_type'] ?? '')));
            if ($atype === 'user') {
                $uid = trim((string) ($e['user_id'] ?? ''));
                if ($uid === '') continue;
                $ins->execute([generateUUID(), $formId, 'user', $uid, null, $userId ?: null]);
                $n++;
            } elseif ($atype === 'role') {
                $rk = strtolower(trim((string) ($e['role_key'] ?? '')));
                if ($rk === '') continue;
                $ins->execute([generateUUID(), $formId, 'role', null, $rk, $userId ?: null]);
                $n++;
            }
        }
        respond(['success' => true, 'count' => $n]);
    }

    if ($action === 'submit') {
        $formId = trim((string) ($input['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $form = docFormsFetchForm($db, $formId);
        if (!$form || !(int) ($form['is_active'] ?? 0)) respond(['error' => 'Form not found or inactive'], 404);
        if (!docFormsUserCanAccessForm($db, $tokenData, $formId)) {
            respond(['error' => 'You are not assigned to this form'], 403);
        }
        $answers = $input['answers'] ?? $input['answers_json'] ?? [];
        if (!is_array($answers)) $answers = [];
        $values = $input['values'] ?? $input['values_json'] ?? $answers;
        if (!is_array($values)) $values = [];
        $name = trim((string) ($input['respondent_name'] ?? $values['candidate_name'] ?? $values['name'] ?? ''));
        $email = trim((string) ($input['respondent_email'] ?? $values['recipient_email'] ?? $values['email'] ?? ''));
        $id = generateUUID();
        $st = $db->prepare(
            'INSERT INTO doc_form_submissions
             (id, form_id, org_id, submitted_by, respondent_name, respondent_email, answers_json, values_json, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $id,
            $formId,
            $form['org_id'] ?? docFormsOrgId($tokenData),
            $userId !== '' ? $userId : null,
            $name !== '' ? $name : null,
            $email !== '' ? $email : null,
            json_encode($answers, JSON_UNESCAPED_UNICODE),
            json_encode($values, JSON_UNESCAPED_UNICODE),
            'submitted',
        ]);
        respond(['id' => $id, 'message' => 'Submitted'], 201);
    }

    if ($action === 'add_manual_row') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $formId = trim((string) ($input['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $form = docFormsFetchForm($db, $formId);
        if (!$form) respond(['error' => 'Form not found'], 404);
        $values = $input['values'] ?? $input['values_json'] ?? [];
        if (!is_array($values)) $values = [];
        // Normalize to string map; allow empty cells for manual fill-in.
        $normalized = [];
        foreach ($values as $k => $v) {
            $key = trim((string) $k);
            if ($key === '') continue;
            $normalized[$key] = is_scalar($v) ? (string) $v : '';
        }
        $name = trim((string) ($input['respondent_name'] ?? $normalized['candidate_name'] ?? $normalized['name'] ?? ''));
        $email = trim((string) ($input['respondent_email'] ?? $normalized['recipient_email'] ?? $normalized['email'] ?? ''));
        $id = generateUUID();
        $st = $db->prepare(
            'INSERT INTO doc_form_submissions
             (id, form_id, org_id, submitted_by, respondent_name, respondent_email, answers_json, values_json, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $id,
            $formId,
            $form['org_id'] ?? docFormsOrgId($tokenData),
            $userId !== '' ? $userId : null,
            $name !== '' ? $name : null,
            $email !== '' ? $email : null,
            json_encode(new stdClass(), JSON_UNESCAPED_UNICODE),
            json_encode($normalized, JSON_UNESCAPED_UNICODE),
            'manual',
        ]);
        respond([
            'id' => $id,
            'message' => 'Row added',
            'data' => [
                'id' => $id,
                'form_id' => $formId,
                'respondent_name' => $name !== '' ? $name : null,
                'respondent_email' => $email !== '' ? $email : null,
                'answers_json' => [],
                'values_json' => $normalized,
                'status' => 'manual',
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ],
        ], 201);
    }

    if ($action === 'link_template') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $formId = trim((string) ($input['form_id'] ?? ''));
        $templateId = trim((string) ($input['template_id'] ?? ''));
        $kind = trim((string) ($input['template_kind'] ?? ''));
        if ($formId === '' || $templateId === '') respond(['error' => 'form_id and template_id required'], 400);
        $form = docFormsFetchForm($db, $formId);
        if (!$form) respond(['error' => 'Form not found'], 404);
        if ($kind === '') {
            $kind = (string) ($form['form_type'] ?? '');
        }
        if (!in_array($kind, ['offer_letter', 'certificate'], true)) {
            respond(['error' => 'Invalid template_kind'], 400);
        }
        $maps = $input['column_maps'] ?? $input['column_maps_json'] ?? [];
        if (!is_array($maps)) $maps = [];
        $existing = $db->prepare('SELECT id FROM doc_form_template_links WHERE form_id = ? LIMIT 1');
        $existing->execute([$formId]);
        $exId = $existing->fetchColumn();
        if ($exId) {
            $up = $db->prepare(
                'UPDATE doc_form_template_links SET template_kind = ?, template_id = ?, column_maps_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            );
            $up->execute([$kind, $templateId, json_encode($maps, JSON_UNESCAPED_UNICODE), $exId]);
            respond(['id' => $exId, 'message' => 'Template linked']);
        }
        $id = generateUUID();
        $ins = $db->prepare(
            'INSERT INTO doc_form_template_links (id, form_id, org_id, template_kind, template_id, column_maps_json)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $id,
            $formId,
            $form['org_id'] ?? docFormsOrgId($tokenData),
            $kind,
            $templateId,
            json_encode($maps, JSON_UNESCAPED_UNICODE),
        ]);
        respond(['id' => $id, 'message' => 'Template linked'], 201);
    }

    if ($action === 'unlink_template') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $formId = trim((string) ($input['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        if (!docFormsFetchForm($db, $formId)) respond(['error' => 'Form not found'], 404);
        // Submissions stay; only the template mapping is removed so a different template can be linked.
        $del = $db->prepare('DELETE FROM doc_form_template_links WHERE form_id = ?');
        $del->execute([$formId]);
        respond(['success' => true, 'removed' => $del->rowCount(), 'message' => 'Template unlinked']);
    }

    if ($action === 'save_column_maps') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $formId = trim((string) ($input['form_id'] ?? ''));
        $maps = $input['column_maps'] ?? [];
        if ($formId === '' || !is_array($maps)) respond(['error' => 'form_id and column_maps required'], 400);
        $st = $db->prepare('UPDATE doc_form_template_links SET column_maps_json = ?, updated_at = CURRENT_TIMESTAMP WHERE form_id = ?');
        $st->execute([json_encode($maps, JSON_UNESCAPED_UNICODE), $formId]);
        if ($st->rowCount() === 0) {
            respond(['error' => 'Link a template to this form first'], 400);
        }
        respond(['success' => true]);
    }

    if ($action === 'update_submission_values') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $submissionId = trim((string) ($input['submission_id'] ?? ''));
        $values = $input['values'] ?? $input['values_json'] ?? null;
        if ($submissionId === '' || !is_array($values)) respond(['error' => 'submission_id and values required'], 400);
        $patch = [];
        if (isset($input['respondent_name'])) $patch['respondent_name'] = trim((string) $input['respondent_name']);
        if (isset($input['respondent_email'])) $patch['respondent_email'] = trim((string) $input['respondent_email']);
        $sql = 'UPDATE doc_form_submissions SET values_json = ?';
        $params = [json_encode($values, JSON_UNESCAPED_UNICODE)];
        if (array_key_exists('respondent_name', $patch)) {
            $sql .= ', respondent_name = ?';
            $params[] = $patch['respondent_name'];
        }
        if (array_key_exists('respondent_email', $patch)) {
            $sql .= ', respondent_email = ?';
            $params[] = $patch['respondent_email'];
        }
        $sql .= ', updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        $params[] = $submissionId;
        $st = $db->prepare($sql);
        $st->execute($params);
        respond(['success' => true]);
    }

    if ($action === 'issue') {
        requireRole($tokenData, docFormsWorkflowRoles());
        $submissionId = trim((string) ($input['submission_id'] ?? ''));
        if ($submissionId === '') respond(['error' => 'submission_id required'], 400);
        $st = $db->prepare('SELECT * FROM doc_form_submissions WHERE id = ? LIMIT 1');
        $st->execute([$submissionId]);
        $sub = $st->fetch(PDO::FETCH_ASSOC);
        if (!$sub) respond(['error' => 'Submission not found'], 404);
        $form = docFormsFetchForm($db, (string) $sub['form_id']);
        if (!$form) respond(['error' => 'Form not found'], 404);
        $linkSt = $db->prepare('SELECT * FROM doc_form_template_links WHERE form_id = ? LIMIT 1');
        $linkSt->execute([(string) $sub['form_id']]);
        $link = $linkSt->fetch(PDO::FETCH_ASSOC);
        if (!$link) respond(['error' => 'No template linked to this form'], 400);

        $values = docFormsDecodeJson($sub['values_json'] ?? null);
        if (isset($input['values']) && is_array($input['values'])) {
            $values = array_merge($values, $input['values']);
        }
        $recipientEmail = trim((string) ($input['recipient_email'] ?? $values['recipient_email'] ?? $values['email'] ?? $sub['respondent_email'] ?? ''));
        $recipientName = trim((string) ($input['recipient_name'] ?? $values['candidate_name'] ?? $values['name'] ?? $sub['respondent_name'] ?? 'Recipient'));
        if ($recipientEmail === '' || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
            respond(['error' => 'Valid recipient email is required before issuing'], 400);
        }

        $kind = (string) ($link['template_kind'] ?? $form['form_type']);
        $templateId = (string) ($link['template_id'] ?? '');
        $htmlContent = (string) ($input['html_content'] ?? '');
        $emailSubject = trim((string) ($input['email_subject'] ?? ''));
        $emailHtml = trim((string) ($input['email_html'] ?? ''));
        $attachName = trim((string) ($input['attachment_name'] ?? ''));
        $pdfBase64 = trim((string) ($input['pdf_base64'] ?? ''));

        // Record issued document; actual email/PDF is expected from client via existing offer/cert send APIs
        // OR provided inline here for offers when pdf/html present.
        $issuedId = generateUUID();
        $orgId = $form['org_id'] ?? docFormsOrgId($tokenData);
        $meta = [
            'values' => $values,
            'template_id' => $templateId,
            'source' => 'doc_forms',
        ];

        if ($kind === 'offer_letter' && ($htmlContent !== '' || $pdfBase64 !== '')) {
            // Delegate-style: require client to also call offer-letters send, but we store issued row.
            if ($emailSubject === '') {
                $emailSubject = 'Offer Letter — ' . $recipientName;
            }
        }

        $ins = $db->prepare(
            'INSERT INTO doc_issued_documents
             (id, org_id, doc_kind, form_id, submission_id, template_id, recipient_name, recipient_email, subject, pdf_url, status, issued_by, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $pdfUrl = trim((string) ($input['pdf_url'] ?? ''));
        $ins->execute([
            $issuedId,
            $orgId,
            $kind,
            (string) $sub['form_id'],
            $submissionId,
            $templateId !== '' ? $templateId : null,
            $recipientName,
            $recipientEmail,
            $emailSubject !== '' ? $emailSubject : null,
            $pdfUrl !== '' ? $pdfUrl : null,
            'issued',
            $userId !== '' ? $userId : null,
            json_encode($meta, JSON_UNESCAPED_UNICODE),
        ]);
        $db->prepare("UPDATE doc_form_submissions SET status = 'issued', values_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            ->execute([json_encode($values, JSON_UNESCAPED_UNICODE), $submissionId]);

        respond([
            'id' => $issuedId,
            'message' => 'Marked issued',
            'recipient_email' => $recipientEmail,
            'recipient_name' => $recipientName,
            'template_id' => $templateId,
            'doc_kind' => $kind,
            'values' => $values,
        ], 201);
    }

    respond(['error' => 'Invalid action'], 400);
}

// ---------- PUT ----------
if ($method === 'PUT') {
    requireRole($tokenData, docFormsManagerRoles());
    $input = getInput();
    if (!is_array($input)) $input = [];
    $id = trim((string) ($_GET['id'] ?? $input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    if (!docFormsFetchForm($db, $id)) respond(['error' => 'Form not found'], 404);
    if (!docFormsUserCanManageForm($db, $tokenData, $id)) {
        respond(['error' => 'Forbidden'], 403);
    }
    $sets = [];
    $params = [];
    foreach (['name', 'slug', 'description', 'form_type'] as $col) {
        if (array_key_exists($col, $input)) {
            $sets[] = "$col = ?";
            $params[] = $input[$col];
        }
    }
    if (array_key_exists('fields_json', $input)) {
        $sets[] = 'fields_json = ?';
        $params[] = json_encode(is_array($input['fields_json']) ? $input['fields_json'] : [], JSON_UNESCAPED_UNICODE);
    }
    if (array_key_exists('meta_json', $input)) {
        $sets[] = 'meta_json = ?';
        $params[] = json_encode(is_array($input['meta_json']) ? $input['meta_json'] : [], JSON_UNESCAPED_UNICODE);
    }
    if (array_key_exists('is_active', $input)) {
        $sets[] = 'is_active = ?';
        $params[] = !empty($input['is_active']) ? 1 : 0;
    }
    if (!$sets) respond(['error' => 'No fields to update'], 400);
    $params[] = $id;
    $db->prepare('UPDATE doc_forms SET ' . implode(', ', $sets) . ', updated_at = CURRENT_TIMESTAMP WHERE id = ?')->execute($params);
    respond(['success' => true]);
}

// ---------- DELETE ----------
if ($method === 'DELETE') {
    requireRole($tokenData, docFormsWorkflowRoles());
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($action === 'submission') {
        if ($id === '') respond(['error' => 'id required'], 400);
        $db->prepare('DELETE FROM doc_form_submissions WHERE id = ?')->execute([$id]);
        respond(['success' => true]);
    }
    if ($id === '') respond(['error' => 'id required'], 400);
    if (!docFormsFetchForm($db, $id)) respond(['error' => 'Form not found'], 404);
    if (!docFormsUserCanManageForm($db, $tokenData, $id)) {
        respond(['error' => 'Forbidden'], 403);
    }
    $db->prepare('DELETE FROM doc_form_access WHERE form_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM doc_form_template_links WHERE form_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM doc_form_submissions WHERE form_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM doc_forms WHERE id = ?')->execute([$id]);
    respond(['success' => true]);
}

respond(['error' => 'Method not allowed'], 405);
