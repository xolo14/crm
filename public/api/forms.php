<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];
$orgId = $tokenData['org_id'] ?? null;

function formsResolveOrgSlug(PDO $db, ?string $orgId): ?string {
    $oid = is_string($orgId) ? trim($orgId) : '';
    if ($oid === '') return null;
    try {
        $st = $db->prepare("SELECT LOWER(TRIM(slug)) AS slug FROM organizations WHERE id = ? LIMIT 1");
        $st->execute([$oid]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $slug = isset($row['slug']) ? trim((string)$row['slug']) : '';
        return $slug !== '' ? $slug : null;
    } catch (Throwable $ignored) {
        return null;
    }
}

ensureGlobalBuiltinLeadForms($db);

if ($method === 'GET') {
    requireRole($tokenData, ['super_admin', 'admin', 'manager', 'sales_representative', 'marketing', 'sales_marketing']);
    $action = $_GET['action'] ?? '';

    if ($action === 'assignments') {
        $formId = $_GET['form_id'] ?? '';
        if (!$formId) respond(['error' => 'form_id required'], 400);

        $params = [$formId];
        $orgClause = '';
        if ($role === 'admin') {
            $orgClause = ' AND lf.created_by = ?';
            $params[] = $userId;
        } elseif ($role !== 'super_admin') {
            $orgClause = ' AND (lf.org_id = ? OR lf.org_id IS NULL)';
            $params[] = $orgId;
        }

        $sql = "
            SELECT lfa.id, lfa.form_id, lfa.member_id, lfa.created_at,
                   u.full_name, u.email, u.referral_code
            FROM lead_form_assignments lfa
            INNER JOIN lead_forms lf ON lf.id = lfa.form_id
            INNER JOIN users u ON u.id = lfa.member_id
            WHERE lfa.form_id = ? $orgClause
            ORDER BY u.full_name ASC
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        respond(['data' => $stmt->fetchAll()]);
    }

    $params = [];
    $where = '1=1';
    $orgSlug = formsResolveOrgSlug($db, $orgId);
    $isSyncpediaOrg = ($orgSlug === 'syncpedia') || ($orgId === null || $orgId === '');
    if ($role === 'super_admin') {
        // all forms
    } elseif ($role === 'admin') {
        if ($isSyncpediaOrg) {
            // Syncpedia admin: all super_admin-created forms
            $where .= " AND EXISTS (
                SELECT 1 FROM users su
                WHERE su.id = lf.created_by AND LOWER(TRIM(su.role)) = 'super_admin'
            )";
        } else {
            // Other org admin: global/org active normal + own created forms
            $where .= " AND (
                (lf.is_active = 1 AND lf.slug = 'normal' AND (lf.org_id IS NULL OR lf.org_id = ?))
                OR lf.created_by = ?
            )";
            $params[] = $orgId;
            $params[] = $userId;
        }
    } elseif ($role === 'sales_marketing') {
        if ($isSyncpediaOrg) {
            $where .= " AND lf.is_active = 1 AND (
                lf.created_by = ?
                OR (lf.org_id IS NULL AND lf.slug IN ('default','normal'))
            )";
            $params[] = $userId;
        } else {
            $where .= " AND lf.is_active = 1 AND (
                lf.created_by = ?
                OR (lf.slug = 'normal' AND (lf.org_id IS NULL OR lf.org_id = ?))
            )";
            $params[] = $userId;
            $params[] = $orgId;
        }
    } else {
        if ($isSyncpediaOrg) {
            // Syncpedia members: default + normal by default; also include explicit assignments.
            $where .= " AND lf.is_active = 1 AND (
                (lf.org_id IS NULL AND lf.slug IN ('default','normal'))
                OR EXISTS (SELECT 1 FROM lead_form_assignments lfa WHERE lfa.form_id = lf.id AND lfa.member_id = ?)
            )";
            $params[] = $userId;
        } else {
            // Other org members: normal only (global/org scoped).
            $where .= " AND lf.is_active = 1 AND lf.slug = 'normal' AND (lf.org_id IS NULL OR lf.org_id = ?)";
            $params[] = $orgId;
        }
    }

    $stmt = $db->prepare("
        SELECT lf.*,
               (SELECT COUNT(*) FROM lead_form_assignments lfa WHERE lfa.form_id = lf.id) AS assigned_count
        FROM lead_forms lf
        WHERE $where
        ORDER BY lf.created_at DESC
    ");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        if (isset($row['fields_json']) && is_string($row['fields_json']) && $row['fields_json'] !== '') {
            $decoded = json_decode($row['fields_json'], true);
            $row['fields_json'] = is_array($decoded) ? $decoded : [];
        } else {
            $row['fields_json'] = [];
        }
        if (isset($row['meta_json']) && is_string($row['meta_json']) && $row['meta_json'] !== '') {
            $decoded = json_decode($row['meta_json'], true);
            $row['meta_json'] = is_array($decoded) ? $decoded : [];
        } else {
            $row['meta_json'] = [];
        }
    }
    respond(['data' => $rows]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'sales_marketing']);
    $input = getInput();
    $action = $_GET['action'] ?? '';

    if ($action === 'assign') {
        requireRole($tokenData, ['super_admin', 'admin']);
        $formId = trim($input['form_id'] ?? '');
        $memberIds = $input['member_ids'] ?? [];
        if (!$formId || !is_array($memberIds)) respond(['error' => 'form_id and member_ids are required'], 400);

        $chkParams = [$formId];
        $orgClause = '';
        if ($role !== 'super_admin') {
            $orgClause = ' AND org_id = ?';
            $chkParams[] = $orgId;
        }
        $chk = $db->prepare("SELECT id, slug, org_id FROM lead_forms WHERE id = ? $orgClause LIMIT 1");
        $chk->execute($chkParams);
        $formRow = $chk->fetch();
        if (!$formRow) respond(['error' => 'Form not found'], 404);

        $cleanMemberIds = [];
        foreach ($memberIds as $memberId) {
            $mid = trim((string)$memberId);
            if ($mid !== '') $cleanMemberIds[] = $mid;
        }
        $cleanMemberIds = array_values(array_unique($cleanMemberIds));

        $memberStmt = $db->prepare("
            SELECT u.id, u.org_id, LOWER(TRIM(o.slug)) AS org_slug
            FROM users u
            LEFT JOIN organizations o ON o.id = u.org_id
            WHERE u.id = ? AND u.is_active = 1
            LIMIT 1
        ");
        foreach ($cleanMemberIds as $mid) {
            $memberStmt->execute([$mid]);
            $member = $memberStmt->fetch();
            if (!$member) respond(['error' => 'Invalid member in assignment list'], 400);

            $memberOrg = isset($member['org_id']) ? trim((string)$member['org_id']) : '';
            $memberOrgSlug = isset($member['org_slug']) ? trim((string)$member['org_slug']) : '';
            $isSyncpediaMember = ($memberOrgSlug === 'syncpedia') || ($memberOrg === '');

            if (($formRow['slug'] ?? '') === 'default' && !$isSyncpediaMember) {
                respond(['error' => 'Default form can only be assigned to Syncpedia members'], 400);
            }

            if ($role !== 'super_admin') {
                $formOrg = isset($formRow['org_id']) ? trim((string)$formRow['org_id']) : '';
                if ($memberOrg === '' || $memberOrg !== (string)$orgId) {
                    respond(['error' => 'You can only assign members from your own organization'], 403);
                }
                if ($formOrg !== '' && $formOrg !== (string)$orgId) {
                    respond(['error' => 'You can only assign members from your own organization'], 403);
                }
            }
        }

        // Replace semantics: remove any existing assignments for this form whose
        // member_id is not in the new list, then upsert the new list. Without this,
        // unchecking a member in the UI silently no-ops (only inserts ever happened).
        if ($role === 'super_admin') {
            if (empty($cleanMemberIds)) {
                $db->prepare('DELETE FROM lead_form_assignments WHERE form_id = ?')->execute([$formId]);
            } else {
                $placeholders = implode(',', array_fill(0, count($cleanMemberIds), '?'));
                $delParams = array_merge([$formId], $cleanMemberIds);
                $db->prepare("DELETE FROM lead_form_assignments WHERE form_id = ? AND member_id NOT IN ($placeholders)")
                    ->execute($delParams);
            }
        } else {
            // Tenant admin: only touch assignments for members in their own org.
            if (empty($cleanMemberIds)) {
                $db->prepare('
                    DELETE lfa FROM lead_form_assignments lfa
                    INNER JOIN users u ON u.id = lfa.member_id
                    WHERE lfa.form_id = ? AND u.org_id = ?
                ')->execute([$formId, $orgId]);
            } else {
                $placeholders = implode(',', array_fill(0, count($cleanMemberIds), '?'));
                $delParams = array_merge([$formId, $orgId], $cleanMemberIds);
                $db->prepare("
                    DELETE lfa FROM lead_form_assignments lfa
                    INNER JOIN users u ON u.id = lfa.member_id
                    WHERE lfa.form_id = ? AND u.org_id = ?
                      AND lfa.member_id NOT IN ($placeholders)
                ")->execute($delParams);
            }
        }

        $stmt = $db->prepare("
            INSERT INTO lead_form_assignments (id, form_id, member_id, assigned_by)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by)
        ");
        foreach ($cleanMemberIds as $mid) {
            $stmt->execute([generateUUID(), $formId, $mid, $userId]);
        }
        respond(['message' => 'Assignments saved']);
    }

    $name = trim($input['name'] ?? '');
    $slug = trim($input['slug'] ?? '');
    if (!$name) respond(['error' => 'name required'], 400);
    if (!$slug) {
        $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $name));
        $slug = trim($slug, '-');
    }
    if (!$slug) respond(['error' => 'slug required'], 400);

    $id = generateUUID();
    $stmt = $db->prepare("
        INSERT INTO lead_forms (id, name, slug, description, fields_json, meta_json, is_active, created_by, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $fieldsJson = [];
    if (isset($input['fields_json']) && is_array($input['fields_json'])) {
        $fieldsJson = $input['fields_json'];
    }
    $metaJson = [];
    if (isset($input['meta_json']) && is_array($input['meta_json'])) {
        $metaJson = $input['meta_json'];
    }
    $stmt->execute([
        $id,
        $name,
        $slug,
        $input['description'] ?? null,
        json_encode($fieldsJson),
        json_encode($metaJson),
        !empty($input['is_active']) ? 1 : 0,
        $userId,
        $role === 'super_admin' ? ($input['org_id'] ?? null) : $orgId
    ]);

    respond(['id' => $id, 'message' => 'Form created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['super_admin', 'admin', 'sales_marketing']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'id required'], 400);
    $input = getInput();

    $params = [$id];
    $orgClause = '';
    if ($role === 'sales_marketing') {
        $orgClause = ' AND created_by = ?';
        $params[] = $userId;
    } elseif ($role !== 'super_admin') {
        $orgClause = ' AND org_id = ?';
        $params[] = $orgId;
    }

    $chk = $db->prepare("SELECT id FROM lead_forms WHERE id = ? $orgClause LIMIT 1");
    $chk->execute($params);
    if (!$chk->fetch()) respond(['error' => 'Form not found'], 404);

    $fields = [];
    $vals = [];
    foreach (['name', 'slug', 'description'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $vals[] = $input[$f];
        }
    }
    if (array_key_exists('fields_json', $input)) {
        $fields[] = "fields_json = ?";
        $vals[] = json_encode(is_array($input['fields_json']) ? $input['fields_json'] : []);
    }
    if (array_key_exists('meta_json', $input)) {
        $fields[] = "meta_json = ?";
        $vals[] = json_encode(is_array($input['meta_json']) ? $input['meta_json'] : []);
    }
    if (array_key_exists('is_active', $input)) {
        $fields[] = "is_active = ?";
        $vals[] = !empty($input['is_active']) ? 1 : 0;
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $vals[] = $id;
    if ($role === 'sales_marketing') {
        $vals[] = $userId;
    } elseif ($role !== 'super_admin') {
        $vals[] = $orgId;
    }
    $stmt = $db->prepare("UPDATE lead_forms SET " . implode(', ', $fields) . " WHERE id = ? $orgClause");
    $stmt->execute($vals);
    respond(['message' => 'Form updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['super_admin', 'admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'id required'], 400);

    $params = [$id];
    $orgClause = '';
    if ($role !== 'super_admin') {
        $orgClause = ' AND org_id = ?';
        $params[] = $orgId;
    }

    $chk = $db->prepare("SELECT slug, org_id FROM lead_forms WHERE id = ? $orgClause LIMIT 1");
    $chk->execute($params);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Form not found'], 404);
    }
    $delSlug = strtolower(trim((string) ($row['slug'] ?? '')));
    $delOrg = isset($row['org_id']) ? trim((string) $row['org_id']) : '';
    if (($delSlug === 'default' || $delSlug === 'normal') && $delOrg === '') {
        respond(['error' => 'Built-in Syncpedia platform forms (slugs default / normal, global) cannot be deleted.'], 403);
    }

    $stmt = $db->prepare("DELETE FROM lead_forms WHERE id = ? $orgClause");
    $stmt->execute($params);
    respond(['message' => 'Form deleted']);
}

respond(['error' => 'Method not allowed'], 405);

