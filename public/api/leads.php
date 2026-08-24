<?php
require_once __DIR__ . '/helpers.php';

// Shims if server has newer leads.php but older helpers.php (avoids fatal "undefined function" on Enroll).
if (!function_exists('isStudentInsertUnknownColumn')) {
    function isStudentInsertUnknownColumn(Throwable $e, string $column): bool {
        $m = $e->getMessage();
        if (stripos($m, 'Unknown column') === false) {
            return false;
        }
        $col = preg_quote($column, '/');
        return preg_match('/Unknown column\s+[\'`]?' . $col . '[\'`]?/i', $m) === 1;
    }
}
if (!function_exists('isStudentInsertUnknownColumnFallback')) {
    /** True when students table is missing lead_id / org_id (retry with a slimmer INSERT). */
    function isStudentInsertUnknownColumnFallback(Throwable $e): bool {
        $m = $e->getMessage();
        if (stripos($m, 'Unknown column') === false) {
            return false;
        }
        foreach (['lead_id', 'org_id'] as $col) {
            if (preg_match('/Unknown column\s+[\'`]?' . preg_quote($col, '/') . '[\'`]?/i', $m)) {
                return true;
            }
        }
        return false;
    }
}
if (!function_exists('isMysqlForeignKeyViolation')) {
    function isMysqlForeignKeyViolation(Throwable $e): bool {
        if ($e instanceof PDOException && isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1452) {
            return true;
        }
        $m = $e->getMessage();
        return stripos($m, '1452') !== false || stripos($m, 'foreign key constraint') !== false;
    }
}

cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
if (function_exists('ensureLeadsStatusColumn')) {
    ensureLeadsStatusColumn($db);
}

/**
 * Validate batch for lead enrollment; returns course_id, counts, or error.
 *
 * @return array{course_id: ?string, seat_limit: int, enrolled: int, error: ?string}
 */
function leadsValidateBatchForLeadEnrollment(PDO $db, string $batchId, array $leadRow, array $tokenData): array
{
    $bid = trim($batchId);
    if ($bid === '') {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'batch_id is empty'];
    }
    $st = $db->prepare('SELECT id, course_id, org_id, seat_limit FROM batches WHERE id = ? LIMIT 1');
    $st->execute([$bid]);
    $b = $st->fetch(PDO::FETCH_ASSOC);
    if (!$b) {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'Batch not found'];
    }
    $leadOrg = trim((string) ($leadRow['org_id'] ?? ''));
    $jwtOrg = getOrgId($tokenData);
    $jwtOrgStr = is_string($jwtOrg) ? trim($jwtOrg) : '';
    $bOrg = trim((string) ($b['org_id'] ?? ''));
    $expectedOrg = $leadOrg !== '' ? $leadOrg : $jwtOrgStr;
    if ($expectedOrg !== '' && $bOrg !== '' && $bOrg !== $expectedOrg) {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'Batch does not belong to this lead\'s organization'];
    }
    $cid = isset($b['course_id']) ? trim((string) $b['course_id']) : '';
    $courseId = $cid !== '' ? $cid : null;
    $seatLimit = (int) ($b['seat_limit'] ?? 30);
    if ($seatLimit < 1) {
        $seatLimit = 30;
    }
    // Lock batch row to prevent concurrent enroll over seat_limit.
    try {
        $lock = $db->prepare('SELECT id FROM batches WHERE id = ? FOR UPDATE');
        $lock->execute([$bid]);
    } catch (Throwable $ignored) {
        // Not in a transaction yet — count still helps; caller enroll txn will re-check.
    }
    $enrolled = studentsActiveSeatCount($db, $bid);
    if ($enrolled >= $seatLimit) {
        return ['course_id' => $courseId, 'seat_limit' => $seatLimit, 'enrolled' => $enrolled, 'error' => 'This batch is full (seat limit reached)'];
    }

    return ['course_id' => $courseId, 'seat_limit' => $seatLimit, 'enrolled' => $enrolled, 'error' => null];
}

/** Set student course/batch for a lead after enrollment (new or existing student row). */
function leadsAttachStudentToBatch(PDO $db, string $leadId, ?string $courseId, string $batchId): void
{
    $batchId = trim($batchId);
    if ($batchId === '') {
        return;
    }
    $u = $db->prepare('UPDATE students SET course_id = ?, batch_id = ? WHERE lead_id = ?');
    $u->execute([$courseId, $batchId, $leadId]);
}

if ($method === 'GET') {
    try {
    @set_time_limit(300);
    $scope = tenantLeadsScopeSql($db, $tokenData, '');
    $where = '1=1' . $scope['sql'];
    $params = $scope['params'];
    $debug = !empty($_GET['debug']) && $_GET['debug'] !== '0' && $_GET['debug'] !== 'false';
    $debugMeta = [];

    if ($debug && tenantIsMasterView($tokenData) && syncpediaNormalizeRoleKey((string) $role) === 'super_admin') {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $debugMeta['visible_user_ids_count'] = count($visibleIds);
        $debugMeta['visible_user_ids_sample'] = array_slice($visibleIds, 0, 15);
    }

    if (!empty($_GET['status']) && $_GET['status'] !== 'all') {
        $where .= " AND status = ?";
        $params[] = $_GET['status'];
    }

    // Leads whose status was changed by the current user in a time window.
    // Prefers activities.type = status_change; falls back to updated_at + assignee/creator.
    $statusChangedPeriod = isset($_GET['status_changed']) ? trim((string) $_GET['status_changed']) : '';
    if ($statusChangedPeriod !== '') {
        $tz = new DateTimeZone('Asia/Kolkata');
        $tzNow = new DateTimeImmutable('now', $tz);
        $from = null;
        $to = null;
        if ($statusChangedPeriod === 'yesterday') {
            $y = $tzNow->modify('yesterday');
            $from = $y->setTime(0, 0, 0);
            $to = $y->setTime(23, 59, 59);
        } elseif ($statusChangedPeriod === 'last_7_days' || $statusChangedPeriod === 'last_week') {
            $from = $tzNow->modify('-7 days')->setTime(0, 0, 0);
            $to = $tzNow;
        } elseif ($statusChangedPeriod === 'this_month') {
            $from = $tzNow->modify('first day of this month')->setTime(0, 0, 0);
            $to = $tzNow;
        }
        if ($from !== null && $to !== null) {
            $fromStr = $from->format('Y-m-d H:i:s');
            $toStr = $to->format('Y-m-d H:i:s');
            $uid = (string) $userId;
            $leadIds = [];
            try {
                $actSql = "SELECT DISTINCT lead_id FROM activities
                    WHERE user_id = ?
                      AND type = 'status_change'
                      AND lead_id IS NOT NULL AND lead_id != ''
                      AND COALESCE(occurred_at, created_at) >= ?
                      AND COALESCE(occurred_at, created_at) <= ?";
                $act = $db->prepare($actSql);
                $act->execute([$uid, $fromStr, $toStr]);
                while ($lid = $act->fetchColumn()) {
                    $lid = trim((string) $lid);
                    if ($lid !== '') {
                        $leadIds[$lid] = true;
                    }
                }
            } catch (Throwable $e) {
                // activities table / columns may differ on older DBs
            }
            try {
                $laSql = "SELECT DISTINCT lead_id FROM lead_activities
                    WHERE user_id = ?
                      AND type = 'status_change'
                      AND lead_id IS NOT NULL AND lead_id != ''
                      AND created_at >= ? AND created_at <= ?";
                $la = $db->prepare($laSql);
                $la->execute([$uid, $fromStr, $toStr]);
                while ($lid = $la->fetchColumn()) {
                    $lid = trim((string) $lid);
                    if ($lid !== '') {
                        $leadIds[$lid] = true;
                    }
                }
            } catch (Throwable $e) {
            }
            if ($leadIds !== []) {
                $ids = array_keys($leadIds);
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $where .= " AND id IN ($ph)";
                $params = array_merge($params, $ids);
            } else {
                // Fallback: lead updated in window and owned/assigned to this user
                $where .= " AND updated_at >= ? AND updated_at <= ?
                    AND (assigned_to = ? OR created_by = ?)";
                $params[] = $fromStr;
                $params[] = $toStr;
                $params[] = $uid;
                $params[] = $uid;
            }
        }
    }

    if (!empty($_GET['search'])) {
        $where .= " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ? OR college LIKE ?)";
        $s = '%' . $_GET['search'] . '%';
        $params = array_merge($params, [$s, $s, $s, $s, $s]);
    }

    if (!empty($_GET['referred_by'])) {
        $where .= " AND referred_by = ?";
        $params[] = trim((string) $_GET['referred_by']);
    }

    if (!empty($_GET['form_leads']) && $_GET['form_leads'] !== '0' && $_GET['form_leads'] !== 'false') {
        $where .= " AND referred_by IS NOT NULL AND referred_by != ''";
    }

    if ($debug) {
        $debugMeta['role'] = $role;
        $debugMeta['user_id'] = $userId;
        $debugMeta['org_id'] = getOrgId($tokenData);
        $debugMeta['where'] = $where;
        $debugMeta['params_count'] = count($params);
        respond(['debug' => $debugMeta]);
    }

    // Soft cap per request — clients may page with offset until truncated=false.
    $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 100000;
    if ($limit < 1) {
        $limit = 100000;
    }
    if ($limit > 100000) {
        $limit = 100000;
    }
    $offset = isset($_GET['offset']) ? (int) $_GET['offset'] : 0;
    if ($offset < 0) {
        $offset = 0;
    }

    $countStmt = $db->prepare("SELECT COUNT(*) FROM leads WHERE $where");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $stmt = $db->prepare("SELECT * FROM leads WHERE $where ORDER BY created_at DESC LIMIT " . $limit . " OFFSET " . $offset);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $fetched = count($rows);

    // Resolve creator display names for "Created by" (Added leads card, managers).
    if ($fetched > 0 && syncpediaColumnExists($db, 'leads', 'created_by')) {
        $creatorIds = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $cid = trim((string) ($row['created_by'] ?? ''));
            if ($cid !== '') {
                $creatorIds[$cid] = true;
            }
        }
        $idList = array_keys($creatorIds);
        if ($idList !== []) {
            $nameMap = [];
            foreach (array_chunk($idList, 200) as $chunk) {
                $ph = implode(',', array_fill(0, count($chunk), '?'));
                try {
                    $ns = $db->prepare("SELECT id, full_name FROM users WHERE id IN ($ph)");
                    $ns->execute($chunk);
                    while ($u = $ns->fetch(PDO::FETCH_ASSOC)) {
                        if (!is_array($u)) {
                            continue;
                        }
                        $uid = trim((string) ($u['id'] ?? ''));
                        if ($uid === '') {
                            continue;
                        }
                        $nameMap[$uid] = trim((string) ($u['full_name'] ?? ''));
                    }
                } catch (Throwable $ignored) {
                }
            }
            foreach ($rows as &$row) {
                if (!is_array($row)) {
                    continue;
                }
                $cid = trim((string) ($row['created_by'] ?? ''));
                $row['created_by_name'] = ($cid !== '' && isset($nameMap[$cid]) && $nameMap[$cid] !== '')
                    ? $nameMap[$cid]
                    : null;
            }
            unset($row);
        }
    }

    respond([
        'data' => $rows,
        'count' => $fetched,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'truncated' => ($offset + $fetched) < $total,
    ]);
    } catch (Throwable $e) {
        error_log('leads.php GET: ' . $e->getMessage());
        $payload = ['error' => 'Failed to load leads'];
        if (defined('APP_DEBUG') && APP_DEBUG) {
            $payload['detail'] = $e->getMessage();
        }
        respond($payload, 500);
    }
}

if ($method === 'POST') {
    ensureLeadsResumeColumn($db);
    ensureLeadsCreatedByColumn($db);
    $input = getInput();
    if (!is_array($input)) {
        $input = [];
    }

    // Resolve action from query OR JSON body (some hosts/proxies drop/alter query on POST)
    $postAction = trim((string) ($_GET['action'] ?? ''));
    if ($postAction === '') {
        $postAction = trim((string) ($input['action'] ?? ''));
    }

    // Bulk delete — never fall through to create-lead validation
    $idsPayload = $input['ids'] ?? null;
    $looksLikeBulkDelete = is_array($idsPayload)
        && $idsPayload !== []
        && !isset($input['leads'])
        && !array_key_exists('name', $input)
        && !array_key_exists('phone', $input)
        && !array_key_exists('email', $input);
    if ($postAction === 'bulk_delete' || ($postAction === '' && $looksLikeBulkDelete)) {
        requireRole($tokenData, ['admin', 'super_admin', 'manager']);
        if (!is_array($idsPayload) || $idsPayload === []) {
            respond(['error' => 'ids array required'], 400);
        }
        $ids = array_values(array_unique(array_filter(array_map(static function ($id) {
            return is_string($id) || is_numeric($id) ? trim((string) $id) : '';
        }, $idsPayload), static fn ($id) => $id !== '')));
        if ($ids === []) {
            respond(['error' => 'ids array required'], 400);
        }
        if (count($ids) > 5000) {
            respond(['error' => 'Cannot delete more than 5000 leads at once'], 400);
        }

        @set_time_limit(300);
        $deleted = 0;
        $skipped = 0;
        $del = $db->prepare('DELETE FROM leads WHERE id = ?');
        foreach (array_chunk($ids, 200) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '?'));
            $sel = $db->prepare("SELECT * FROM leads WHERE id IN ($placeholders)");
            $sel->execute($chunk);
            $found = [];
            while ($lead = $sel->fetch(PDO::FETCH_ASSOC)) {
                $found[(string) $lead['id']] = $lead;
            }
            foreach ($chunk as $id) {
                $lead = $found[$id] ?? null;
                if (!$lead) {
                    $skipped++;
                    continue;
                }
                if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
                    $skipped++;
                    continue;
                }
                try {
                    trashArchiveRow($db, 'lead', 'leads', $id, $tokenData);
                } catch (RuntimeException $e) {
                    respond([
                        'error' => 'Could not archive to trash — delete aborted',
                        'deleted' => $deleted,
                        'skipped' => $skipped,
                        'detail' => $e->getMessage(),
                    ], 500);
                }
                $del->execute([$id]);
                $deleted++;
            }
        }
        syncpediaAuditLog($db, $tokenData, 'deleted', 'lead', null, "Bulk deleted {$deleted} lead(s), skipped {$skipped}");
        respond([
            'message' => 'Bulk delete complete',
            'deleted' => $deleted,
            'skipped' => $skipped,
            'handler' => 'bulk_delete',
        ]);
    }

    if ($postAction === 'bulk') {
        $rows = $input['leads'] ?? $input;
        if (!is_array($rows) || $rows === []) {
            respond(['error' => 'Expected non-empty leads array'], 400);
        }
        $callerRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
        $bulkOrgId = resolveCreatorOrgId($db, $tokenData);
        // Super Admin must target an explicit org (body org_id or per-row org_id)
        $explicitOrg = trim((string) ($input['org_id'] ?? ''));
        if ($callerRole === 'super_admin') {
            if ($explicitOrg === '') {
                // Allow first-row org_id if top-level omitted
                foreach ($rows as $probe) {
                    if (is_array($probe)) {
                        $explicitOrg = trim((string) ($probe['org_id'] ?? ''));
                        if ($explicitOrg !== '') {
                            break;
                        }
                    }
                }
            }
            if ($explicitOrg === '') {
                respond(['error' => 'Select an organization for this import (org_id is required for Super Admin)'], 400);
            }
            $chk = $db->prepare('SELECT id, name FROM organizations WHERE id = ? LIMIT 1');
            $chk->execute([$explicitOrg]);
            $orgRow = $chk->fetch(PDO::FETCH_ASSOC);
            if (!$orgRow) {
                respond(['error' => 'Organization not found'], 404);
            }
            $bulkOrgId = $explicitOrg;
        }

        $created = 0;
        $skipped = 0;
        $errors = [];
        $seenEmails = [];
        $seenPhones = [];
        // Per-org dedup index loaded once (one scan) instead of one
        // REPLACE(...) LIKE full-table scan per imported row.
        $dedupIndexByOrg = [];
        try {
            $db->beginTransaction();
            foreach ($rows as $i => $row) {
                if (!is_array($row)) {
                    continue;
                }
                $name = trim((string) ($row['name'] ?? ''));
                $phone = trim((string) ($row['phone'] ?? ''));
                $email = trim((string) ($row['email'] ?? ''));
                if ($name === '') {
                    if ($phone !== '') {
                        $name = $phone;
                    } elseif ($email !== '') {
                        $name = $email;
                    } else {
                        $errors[] = "Row $i: name, phone, or email is required";
                        continue;
                    }
                }
                $referredBy = trim((string) ($row['referred_by'] ?? ''));
                $referredBy = $referredBy !== '' ? $referredBy : null;
                // Imports always land unassigned unless a row explicitly names an assignee.
                // Admins/managers assign to L1 members later via bulk assign.
                $assignedTo = $row['assigned_to'] ?? null;
                if ($assignedTo !== null && trim((string) $assignedTo) === '') {
                    $assignedTo = null;
                }
                // L1 importers own rows they bring in so status/edit works immediately.
                if (hierarchyRoleUsesL1OwnLeadsScope($tokenData) && ($assignedTo === null || $assignedTo === '')) {
                    $assignedTo = $userId;
                }
                $orgId = $bulkOrgId;
                if ($callerRole === 'super_admin') {
                    $rowOrg = trim((string) ($row['org_id'] ?? ''));
                    if ($rowOrg !== '') {
                        // Validate per-row org exists
                        $chkRow = $db->prepare('SELECT id FROM organizations WHERE id = ? AND is_active = 1 LIMIT 1');
                        $chkRow->execute([$rowOrg]);
                        if (!$chkRow->fetch()) {
                            $errors[] = "Row $i: org_id not found";
                            continue;
                        }
                        $orgId = $rowOrg;
                    }
                }
                if ($orgId === null && !empty($assignedTo)) {
                    try {
                        $oStmt = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
                        $oStmt->execute([$assignedTo]);
                        $oRow = $oStmt->fetch(PDO::FETCH_ASSOC);
                        $pick = is_array($oRow) ? trim((string) ($oRow['org_id'] ?? '')) : '';
                        if ($pick !== '') {
                            $orgId = $pick;
                        }
                    } catch (Throwable $ignored) {
                    }
                }

                $emailKey = strtolower($email);
                $phoneDigits = preg_replace('/\D+/', '', $phone) ?? '';
                if (strlen($phoneDigits) > 10) {
                    $phoneDigits = substr($phoneDigits, -10);
                }
                if ($emailKey !== '' && isset($seenEmails[$emailKey])) {
                    $skipped++;
                    $errors[] = "Row $i: duplicate email in this import ({$email})";
                    continue;
                }
                if ($phoneDigits !== '' && strlen($phoneDigits) >= 10 && isset($seenPhones[$phoneDigits])) {
                    $skipped++;
                    $errors[] = "Row $i: duplicate phone in this import ({$phone})";
                    continue;
                }
                $dup = null;
                if (is_string($orgId) && $orgId !== '') {
                    if (!isset($dedupIndexByOrg[$orgId])) {
                        $dedupIndexByOrg[$orgId] = leadsLoadDedupIndex($db, $orgId);
                    }
                    if ($emailKey !== '' && isset($dedupIndexByOrg[$orgId]['emails'][$emailKey])) {
                        $dup = $dedupIndexByOrg[$orgId]['emails'][$emailKey];
                    } elseif (strlen($phoneDigits) >= 10 && isset($dedupIndexByOrg[$orgId]['phones'][$phoneDigits])) {
                        $dup = $dedupIndexByOrg[$orgId]['phones'][$phoneDigits];
                    }
                } else {
                    // No org context — fall back to the DB check (rare path).
                    $dup = leadsFindDuplicateInOrg($db, null, $email, $phone);
                }
                if ($dup) {
                    $skipped++;
                    $errors[] = "Row $i: already exists as lead {$dup['id']} ({$dup['name']})";
                    continue;
                }
                if ($emailKey !== '') {
                    $seenEmails[$emailKey] = true;
                }
                if ($phoneDigits !== '' && strlen($phoneDigits) >= 10) {
                    $seenPhones[$phoneDigits] = true;
                }

                // Imports always land as "new" — never teleport to enrolled/lost without the pipeline.
                $statusIn = 'new';

                $id = generateUUID();
                try {
                    $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    $stmt->execute([
                        $id,
                        $name,
                        $email !== '' ? $email : null,
                        $phone !== '' ? $phone : null,
                        $row['company'] ?? null,
                        $row['college'] ?? null,
                        $row['year_of_study'] ?? null,
                        $row['course_interest'] ?? null,
                        $referredBy,
                        $row['source'] ?? 'other',
                        $row['notes'] ?? null,
                        $assignedTo,
                        isset($row['tags']) ? json_encode($row['tags']) : null,
                        $orgId,
                        $statusIn,
                        $userId,
                    ]);
                    if ($assignedTo !== null && trim((string) $assignedTo) !== '') {
                        leadsSetAssignee($db, $id, (string) $assignedTo);
                    }
                    $created++;
                } catch (Throwable $e) {
                    // Older schema without created_by
                    try {
                        $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                        $stmt->execute([
                            $id,
                            $name,
                            $email !== '' ? $email : null,
                            $phone !== '' ? $phone : null,
                            $row['company'] ?? null,
                            $row['college'] ?? null,
                            $row['year_of_study'] ?? null,
                            $row['course_interest'] ?? null,
                            $referredBy,
                            $row['source'] ?? 'other',
                            $row['notes'] ?? null,
                            $assignedTo,
                            isset($row['tags']) ? json_encode($row['tags']) : null,
                            $orgId,
                            $statusIn,
                        ]);
                        if ($assignedTo !== null && trim((string) $assignedTo) !== '') {
                            leadsSetAssignee($db, $id, (string) $assignedTo);
                        }
                        $created++;
                    } catch (Throwable $e2) {
                        $errors[] = "Row $i: " . $e2->getMessage();
                    }
                }
            }
            if ($db->inTransaction()) {
                if (!$db->commit()) {
                    throw new RuntimeException('Database commit failed');
                }
            }
        } catch (Throwable $bulkErr) {
            try {
                $db->rollBack();
            } catch (Throwable $ignored) {
            }
            $msg = $bulkErr->getMessage();
            if (!is_string($msg) || $msg === '') {
                $msg = 'Unknown error';
            }
            if (strlen($msg) > 500) {
                $msg = substr($msg, 0, 500) . '…';
            }
            respond([
                'error' => 'Bulk create failed: ' . $msg,
                'processed_rows' => $created + $skipped,
                'rolled_back' => true,
            ], 500);
        }

        $orgName = '';
        if (is_string($bulkOrgId) && $bulkOrgId !== '') {
            try {
                $n = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
                $n->execute([$bulkOrgId]);
                $orgName = (string) ($n->fetchColumn() ?: '');
            } catch (Throwable $ignored) {
            }
        }
        if ($created > 0) {
            syncpediaNotifyOrgAdminsOfBulkKind(
                $db,
                (string) $userId,
                is_string($bulkOrgId) && $bulkOrgId !== '' ? (string) $bulkOrgId : null,
                'leads_import',
                (int) $created,
            );
        }
        respond([
            'message' => 'Bulk create complete',
            'created' => $created,
            'skipped' => $skipped,
            'errors' => array_slice($errors, 0, 50),
            'org_id' => $bulkOrgId,
            'org_name' => $orgName,
        ], 201);
    }

    // Never treat a delete payload as "create lead" (avoids "Name, phone, or email is required")
    if (isset($input['ids']) && is_array($input['ids'])) {
        respond(['error' => 'Bulk delete payload received but not handled. Upload latest api/leads.php and use action=bulk_delete.'], 400);
    }
    if ($postAction !== '' && $postAction !== 'bulk') {
        respond(['error' => 'Unknown action: ' . $postAction], 400);
    }

    $id = generateUUID();
    $name = trim($input['name'] ?? '');
    $phoneIn = trim((string) ($input['phone'] ?? ''));
    $emailIn = trim((string) ($input['email'] ?? ''));
    if ($name === '') {
        if ($phoneIn !== '') {
            $name = $phoneIn;
        } elseif ($emailIn !== '') {
            $name = $emailIn;
        } else {
            respond(['error' => 'Name, phone, or email is required'], 400);
        }
    }

    $resumePathIn = isset($input['resume_path']) ? trim((string) $input['resume_path']) : '';
    $resumePathIn = $resumePathIn !== '' && strpos($resumePathIn, '/uploads/resumes/') === 0 ? $resumePathIn : null;

    // Validate assigned_to to avoid FK failures on malformed/old data.
    $assignedTo = $input['assigned_to'] ?? null;
    $assigneeRow = null;
    if ($assignedTo !== null && trim((string) $assignedTo) === '') {
        $assignedTo = null;
    }
    if (!empty($assignedTo)) {
        $ustmt = $db->prepare('SELECT id, org_id FROM users WHERE id = ? LIMIT 1');
        $ustmt->execute([$assignedTo]);
        $assigneeRow = $ustmt->fetch(PDO::FETCH_ASSOC);
        if (!$assigneeRow) {
            $assignedTo = null;
        }
    }
    // L1 (sales / marketing / HR) UI often omits "Assign to" — assign to self so list + status edit work.
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData) && ($assignedTo === null || $assignedTo === '')) {
        $assignedTo = $userId;
    }
    // Managers never auto-own creates — leave unassigned for L1 bulk/manual assign.
    // After auto-assign, load assignee org for tenant stamping
    if (!empty($assignedTo) && !is_array($assigneeRow)) {
        $ustmt = $db->prepare('SELECT id, org_id FROM users WHERE id = ? LIMIT 1');
        $ustmt->execute([$assignedTo]);
        $assigneeRow = $ustmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if (!$assigneeRow) {
            $assignedTo = null;
        }
    }

    $createOrgId = resolveCreatorOrgId($db, $tokenData);
    if ($createOrgId === null && is_array($assigneeRow)) {
        $ao = trim((string) ($assigneeRow['org_id'] ?? ''));
        if ($ao !== '') {
            $createOrgId = $ao;
        }
    }
    $dup = leadsFindDuplicateInOrg($db, is_string($createOrgId) ? $createOrgId : null, $emailIn, $phoneIn);
    if ($dup) {
        respond([
            'error' => 'A lead with this email or phone already exists',
            'existing_lead_id' => $dup['id'],
            'existing_name' => $dup['name'],
        ], 409);
    }

    $referredBy = trim((string) ($input['referred_by'] ?? ''));
    $referredBy = $referredBy !== '' ? $referredBy : null;
    // Manual L1 entries: stamp referral attribution like form/referral leads (My Leads / analytics).
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData) && ($referredBy === null || $referredBy === '')) {
        try {
            $rcStmt = $db->prepare('SELECT referral_code FROM users WHERE id = ? LIMIT 1');
            $rcStmt->execute([$userId]);
            $rcRow = $rcStmt->fetch(PDO::FETCH_ASSOC);
            $autoRef = trim((string) (($rcRow && is_array($rcRow)) ? ($rcRow['referral_code'] ?? '') : ''));
            if ($autoRef !== '') {
                $referredBy = $autoRef;
            }
        } catch (Throwable $ignored) {
        }
    }

    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null && !empty($assignedTo) && is_array($assigneeRow ?? null)) {
        $pick = trim((string) ($assigneeRow['org_id'] ?? ''));
        if ($pick !== '') {
            $orgId = $pick;
        }
    }
    if (!empty($assignedTo) && is_array($assigneeRow ?? null) && $orgId !== null && $role !== 'super_admin') {
        $assigneeOrg = trim((string) ($assigneeRow['org_id'] ?? ''));
        if ($assigneeOrg !== '' && $assigneeOrg !== $orgId) {
            respond(['error' => 'Assignee must belong to your organization'], 403);
        }
    }

    $createdBy = is_string($userId) && $userId !== '' ? $userId : null;
    $hasCreatedBy = syncpediaColumnExists($db, 'leads', 'created_by');

    // Stamp manual CRM creates so they land in the "Added leads" source card.
    $tagsIn = $input['tags'] ?? [];
    if (!is_array($tagsIn)) {
        $tagsIn = [];
    }
    $hasManualTag = false;
    foreach ($tagsIn as $t) {
        if (strtolower(trim((string) $t)) === 'entry:manual') {
            $hasManualTag = true;
            break;
        }
    }
    if (!$hasManualTag) {
        $tagsIn[] = 'entry:manual';
    }
    $tagsJson = json_encode(array_values($tagsIn));

    try {
        if ($hasCreatedBy) {
            $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, resume_path, assigned_to, tags, org_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $name,
                $emailIn !== '' ? $emailIn : ($input['email'] ?? null),
                $phoneIn !== '' ? $phoneIn : ($input['phone'] ?? null),
                $input['company'] ?? null,
                $input['college'] ?? null,
                $input['year_of_study'] ?? null,
                $input['course_interest'] ?? null,
                $referredBy,
                $input['source'] ?? 'other',
                $input['notes'] ?? null,
                $resumePathIn,
                $assignedTo,
                $tagsJson,
                $orgId,
                $createdBy,
            ]);
        } else {
            $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, resume_path, assigned_to, tags, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $name,
                $emailIn !== '' ? $emailIn : ($input['email'] ?? null),
                $phoneIn !== '' ? $phoneIn : ($input['phone'] ?? null),
                $input['company'] ?? null,
                $input['college'] ?? null,
                $input['year_of_study'] ?? null,
                $input['course_interest'] ?? null,
                $referredBy,
                $input['source'] ?? 'other',
                $input['notes'] ?? null,
                $resumePathIn,
                $assignedTo,
                $tagsJson,
                $orgId,
            ]);
        }
        if ($assignedTo !== null && trim((string) $assignedTo) !== '') {
            leadsSetAssignee($db, $id, (string) $assignedTo);
        }
        respond(['id' => $id, 'message' => 'Lead created'], 201);
    } catch (Exception $e) {
        try {
            // Backward-compatible fallback for older lead schemas (no resume_path).
            if ($hasCreatedBy) {
                $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $id,
                    $name,
                    $input['email'] ?? null,
                    $input['phone'] ?? null,
                    $input['company'] ?? null,
                    $input['college'] ?? null,
                    $input['year_of_study'] ?? null,
                    $input['course_interest'] ?? null,
                    $referredBy,
                    $input['source'] ?? 'other',
                    $input['notes'] ?? null,
                    $assignedTo,
                    $tagsJson,
                    $orgId,
                    $createdBy,
                ]);
            } else {
                $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $id,
                    $name,
                    $input['email'] ?? null,
                    $input['phone'] ?? null,
                    $input['company'] ?? null,
                    $input['college'] ?? null,
                    $input['year_of_study'] ?? null,
                    $input['course_interest'] ?? null,
                    $referredBy,
                    $input['source'] ?? 'other',
                    $input['notes'] ?? null,
                    $assignedTo,
                    $tagsJson,
                    $orgId,
                ]);
            }
            if ($assignedTo !== null && trim((string) $assignedTo) !== '') {
                leadsSetAssignee($db, $id, (string) $assignedTo);
            }
            respond(['id' => $id, 'message' => 'Lead created'], 201);
        } catch (Exception $e2) {
            try {
                // Minimal legacy schema
                $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, source, notes) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $id,
                    $name,
                    $input['email'] ?? null,
                    $input['phone'] ?? null,
                    $input['source'] ?? 'other',
                    $input['notes'] ?? null,
                ]);
                respond(['id' => $id, 'message' => 'Lead created'], 201);
            } catch (Exception $e3) {
                respond(['error' => 'Lead create failed: ' . $e3->getMessage()], 500);
            }
        }
    }
}

if ($method === 'PUT') {
    ensureLeadsResumeColumn($db);
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $stmt = $db->prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $lead = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$lead) {
        respond(['error' => 'Lead not found'], 404);
    }
    if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
        respond(['error' => 'Forbidden'], 403);
    }
    $prevStatus = (string) ($lead['status'] ?? '');

    $allowedStatus = leadsAllowedStatuses();
    if (array_key_exists('status', $input)) {
        $input['status'] = leadsNormalizeStatus((string) $input['status']);
        if (!in_array($input['status'], $allowedStatus, true)) {
            respond(['error' => 'Invalid status'], 400);
        }
        $transitionErr = leadsAssertStatusTransition($prevStatus, (string) $input['status']);
        if ($transitionErr !== null) {
            respond(['error' => $transitionErr], 400);
        }
    }

    if (isset($input['status']) && $input['status'] === 'enrolled') {
        $stmt = $db->prepare("SELECT id, name, email, phone, college, year_of_study, org_id FROM leads WHERE id = ? LIMIT 1");
        $stmt->execute([$id]);
        $leadRow = $stmt->fetch();
        if (!$leadRow) {
            respond(['error' => 'Lead not found'], 404);
        }
        $em = trim(array_key_exists('email', $input) ? (string)$input['email'] : (string)($leadRow['email'] ?? ''));
        if ($em === '') {
            respond(['error' => 'Add an email on the lead before enrolling as a student.'], 400);
        }
    }

    $fields = [];
    $params = [];
    foreach (['name', 'email', 'phone', 'company', 'college', 'year_of_study', 'course_interest', 'referred_by', 'source', 'status', 'score', 'notes', 'assigned_to', 'next_follow_up'] as $f) {
        if (array_key_exists($f, $input)) {
            if ($f === 'assigned_to') {
                $rawAssign = $input['assigned_to'];
                if ($rawAssign === null || (is_string($rawAssign) && trim($rawAssign) === '')) {
                    $fields[] = 'assigned_to = NULL';
                    continue;
                }
                $assignId = trim((string) $rawAssign);
                syncpediaAssertUserInCallerOrg($db, $tokenData, $assignId);
                $fields[] = 'assigned_to = ?';
                $params[] = $assignId;
                continue;
            }
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (array_key_exists('resume_path', $input)) {
        $rp = trim((string) $input['resume_path']);
        $rp = $rp === '' ? null : $rp;
        if ($rp === null || strpos($rp, '/uploads/resumes/') === 0) {
            $fields[] = 'resume_path = ?';
            $params[] = $rp;
        }
    }

    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $updateSql = 'UPDATE leads SET ' . implode(', ', $fields) . ' WHERE id = ?';
    $stmt = $db->prepare($updateSql);

    if (isset($input['status']) && $input['status'] === 'enrolled') {
        ensureStudentsLeadIdUnique($db);
        try {
            $db->beginTransaction();
            $lockLead = $db->prepare('SELECT id, status FROM leads WHERE id = ? FOR UPDATE');
            $lockLead->execute([$id]);
            $locked = $lockLead->fetch(PDO::FETCH_ASSOC);
            if (!$locked) {
                throw new RuntimeException('Lead not found');
            }
            $livePrev = leadsNormalizeStatus((string) ($locked['status'] ?? ''));
            if ($livePrev !== leadsNormalizeStatus($prevStatus)) {
                throw new RuntimeException('Lead was updated by someone else — refresh and try again');
            }
            $execParams = $params;
            $execParams[] = $prevStatus;
            $casStmt = $db->prepare($updateSql . ' AND status = ?');
            $casStmt->execute($execParams);
            if ($casStmt->rowCount() < 1) {
                throw new RuntimeException('Lead was updated by someone else — refresh and try again');
            }

            $q = $db->prepare('SELECT id, name, email, phone, college, year_of_study, org_id FROM leads WHERE id = ? LIMIT 1');
            $q->execute([$id]);
            $leadRow = $q->fetch();
            $alreadyLinked = false;
            try {
                $chk = $db->prepare('SELECT id FROM students WHERE lead_id = ? LIMIT 1');
                $chk->execute([$id]);
                $alreadyLinked = (bool)$chk->fetch();
            } catch (Throwable $ignored) {
                // students.lead_id missing on older DB — still attempt insert paths below.
            }
            if ($leadRow && !$alreadyLinked) {
                $sid = generateUUID();
                $stuName = trim((string)($leadRow['name'] ?? '')) ?: 'Student';
                $stuEmail = trim((string)($leadRow['email'] ?? ''));
                $enrollDay = date('Y-m-d');
                // students.php GET filters by s.org_id or l.org_id — NULL hides the row. Use JWT org when lead has none.
                $leadOrg = isset($leadRow['org_id']) ? trim((string) $leadRow['org_id']) : '';
                $orgIdForStudent = $leadOrg !== '' ? $leadOrg : null;
                if ($orgIdForStudent === null || $orgIdForStudent === '') {
                    $jwtOrg = getOrgId($tokenData);
                    if (is_string($jwtOrg) && $jwtOrg !== '') {
                        $orgIdForStudent = $jwtOrg;
                    }
                }
                if ($orgIdForStudent !== null && $orgIdForStudent !== '' && $leadOrg === '') {
                    try {
                        $upLo = $db->prepare('UPDATE leads SET org_id = ? WHERE id = ? AND (org_id IS NULL OR org_id = \'\')');
                        $upLo->execute([$orgIdForStudent, $id]);
                        $leadRow['org_id'] = $orgIdForStudent;
                    } catch (Throwable $ignored) {
                    }
                }
                try {
                    ensureStudentsEnrolledByColumn($db);
                    $enrolledBy = trim((string) ($tokenData['user_id'] ?? ''));
                    if ($enrolledBy === '') {
                        $enrolledBy = null;
                    }
                    if ($enrolledBy !== null && syncpediaColumnExists($db, 'students', 'enrolled_by')) {
                        $ins = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date, enrolled_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                        $ins->execute([
                            $sid,
                            $stuName,
                            $stuEmail,
                            $leadRow['phone'] ?? null,
                            $leadRow['college'] ?? null,
                            $leadRow['year_of_study'] ?? null,
                            $id,
                            $orgIdForStudent,
                            'active',
                            $enrollDay,
                            $enrolledBy,
                        ]);
                    } else {
                        $ins = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                        $ins->execute([
                            $sid,
                            $stuName,
                            $stuEmail,
                            $leadRow['phone'] ?? null,
                            $leadRow['college'] ?? null,
                            $leadRow['year_of_study'] ?? null,
                            $id,
                            $orgIdForStudent,
                            'active',
                            $enrollDay,
                        ]);
                    }
                } catch (Throwable $insErr) {
                    if (isMysqlDuplicateKey($insErr) && enrollStudentRowAlreadyExists($db, $id)) {
                        // Idempotent: lead already has (or shares) a student row.
                    } elseif (isMysqlForeignKeyViolation($insErr) && $orgIdForStudent !== null && $orgIdForStudent !== '') {
                        try {
                            $sidFk = generateUUID();
                            $insFk = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status, enrollment_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                            $insFk->execute([
                                $sidFk,
                                $stuName,
                                $stuEmail,
                                $leadRow['phone'] ?? null,
                                $leadRow['college'] ?? null,
                                $leadRow['year_of_study'] ?? null,
                                $id,
                                null,
                                'active',
                                $enrollDay,
                            ]);
                        } catch (Throwable $insFkErr) {
                            if (isMysqlDuplicateKey($insFkErr) && enrollStudentRowAlreadyExists($db, $id)) {
                                // ok
                            } elseif (isStudentInsertUnknownColumnFallback($insFkErr) || isStudentInsertUnknownColumn($insFkErr, 'enrollment_date')) {
                                throw $insFkErr;
                            } else {
                                throw $insFkErr;
                            }
                        }
                    } elseif (isStudentInsertUnknownColumn($insErr, 'enrollment_date')) {
                        $sidEd = generateUUID();
                        $insEd = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
                        try {
                            $insEd->execute([
                                $sidEd,
                                $stuName,
                                $stuEmail,
                                $leadRow['phone'] ?? null,
                                $leadRow['college'] ?? null,
                                $leadRow['year_of_study'] ?? null,
                                $id,
                                $orgIdForStudent,
                                'active',
                            ]);
                        } catch (Throwable $insEdErr) {
                            if (isMysqlDuplicateKey($insEdErr) && enrollStudentRowAlreadyExists($db, $id)) {
                                // ok
                            } elseif (isMysqlForeignKeyViolation($insEdErr) && $orgIdForStudent !== null && $orgIdForStudent !== '') {
                                $sidEd2 = generateUUID();
                                $insEd2 = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, lead_id, org_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
                                $insEd2->execute([
                                    $sidEd2,
                                    $stuName,
                                    $stuEmail,
                                    $leadRow['phone'] ?? null,
                                    $leadRow['college'] ?? null,
                                    $leadRow['year_of_study'] ?? null,
                                    $id,
                                    null,
                                    'active',
                                ]);
                            } elseif (isStudentInsertUnknownColumnFallback($insEdErr)) {
                                throw $insEdErr;
                            } else {
                                throw $insEdErr;
                            }
                        }
                    } elseif (isStudentInsertUnknownColumnFallback($insErr)) {
                        $sid2 = generateUUID();
                        $ins2 = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, status, enrollment_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                        try {
                            $ins2->execute([
                                $sid2,
                                $stuName,
                                $stuEmail,
                                $leadRow['phone'] ?? null,
                                $leadRow['college'] ?? null,
                                $leadRow['year_of_study'] ?? null,
                                'active',
                                $enrollDay,
                            ]);
                        } catch (Throwable $ins2Err) {
                            if (isMysqlDuplicateKey($ins2Err) && enrollStudentRowAlreadyExists($db, $id)) {
                                // ok
                            } elseif (isStudentInsertUnknownColumn($ins2Err, 'enrollment_date')) {
                                $sid3 = generateUUID();
                                $ins3 = $db->prepare('INSERT INTO students (id, name, email, phone, college, year_of_study, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
                                try {
                                    $ins3->execute([
                                        $sid3,
                                        $stuName,
                                        $stuEmail,
                                        $leadRow['phone'] ?? null,
                                        $leadRow['college'] ?? null,
                                        $leadRow['year_of_study'] ?? null,
                                        'active',
                                    ]);
                                } catch (Throwable $ins3Err) {
                                    if (isMysqlDuplicateKey($ins3Err) && enrollStudentRowAlreadyExists($db, $id)) {
                                        // ok
                                    } else {
                                        throw $ins3Err;
                                    }
                                }
                            } else {
                                throw $ins2Err;
                            }
                        }
                    } else {
                        throw $insErr;
                    }
                }
            }

            $batchAttach = trim((string) ($input['batch_id'] ?? ''));
            if ($batchAttach !== '' && $leadRow) {
                $vAttach = leadsValidateBatchForLeadEnrollment($db, $batchAttach, $leadRow, $tokenData);
                if ($vAttach['error']) {
                    throw new RuntimeException($vAttach['error']);
                }
                leadsAttachStudentToBatch($db, $id, $vAttach['course_id'], $batchAttach);
            }

            if ($db->inTransaction()) {
                if (!$db->commit()) {
                    throw new RuntimeException('Database commit failed');
                }
            }
        } catch (Throwable $e) {
            try {
                $db->rollBack();
            } catch (Throwable $ignored) {
            }
            $msg = $e->getMessage();
            if (!is_string($msg) || $msg === '') {
                $msg = 'Unknown error';
            }
            if (stripos($msg, 'updated by someone else') !== false) {
                respond(['error' => $msg], 409);
            }
            if (strlen($msg) > 500) {
                $msg = substr($msg, 0, 500) . '…';
            }
            respond(['error' => 'Lead update failed: ' . $msg], 500);
        }
        if (array_key_exists('assigned_to', $input)) {
            $rawAssign = $input['assigned_to'];
            $assignId = ($rawAssign === null || (is_string($rawAssign) && trim($rawAssign) === ''))
                ? null
                : trim((string) $rawAssign);
            try {
                leadsSetAssignee($db, $id, $assignId);
            } catch (Throwable $e) {
                respond(['error' => 'Lead updated but assignment sync failed: ' . $e->getMessage()], 500);
            }
        }
        leadsRecordStatusChangeActivity(
            $db,
            $tokenData,
            $id,
            (string) $userId,
            $prevStatus,
            (string) ($input['status'] ?? $prevStatus)
        );
        respond(['message' => 'Lead updated']);
    }

    // Only drop students when leaving enrolled — never because an orphan student row exists.
    $clearStudentOnUnenroll = array_key_exists('status', $input)
        && $input['status'] !== 'enrolled'
        && ($prevStatus === 'enrolled' || $prevStatus === 'converted');

    // Optimistic status lock: reject stale concurrent status overwrites.
    $statusLockPrev = null;
    if (array_key_exists('status', $input) && (string) $input['status'] !== $prevStatus) {
        $statusLockPrev = $prevStatus;
    }

    if ($clearStudentOnUnenroll) {
        try {
            $db->beginTransaction();
            $lockLead = $db->prepare('SELECT id, status FROM leads WHERE id = ? FOR UPDATE');
            $lockLead->execute([$id]);
            $locked = $lockLead->fetch(PDO::FETCH_ASSOC);
            if (!$locked) {
                throw new RuntimeException('Lead not found');
            }
            $livePrev = leadsNormalizeStatus((string) ($locked['status'] ?? ''));
            if ($livePrev !== leadsNormalizeStatus($prevStatus)) {
                throw new RuntimeException('Lead was updated by someone else — refresh and try again');
            }
            $execParams = $params;
            $execParams[] = $prevStatus;
            $casStmt = $db->prepare($updateSql . ' AND status = ?');
            $casStmt->execute($execParams);
            if ($casStmt->rowCount() < 1) {
                throw new RuntimeException('Lead was updated by someone else — refresh and try again');
            }
            leadsDropStudentForLead($db, $id);
            if ($db->inTransaction()) {
                if (!$db->commit()) {
                    throw new RuntimeException('Database commit failed');
                }
            }
        } catch (Throwable $e) {
            try {
                $db->rollBack();
            } catch (Throwable $ignored) {
            }
            $msg = $e->getMessage();
            if (!is_string($msg) || $msg === '') {
                $msg = 'Unknown error';
            }
            if (stripos($msg, 'updated by someone else') !== false) {
                respond(['error' => $msg], 409);
            }
            if (strlen($msg) > 500) {
                $msg = substr($msg, 0, 500) . '…';
            }
            respond(['error' => 'Lead update failed: ' . $msg], 500);
        }
        if (array_key_exists('assigned_to', $input)) {
            $rawAssign = $input['assigned_to'];
            $assignId = ($rawAssign === null || (is_string($rawAssign) && trim($rawAssign) === ''))
                ? null
                : trim((string) $rawAssign);
            try {
                leadsSetAssignee($db, $id, $assignId);
            } catch (Throwable $e) {
                respond(['error' => 'Lead updated but assignment sync failed: ' . $e->getMessage()], 500);
            }
        }
        leadsRecordStatusChangeActivity(
            $db,
            $tokenData,
            $id,
            (string) $userId,
            $prevStatus,
            (string) ($input['status'] ?? $prevStatus)
        );
        respond(['message' => 'Lead updated']);
    }

    try {
        if ($statusLockPrev !== null) {
            $rawPrevLock = (string) $statusLockPrev;
            $normPrevLock = leadsNormalizeStatus($rawPrevLock);
            // Truncated ENUM leftovers ('') or unknown legacy values break CAS — update without lock.
            $skipCas = ($rawPrevLock === '' || !in_array($normPrevLock, leadsAllowedStatuses(), true));
            if ($skipCas) {
                $stmt->execute($params);
            } else {
                $paramsWithLock = $params;
                $paramsWithLock[] = $statusLockPrev;
                $lockSql = $updateSql . ' AND status = ?';
                $lockStmt = $db->prepare($lockSql);
                $lockStmt->execute($paramsWithLock);
                if ($lockStmt->rowCount() < 1) {
                    respond(['error' => 'Lead was updated by someone else — refresh and try again'], 409);
                }
            }
        } else {
            $stmt->execute($params);
        }
    } catch (Throwable $e) {
        $msg = $e->getMessage();
        if (!is_string($msg) || $msg === '') {
            $msg = 'Unknown error';
        }
        if (strlen($msg) > 500) {
            $msg = substr($msg, 0, 500) . '…';
        }
        respond(['error' => 'Lead update failed: ' . $msg], 500);
    }

    // Confirm status actually persisted (catches legacy ENUM truncation to '').
    if (array_key_exists('status', $input)) {
        $wantStatus = leadsNormalizeStatus((string) $input['status']);
        $chk = $db->prepare('SELECT status FROM leads WHERE id = ? LIMIT 1');
        $chk->execute([$id]);
        $gotStatus = leadsNormalizeStatus((string) ($chk->fetchColumn() ?: ''));
        if ($gotStatus !== $wantStatus) {
            if (function_exists('ensureLeadsStatusColumn')) {
                ensureLeadsStatusColumn($db, true);
            }
            try {
                $retry = $db->prepare('UPDATE leads SET status = ? WHERE id = ?');
                $retry->execute([$wantStatus, $id]);
                $chk->execute([$id]);
                $gotStatus = leadsNormalizeStatus((string) ($chk->fetchColumn() ?: ''));
            } catch (Throwable $e) {
                respond([
                    'error' => 'Status could not be saved. Ask an admin to update leads.status to allow not_answered/messaged.',
                    'detail' => $e->getMessage(),
                ], 500);
            }
            if ($gotStatus !== $wantStatus) {
                respond([
                    'error' => 'Status could not be saved. The database status column does not accept "' . $wantStatus . '".',
                ], 500);
            }
        }
    }

    // Record who changed status (mobile: status_changed=yesterday|last_7_days|this_month).
    if (array_key_exists('status', $input)) {
        leadsRecordStatusChangeActivity(
            $db,
            $tokenData,
            $id,
            (string) $userId,
            $prevStatus,
            (string) $input['status']
        );
    }

    // Keep lead_assignments in sync with primary assigned_to.
    if (array_key_exists('assigned_to', $input)) {
        $rawAssign = $input['assigned_to'];
        $assignId = ($rawAssign === null || (is_string($rawAssign) && trim($rawAssign) === ''))
            ? null
            : trim((string) $rawAssign);
        try {
            leadsSetAssignee($db, $id, $assignId);
        } catch (Throwable $e) {
            respond(['error' => 'Lead updated but assignment sync failed: ' . $e->getMessage()], 500);
        }
    }

    respond(['message' => 'Lead updated']);
}

if ($method === 'DELETE' && ($_GET['action'] ?? '') === 'bulk') {
    // Legacy alias — prefer POST ?action=bulk_delete (DELETE body often empty on shared hosting)
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $ids = $input['ids'] ?? null;
    if (!is_array($ids) || $ids === []) {
        respond(['error' => 'ids array required — use POST /leads.php?action=bulk_delete with JSON {"ids":[...]}'], 400);
    }
    $ids = array_values(array_unique(array_filter(array_map(static function ($id) {
        return is_string($id) || is_numeric($id) ? trim((string) $id) : '';
    }, $ids), static fn ($id) => $id !== '')));
    if ($ids === []) {
        respond(['error' => 'ids array required'], 400);
    }
    if (count($ids) > 5000) {
        respond(['error' => 'Cannot delete more than 5000 leads at once'], 400);
    }

    @set_time_limit(300);
    $deleted = 0;
    $skipped = 0;
    $del = $db->prepare('DELETE FROM leads WHERE id = ?');
    foreach (array_chunk($ids, 200) as $chunk) {
        $placeholders = implode(',', array_fill(0, count($chunk), '?'));
        $sel = $db->prepare("SELECT * FROM leads WHERE id IN ($placeholders)");
        $sel->execute($chunk);
        $found = [];
        while ($lead = $sel->fetch(PDO::FETCH_ASSOC)) {
            $found[(string) $lead['id']] = $lead;
        }
        foreach ($chunk as $id) {
            $lead = $found[$id] ?? null;
            if (!$lead) {
                $skipped++;
                continue;
            }
            if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
                $skipped++;
                continue;
            }
            try {
                trashArchiveRow($db, 'lead', 'leads', $id, $tokenData);
            } catch (RuntimeException $e) {
                respond([
                    'error' => 'Could not archive to trash — delete aborted',
                    'deleted' => $deleted,
                    'skipped' => $skipped,
                    'detail' => $e->getMessage(),
                ], 500);
            }
            $del->execute([$id]);
            $deleted++;
        }
    }
    syncpediaAuditLog($db, $tokenData, 'deleted', 'lead', null, "Bulk deleted {$deleted} lead(s), skipped {$skipped}");
    respond(['message' => 'Bulk delete complete', 'deleted' => $deleted, 'skipped' => $skipped]);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $stmt = $db->prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $lead = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$lead) {
        respond(['error' => 'Lead not found'], 404);
    }
    if (!userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
        respond(['error' => 'Forbidden'], 403);
    }

    try {
        trashArchiveRow($db, 'lead', 'leads', $id, $tokenData);
    } catch (RuntimeException $e) {
        respond(['error' => 'Could not archive to trash — delete aborted', 'detail' => $e->getMessage()], 500);
    }
    $stmt = $db->prepare("DELETE FROM leads WHERE id = ?");
    $stmt->execute([$id]);
    syncpediaAuditLog($db, $tokenData, 'deleted', 'lead', $id, 'Deleted lead: ' . ($lead['name'] ?? $id));
    respond(['message' => 'Lead deleted']);
}

respond(['error' => 'Method not allowed'], 405);
