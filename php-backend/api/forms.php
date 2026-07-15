<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/form_campaigns.php';
cors();

/** Shim when production helpers.php predates publicFormLeadDestination (submissions fatal otherwise). */
if (!function_exists('publicFormLeadDestination')) {
    function publicFormLeadDestination(?array $formRow): ?string {
        if (!is_array($formRow)) {
            return null;
        }
        $meta = [];
        if (!empty($formRow['meta_json'])) {
            if (is_array($formRow['meta_json'])) {
                $meta = $formRow['meta_json'];
            } elseif (is_string($formRow['meta_json'])) {
                $tmp = json_decode($formRow['meta_json'], true);
                if (is_array($tmp)) {
                    $meta = $tmp;
                }
            }
        }
        $dest = strtolower(trim((string) ($meta['lead_destination'] ?? '')));
        if ($dest === 'hr_leads' || $dest === 'form_leads') {
            return $dest;
        }
        return null;
    }
}

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$orgId = tenantIsMasterView($tokenData) ? null : resolveCreatorOrgId($db, $tokenData);

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

/** @return array<string,mixed> */
function formsParseMetaJson($raw): array {
    if (is_array($raw)) return $raw;
    if (is_string($raw) && trim($raw) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) return $decoded;
    }
    return [];
}

/**
 * Tenant org for form visibility — always the signed-in user's organization (users.org_id).
 * Super admin master view returns null (all orgs); switched super admin uses JWT org.
 */
function formsEffectiveTenantOrgId(PDO $db, array $tokenData): ?string {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        if (tenantIsMasterView($tokenData)) {
            return null;
        }
        $switchOrg = trim((string) ($tokenData['org_id'] ?? ''));
        return $switchOrg !== '' ? $switchOrg : null;
    }
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($userId === '') {
        return null;
    }
    try {
        $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $oid = is_array($row) ? trim((string) ($row['org_id'] ?? '')) : '';
        return $oid !== '' ? $oid : null;
    } catch (Throwable $e) {
        return null;
    }
}

/** Super-admin org picker: platform default → Syncpedia org UUID (never NULL). */
function formsResolveSuperAdminOrgId(PDO $db, array $tokenData, $rawOrgId): ?string {
    if ($rawOrgId !== null && trim((string) $rawOrgId) !== '') {
        return trim((string) $rawOrgId);
    }
    $sid = syncpediaGetOrCreateOrgId($db, (string) ($tokenData['user_id'] ?? ''));
    return $sid ?: resolveWriteOrgId($db, $tokenData);
}

/**
 * Fetch a form row scoped to caller permissions.
 *
 * @return array<string,mixed>|null
 */
function formsGetScopedForm(PDO $db, string $formId, array $tokenData): ?array {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    $params = [$formId];
    $orgClause = '';
    if ($role === 'marketing') {
        $orgClause = ' AND created_by = ?';
        $params[] = $userId;
        $tenantOrg = formsEffectiveTenantOrgId($db, $tokenData);
        if ($tenantOrg && formsResolveOrgSlug($db, $tenantOrg) !== 'syncpedia') {
            $orgClause .= ' AND org_id = ?';
            $params[] = $tenantOrg;
        }
    } elseif ($role === 'super_admin' && tenantIsMasterView($tokenData)) {
        // Master view: any form in any org
    } elseif ($role === 'super_admin') {
        $switchOrg = trim((string) ($tokenData['org_id'] ?? ''));
        if ($switchOrg !== '') {
            $orgClause = ' AND org_id = ?';
            $params[] = $switchOrg;
        }
    } else {
        $tenantOrg = formsEffectiveTenantOrgId($db, $tokenData);
        if (!$tenantOrg) {
            return null;
        }
        $orgClause = ' AND org_id = ?';
        $params[] = $tenantOrg;
    }
    $st = $db->prepare("SELECT id, name, slug, org_id, created_by, meta_json FROM lead_forms WHERE id = ? $orgClause LIMIT 1");
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/** Same visibility rules as the Form Management list. */
function formsBuildListScope(PDO $db, array $tokenData): array {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    $tenantOrgId = formsEffectiveTenantOrgId($db, $tokenData);
    $params = [];
    $where = "NOT (lf.slug IN ('normal', 'default') AND lf.org_id IS NULL)";
    $orgSlug = formsResolveOrgSlug($db, $tenantOrgId);
    $isSyncpediaOrg = ($orgSlug === 'syncpedia');
    if ($role === 'super_admin') {
        // Master panel: all orgs. Switched-org context: that tenant only.
        if (!tenantIsMasterView($tokenData)) {
            $switchOrg = trim((string) ($tokenData['org_id'] ?? ''));
            if ($switchOrg !== '') {
                $where .= ' AND lf.org_id = ?';
                $params[] = $switchOrg;
            }
        }
    } elseif ($role === 'admin') {
        if ($isSyncpediaOrg && $tenantOrgId) {
            // Syncpedia org admin: super_admin-created forms owned by Syncpedia org only.
            $where .= " AND lf.org_id = ? AND EXISTS (
                SELECT 1 FROM users su
                WHERE su.id = lf.created_by AND LOWER(TRIM(su.role)) = 'super_admin'
            )";
            $params[] = $tenantOrgId;
        } elseif ($tenantOrgId) {
            // Groot / Nivon / other tenant admins: only forms assigned to their org.
            $where .= ' AND lf.org_id = ?';
            $params[] = $tenantOrgId;
        } else {
            $where .= ' AND 1=0';
        }
    } elseif ($role === 'marketing') {
        $where .= ' AND lf.is_active = 1 AND (';
        if ($isSyncpediaOrg) {
            $where .= 'lf.created_by = ?';
            $params[] = $userId;
        } elseif ($tenantOrgId) {
            $where .= 'lf.org_id = ?';
            $params[] = $tenantOrgId;
        } else {
            $where .= '1=0';
        }
        $where .= ')';
    } elseif ($role === 'org' || $role === 'manager') {
        if ($tenantOrgId) {
            $where .= ' AND lf.is_active = 1 AND lf.org_id = ?';
            $params[] = $tenantOrgId;
        } else {
            $where .= ' AND 1=0';
        }
    } else {
        $where .= ' AND lf.is_active = 1 AND EXISTS (
            SELECT 1 FROM lead_form_assignments lfa
            WHERE lfa.form_id = lf.id AND lfa.member_id = ?
        )';
        $params[] = $userId;
        if ($tenantOrgId) {
            $where .= ' AND lf.org_id = ?';
            $params[] = $tenantOrgId;
        }
    }

    return ['where' => $where, 'params' => $params];
}

function formsSubmissionCountSelectSql(string $formAlias = 'lf'): string {
    $a = $formAlias;
    return "(CASE
        WHEN LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$a}.meta_json, '$.lead_destination')), 'form_leads')) = 'hr_leads'
        THEN (
            SELECT COUNT(*) FROM hr_leads hl
            WHERE hl.source = CONCAT('form_', {$a}.slug)
              AND (hl.deleted_at IS NULL)
              AND (
                ({$a}.org_id IS NOT NULL AND TRIM({$a}.org_id) != '' AND hl.org_id = {$a}.org_id)
                OR (({$a}.org_id IS NULL OR TRIM({$a}.org_id) = '') AND (hl.org_id IS NULL OR TRIM(hl.org_id) = ''))
              )
        )
        ELSE (
            SELECT COUNT(*) FROM leads l
            WHERE l.source = CONCAT('form_', {$a}.slug)
              AND (
                ({$a}.org_id IS NOT NULL AND TRIM({$a}.org_id) != '' AND l.org_id = {$a}.org_id)
                OR (({$a}.org_id IS NULL OR TRIM({$a}.org_id) = '') AND (l.org_id IS NULL OR TRIM(l.org_id) = ''))
              )
        )
    END)";
}

/** @return array<string,mixed>|null */
function formsGetAccessibleFormDetail(PDO $db, string $formId, array $tokenData): ?array {
    $scope = formsBuildListScope($db, $tokenData);
    $params = array_merge($scope['params'], [$formId]);
    $sql = 'SELECT lf.*, o.name AS org_name, ' . formsSubmissionCountSelectSql() . ' AS submission_count
            FROM lead_forms lf
            LEFT JOIN organizations o ON o.id = lf.org_id
            WHERE ' . $scope['where'] . ' AND lf.id = ?
            LIMIT 1';
    $st = $db->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/** Match submission rows to the form org (same rule as formsSubmissionCountSelectSql). */
function formsSubmissionFormOrgScope(?string $formOrgId, string $alias = 'l'): array {
    $oid = is_string($formOrgId) ? trim($formOrgId) : '';
    if ($oid !== '') {
        return ['sql' => " AND {$alias}.org_id = ?", 'params' => [$oid]];
    }
    return ['sql' => " AND ({$alias}.org_id IS NULL OR TRIM({$alias}.org_id) = '')", 'params' => []];
}

/** Limit submission rows to leads the caller may view (reps/managers on assigned forms). */
function formsSubmissionAssigneeScope(PDO $db, array $tokenData, string $role, string $alias = 'l'): array {
    $roleNorm = syncpediaNormalizeRoleKey($role);
    // Org-wide viewers (admins / marketing). Managers must use downline scope below —
    // they were incorrectly treated as org-wide and saw every form lead in the tenant.
    if (in_array($roleNorm, ['super_admin', 'admin', 'org', 'marketing'], true)) {
        return ['sql' => '', 'params' => []];
    }
    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        return hierarchyLeadDownlineScopeSql(hierarchyGetVisibleUserIds($db, $tokenData), $alias, $db);
    }
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        return hierarchyL1OwnLeadsScopeSql($tokenData, $alias);
    }
    return ['sql' => '', 'params' => []];
}

/** @return array{where: string, params: array} */
function formsSubmissionLeadFilters(PDO $db, array $tokenData, string $role, string $search, string $status, ?string $formOrgId = null): array {
    $where = '';
    $params = [];
    $roleNorm = syncpediaNormalizeRoleKey($role);
    if ($roleNorm !== 'super_admin' || getOrgId($tokenData)) {
        $tenantOrg = resolveCreatorOrgId($db, $tokenData);
        if ($tenantOrg) {
            $where .= ' AND l.org_id = ?';
            $params[] = $tenantOrg;
        }
    }
    $formScope = formsSubmissionFormOrgScope($formOrgId, 'l');
    $where .= $formScope['sql'];
    $params = array_merge($params, $formScope['params']);
    $assignee = formsSubmissionAssigneeScope($db, $tokenData, $role, 'l');
    $where .= $assignee['sql'];
    $params = array_merge($params, $assignee['params']);
    if ($status !== '' && $status !== 'all') {
        $where .= ' AND l.status = ?';
        $params[] = $status;
    }
    if ($search !== '') {
        $where .= ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
        $s = '%' . $search . '%';
        $params = array_merge($params, [$s, $s, $s]);
    }

    return ['where' => $where, 'params' => $params];
}

/** @return array{where: string, params: array} */
function formsSubmissionHrFilters(array $tokenData, string $role, ?string $callerOrgId, ?string $formOrgId, string $search, string $status): array {
    $where = '';
    $params = [];
    $roleNorm = syncpediaNormalizeRoleKey($role);
    if ($roleNorm !== 'super_admin' || getOrgId($tokenData)) {
        if ($callerOrgId) {
            $where .= ' AND hl.org_id = ?';
            $params[] = $callerOrgId;
        }
    }
    $formScope = formsSubmissionFormOrgScope($formOrgId, 'hl');
    $where .= $formScope['sql'];
    $params = array_merge($params, $formScope['params']);
    if ($status !== '' && $status !== 'all') {
        $where .= ' AND hl.status = ?';
        $params[] = $status;
    }
    if ($search !== '') {
        $where .= ' AND (hl.full_name LIKE ? OR hl.email LIKE ? OR hl.phone LIKE ?)';
        $s = '%' . $search . '%';
        $params = array_merge($params, [$s, $s, $s]);
    }

    return ['where' => $where, 'params' => $params];
}

function formsNormalizeFormRow(array &$row): void {
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

retireGlobalBuiltinLeadForms($db);

if ($method === 'GET') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager', 'sales_representative', 'marketing']);
    $action = $_GET['action'] ?? '';

    if ($action === 'assignments') {
        $formId = $_GET['form_id'] ?? '';
        if (!$formId) respond(['error' => 'form_id required'], 400);

        if (!formsGetAccessibleFormDetail($db, $formId, $tokenData)) {
            respond(['error' => 'Form not found'], 404);
        }

        $sql = "
            SELECT lfa.id, lfa.form_id, lfa.member_id, lfa.created_at,
                   u.full_name, u.email, u.referral_code
            FROM lead_form_assignments lfa
            INNER JOIN lead_forms lf ON lf.id = lfa.form_id
            INNER JOIN users u ON u.id = lfa.member_id
            WHERE lfa.form_id = ?
            ORDER BY u.full_name ASC
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute([$formId]);
        respond(['data' => $stmt->fetchAll()]);
    }

    if ($action === 'external_api') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'marketing']);
        $formId = trim((string) ($_GET['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $row = formsGetScopedForm($db, $formId, $tokenData);
        if (!$row) respond(['error' => 'Form not found'], 404);
        $meta = formsParseMetaJson($row['meta_json'] ?? null);
        $enabled = !empty($meta['external_api_enabled']);
        $hash = trim((string) ($meta['external_api_key_hash'] ?? ''));
        respond([
            'data' => [
                'form_id' => $row['id'],
                'enabled' => $enabled,
                'has_key' => $hash !== '',
                'integration_url' => '/apply?form=' . rawurlencode((string) ($row['slug'] ?? '')),
            ],
        ]);
    }

    if ($action === 'submissions') {
        try {
            ensureLeadsSourceColumnVarchar($db);
            ensureLeadsResumeColumn($db);

            $formId = trim((string) ($_GET['form_id'] ?? ''));
            if ($formId === '') {
                respond(['error' => 'form_id required'], 400);
            }
            $formRow = formsGetAccessibleFormDetail($db, $formId, $tokenData);
            if (!$formRow) {
                respond(['error' => 'Form not found'], 404);
            }
            formsNormalizeFormRow($formRow);

            $slug = trim((string) ($formRow['slug'] ?? ''));
            if ($slug === '') {
                respond(['error' => 'Form slug missing'], 400);
            }
            $formOrgId = isset($formRow['org_id']) ? trim((string) $formRow['org_id']) : '';
            $sourceKey = 'form_' . $slug;
            $destination = publicFormLeadDestination($formRow) ?? 'form_leads';
            $page = max(1, (int) ($_GET['page'] ?? 1));
            $limit = max(1, min(500, (int) ($_GET['limit'] ?? 25)));
            $offset = ($page - 1) * $limit;
            $search = trim((string) ($_GET['search'] ?? ''));
            $status = trim((string) ($_GET['status'] ?? 'all'));

            if ($destination === 'hr_leads') {
                $filters = formsSubmissionHrFilters($tokenData, $role, $orgId, $formOrgId !== '' ? $formOrgId : null, $search, $status);
                $countSql = 'SELECT COUNT(*) FROM hr_leads hl WHERE hl.source = ? AND (hl.deleted_at IS NULL)' . $filters['where'];
                $countParams = array_merge([$sourceKey], $filters['params']);
                $cst = $db->prepare($countSql);
                $cst->execute($countParams);
                $total = (int) ($cst->fetchColumn() ?: 0);

                $listSql = 'SELECT hl.id, hl.full_name AS name, hl.phone, hl.email, hl.status, hl.source,
                                   hl.resume_path, hl.notes, hl.created_at, hl.updated_at
                            FROM hr_leads hl
                            WHERE hl.source = ? AND (hl.deleted_at IS NULL)' . $filters['where'] . '
                            ORDER BY hl.created_at DESC
                            LIMIT ' . (int) $limit . ' OFFSET ' . (int) $offset;
                $lst = $db->prepare($listSql);
                $lst->execute($countParams);
                $submissions = $lst->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $filters = formsSubmissionLeadFilters($db, $tokenData, $role, $search, $status, $formOrgId !== '' ? $formOrgId : null);
                $countSql = 'SELECT COUNT(*) FROM leads l WHERE l.source = ?' . $filters['where'];
                $countParams = array_merge([$sourceKey], $filters['params']);
                $cst = $db->prepare($countSql);
                $cst->execute($countParams);
                $total = (int) ($cst->fetchColumn() ?: 0);

                $listSql = 'SELECT l.id, l.name, l.email, l.phone, l.status, l.source, l.notes,
                                   l.resume_path, l.assigned_to, l.referred_by, l.created_at, l.updated_at,
                                   u.full_name AS assigned_to_name
                            FROM leads l
                            LEFT JOIN users u ON u.id = l.assigned_to
                            WHERE l.source = ?' . $filters['where'] . '
                            ORDER BY l.created_at DESC
                            LIMIT ' . (int) $limit . ' OFFSET ' . (int) $offset;
                $lst = $db->prepare($listSql);
                $lst->execute($countParams);
                $submissions = $lst->fetchAll(PDO::FETCH_ASSOC);
            }

            respond([
                'form' => $formRow,
                'destination' => $destination,
                'submissions' => is_array($submissions) ? $submissions : [],
                'total' => $total,
                'page' => $page,
                'limit' => $limit,
            ]);
        } catch (Throwable $e) {
            error_log('[forms submissions] ' . $e->getMessage());
            $payload = [
                'error' => 'Failed to load submissions',
                'message' => 'Could not load form submissions. Ensure api/helpers.php is up to date on the server.',
            ];
            if (defined('APP_DEBUG') && APP_DEBUG) {
                $payload['detail'] = $e->getMessage();
            }
            respond($payload, 500);
        }
    }

    if ($action === 'campaign_templates') {
        $formId = trim((string) ($_GET['form_id'] ?? ''));
        if ($formId === '') {
            respond(['error' => 'form_id required'], 400);
        }
        $formRow = formsGetScopedForm($db, $formId, $tokenData);
        if (!$formRow) {
            respond(['error' => 'Form not found'], 404);
        }
        if (!formCampaignCanManage($db, $tokenData, $formRow)) {
            respond(['error' => 'Forbidden — super admin, org admin, or marketing users with access to this form can manage campaigns'], 403);
        }
        respond(['data' => formCampaignListTemplates($db, $tokenData, $formRow)]);
    }

    $scope = formsBuildListScope($db, $tokenData);
    $params = $scope['params'];
    $where = $scope['where'];

    $stmt = $db->prepare('
        SELECT lf.*,
               o.name AS org_name,
               (SELECT COUNT(*) FROM lead_form_assignments lfa WHERE lfa.form_id = lf.id) AS assigned_count,
               ' . formsSubmissionCountSelectSql() . ' AS submission_count
        FROM lead_forms lf
        LEFT JOIN organizations o ON o.id = lf.org_id
        WHERE ' . $where . '
        ORDER BY lf.created_at DESC
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        formsNormalizeFormRow($row);
    }
    respond(['data' => $rows]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'marketing', 'manager']);
    $input = getInput();
    $action = $_GET['action'] ?? '';

    if ($action === 'send_campaign') {
        $formId = trim((string) ($input['form_id'] ?? ''));
        $channel = strtolower(trim((string) ($input['channel'] ?? '')));
        $source = strtolower(trim((string) ($input['template_source'] ?? 'marketing')));
        $templateId = trim((string) ($input['template_id'] ?? ''));
        if ($formId === '' || $templateId === '' || !in_array($channel, ['email', 'whatsapp'], true)) {
            respond(['error' => 'form_id, channel (email|whatsapp), and template_id are required'], 400);
        }
        $formRow = formsGetScopedForm($db, $formId, $tokenData);
        if (!$formRow) {
            respond(['error' => 'Form not found'], 404);
        }
        $result = formCampaignSendBulk($db, $tokenData, $formRow, $channel, $source, $templateId);
        if (empty($result['ok'])) {
            respond(['error' => $result['error'] ?? 'Campaign send failed', 'details' => $result], 502);
        }
        respond(['message' => 'Campaign sent', 'data' => $result]);
    }

    if ($action === 'campaign_settings') {
        $formId = trim((string) ($input['form_id'] ?? ''));
        $campaignInput = $input['campaign'] ?? null;
        if ($formId === '' || !is_array($campaignInput)) {
            respond(['error' => 'form_id and campaign object are required'], 400);
        }
        $formRow = formsGetScopedForm($db, $formId, $tokenData);
        if (!$formRow) {
            respond(['error' => 'Form not found'], 404);
        }
        if (!formCampaignCanManage($db, $tokenData, $formRow)) {
            respond(['error' => 'Forbidden — super admin, org admin, or marketing users with access to this form can manage campaigns'], 403);
        }
        $meta = formsParseMetaJson($formRow['meta_json'] ?? null);
        $meta = formCampaignMergeIntoMeta($meta, $campaignInput);
        $db->prepare('UPDATE lead_forms SET meta_json = ? WHERE id = ?')->execute([json_encode($meta), $formId]);
        $formRow['meta_json'] = $meta;
        $publishSend = !empty($input['send_to_existing']);
        $sendResult = null;
        if ($publishSend) {
            $sendResult = formCampaignSendAssignedOnPublish($db, $tokenData, $formRow, formCampaignParseConfig($meta));
        }
        respond([
            'message' => 'Campaign settings saved',
            'campaign' => formCampaignParseConfig($meta),
            'send_result' => $sendResult,
        ]);
    }

    if ($action === 'assign') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'manager']);
        $formId = trim($input['form_id'] ?? '');
        $memberIds = $input['member_ids'] ?? [];
        if (!$formId || !is_array($memberIds)) respond(['error' => 'form_id and member_ids are required'], 400);

        $isManagerAssign = $role === 'manager';
        $managerVisibleIds = $isManagerAssign ? hierarchyGetVisibleUserIds($db, $tokenData) : [];

        $chkParams = [$formId];
        $orgClause = '';
        if ($role !== 'super_admin') {
            // Managers may assign members on forms they can already see (own org / assigned).
            $accessible = formsGetAccessibleFormDetail($db, $formId, $tokenData);
            if (!$accessible) {
                respond(['error' => 'Form not found'], 404);
            }
            $formRow = ['id' => $accessible['id'], 'slug' => $accessible['slug'] ?? '', 'org_id' => $accessible['org_id'] ?? null];
        } else {
            $chk = $db->prepare("SELECT id, slug, org_id FROM lead_forms WHERE id = ? LIMIT 1");
            $chk->execute($chkParams);
            $formRow = $chk->fetch();
            if (!$formRow) respond(['error' => 'Form not found'], 404);
        }

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

            if ($role !== 'super_admin') {
                $formOrg = isset($formRow['org_id']) ? trim((string)$formRow['org_id']) : '';
                if ($memberOrg === '' || ($orgId && $memberOrg !== (string)$orgId)) {
                    respond(['error' => 'You can only assign members from your own organization'], 403);
                }
                if ($formOrg !== '' && $orgId && $formOrg !== (string)$orgId) {
                    respond(['error' => 'You can only assign members from your own organization'], 403);
                }
            }
            if ($isManagerAssign && !in_array($mid, $managerVisibleIds, true)) {
                respond(['error' => 'Managers can only assign form links to their own team'], 403);
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
        } elseif ($isManagerAssign) {
            // Managers only add/remove assignments among their downline (never wipe other teams).
            if ($managerVisibleIds === []) {
                respond(['error' => 'No team members available to assign'], 400);
            }
            $visPh = implode(',', array_fill(0, count($managerVisibleIds), '?'));
            if (empty($cleanMemberIds)) {
                $db->prepare("DELETE FROM lead_form_assignments WHERE form_id = ? AND member_id IN ($visPh)")
                    ->execute(array_merge([$formId], $managerVisibleIds));
            } else {
                $keepPh = implode(',', array_fill(0, count($cleanMemberIds), '?'));
                $delParams = array_merge([$formId], $managerVisibleIds, $cleanMemberIds);
                $db->prepare("
                    DELETE FROM lead_form_assignments
                    WHERE form_id = ? AND member_id IN ($visPh) AND member_id NOT IN ($keepPh)
                ")->execute($delParams);
            }
        } else {
            // Tenant admin: only touch assignments for members in their own org.
            if (empty($cleanMemberIds)) {
                $db->prepare('
                    DELETE lfa FROM lead_form_assignments lfa
                    INNER JOIN users u ON lfa.member_id = u.id
                    WHERE lfa.form_id = ? AND u.org_id = ?
                ')->execute([$formId, $orgId]);
            } else {
                $placeholders = implode(',', array_fill(0, count($cleanMemberIds), '?'));
                $delParams = array_merge([$formId, $orgId], $cleanMemberIds);
                $db->prepare("
                    DELETE lfa FROM lead_form_assignments lfa
                    INNER JOIN users u ON lfa.member_id = u.id
                    WHERE lfa.form_id = ? AND u.org_id = ?
                      AND lfa.member_id NOT IN ($placeholders)
                ")->execute($delParams);
            }
        }

        $upsert = syncpediaUpsertClause(
            $db,
            '(form_id, member_id)',
            ['assigned_by = EXCLUDED.assigned_by'],
            ['`assigned_by` = VALUES(`assigned_by`)'],
        );
        $stmt = $db->prepare("
            INSERT INTO lead_form_assignments (id, form_id, member_id, assigned_by)
            VALUES (?, ?, ?, ?)
            {$upsert}
        ");
        foreach ($cleanMemberIds as $mid) {
            $stmt->execute([generateUUID(), $formId, $mid, $userId]);
        }
        respond(['message' => 'Assignments saved']);
    }

    if ($action === 'backfill_sales_form_assignments') {
        requireRole($tokenData, ['super_admin', 'admin']);
        $scopeOrg = $role === 'super_admin' ? null : $orgId;
        $result = backfillLeadFormAssignmentsForSalesMembers($db, $userId, $scopeOrg);
        respond($result);
    }

    if ($action === 'generate_api_key') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'marketing']);
        $formId = trim((string) ($input['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $row = formsGetScopedForm($db, $formId, $tokenData);
        if (!$row) respond(['error' => 'Form not found'], 404);
        $meta = formsParseMetaJson($row['meta_json'] ?? null);
        $plain = formExternalApiKeyGenerateRaw();
        $meta['external_api_enabled'] = true;
        $meta['external_api_key_hash'] = formExternalApiKeyHash($plain);
        $meta['external_api_key_last_rotated_at'] = date('c');
        $db->prepare('UPDATE lead_forms SET meta_json = ? WHERE id = ?')
            ->execute([json_encode($meta), $formId]);
        respond([
            'message' => 'Form API key generated',
            'data' => [
                'form_id' => $formId,
                'api_key' => $plain,
                'enabled' => true,
                'integration_url' => '/apply?form=' . rawurlencode((string) ($row['slug'] ?? '')),
            ],
        ]);
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
    $writeOrgId = resolveWriteOrgId($db, $tokenData);
    if ($role === 'super_admin' && array_key_exists('org_id', $input)) {
        $writeOrgId = formsResolveSuperAdminOrgId($db, $tokenData, $input['org_id']);
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
        $writeOrgId
    ]);

    respond(['id' => $id, 'message' => 'Form created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['super_admin', 'admin', 'org', 'marketing', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'id required'], 400);
    $input = getInput();

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
    if ($role === 'super_admin' && array_key_exists('org_id', $input)) {
        $fields[] = 'org_id = ?';
        $vals[] = formsResolveSuperAdminOrgId($db, $tokenData, $input['org_id']);
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $chkRow = formsGetScopedForm($db, $id, $tokenData);
    if (!$chkRow) {
        respond(['error' => 'Form not found'], 404);
    }

    $vals[] = $id;
    $updateClause = '';
    if ($role === 'marketing') {
        $updateClause = ' AND created_by = ?';
        $vals[] = $userId;
    } elseif ($role === 'super_admin' && tenantIsMasterView($tokenData)) {
        // master view: no extra clause
    } elseif ($role === 'super_admin') {
        $switchOrg = trim((string) ($tokenData['org_id'] ?? ''));
        if ($switchOrg !== '') {
            $updateClause = ' AND org_id = ?';
            $vals[] = $switchOrg;
        }
    } elseif ($role !== 'super_admin') {
        $updateClause = ' AND org_id = ?';
        $vals[] = $orgId;
    }
    $stmt = $db->prepare("UPDATE lead_forms SET " . implode(', ', $fields) . " WHERE id = ? $updateClause");
    $stmt->execute($vals);
    if ($stmt->rowCount() < 1) {
        respond(['error' => 'Form not found or not updated'], 404);
    }

    if ($role === 'super_admin' && array_key_exists('org_id', $input)) {
        $newOrgId = trim((string) (formsResolveSuperAdminOrgId($db, $tokenData, $input['org_id']) ?? ''));
        $oldOrgId = isset($chkRow['org_id']) ? trim((string) $chkRow['org_id']) : '';
        if ($newOrgId !== '' && $newOrgId !== $oldOrgId) {
            $db->prepare('
                DELETE lfa FROM lead_form_assignments lfa
                INNER JOIN users u ON u.id = lfa.member_id
                WHERE lfa.form_id = ? AND (u.org_id IS NULL OR TRIM(u.org_id) = \'\' OR u.org_id <> ?)
            ')->execute([$id, $newOrgId]);
        }
    }

    respond(['message' => 'Form updated']);
}

if ($method === 'DELETE') {
    $action = $_GET['action'] ?? '';
    if ($action === 'revoke_api_key') {
        requireRole($tokenData, ['super_admin', 'admin', 'org', 'marketing']);
        $formId = trim((string) ($_GET['form_id'] ?? ''));
        if ($formId === '') respond(['error' => 'form_id required'], 400);
        $row = formsGetScopedForm($db, $formId, $tokenData);
        if (!$row) respond(['error' => 'Form not found'], 404);
        $meta = formsParseMetaJson($row['meta_json'] ?? null);
        unset($meta['external_api_key_hash']);
        $meta['external_api_enabled'] = false;
        $db->prepare('UPDATE lead_forms SET meta_json = ? WHERE id = ?')
            ->execute([json_encode($meta), $formId]);
        respond(['message' => 'Form API key revoked']);
    }

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
    $stmt = $db->prepare("DELETE FROM lead_forms WHERE id = ? $orgClause");
    $stmt->execute($params);
    respond(['message' => 'Form deleted']);
}

respond(['error' => 'Method not allowed'], 405);

