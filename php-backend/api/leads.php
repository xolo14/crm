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
$org = orgFilterLeadsTenant($db, $tokenData);

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
    $cntSt = $db->prepare('SELECT COUNT(*) FROM students WHERE batch_id = ?');
    $cntSt->execute([$bid]);
    $enrolled = (int) $cntSt->fetchColumn();
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
    $effRole = syncpediaNormalizeRoleKey((string) $role);
    $where = $org['where'];
    $params = $org['params'];
    $debug = !empty($_GET['debug']) && $_GET['debug'] !== '0' && $_GET['debug'] !== 'false';
    $debugMeta = [];

    // Super admin should always see all leads in Leads module.
    if ($effRole === 'super_admin') {
        $where = '1=1';
        $params = [];
    }

    // L3 admin/org: full tenant roster from orgFilter above (no hierarchy cap).
    // L2 manager: assigned team + referrals only.
    if ($effRole === 'manager') {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        if ($debug) {
            $debugMeta['visible_user_ids_count'] = count($visibleIds);
            $debugMeta['visible_user_ids_sample'] = array_slice($visibleIds, 0, 15);
        }
        $scope = hierarchyLeadDownlineScopeSql($visibleIds);
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    }

    // L1 field roles: assigned, referral-link, or self-created leads only.
    if (hierarchyRoleUsesL1OwnLeadsScope($tokenData)) {
        $scope = hierarchyL1OwnLeadsScopeSql($tokenData);
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    }

    if (!empty($_GET['status']) && $_GET['status'] !== 'all') {
        $where .= " AND status = ?";
        $params[] = $_GET['status'];
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

    $stmt = $db->prepare("SELECT * FROM leads WHERE $where ORDER BY created_at DESC LIMIT 500");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll(), 'count' => $stmt->rowCount()]);
}

if ($method === 'POST') {
    ensureLeadsResumeColumn($db);
    $input = getInput();

    if (($_GET['action'] ?? '') === 'bulk') {
        $rows = $input['leads'] ?? $input;
        if (!is_array($rows) || $rows === []) {
            respond(['error' => 'Expected non-empty leads array'], 400);
        }
        $created = 0;
        $errors = [];
        foreach ($rows as $i => $row) {
            if (!is_array($row)) {
                continue;
            }
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                $errors[] = "Row $i: name is required";
                continue;
            }
            $id = generateUUID();
            $referredBy = trim((string) ($row['referred_by'] ?? ''));
            $referredBy = $referredBy !== '' ? $referredBy : null;
            $assignedTo = $row['assigned_to'] ?? null;
            if ($assignedTo !== null && trim((string) $assignedTo) === '') {
                $assignedTo = null;
            }
            $orgId = resolveCreatorOrgId($db, $tokenData);
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
            try {
                $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $id,
                    $name,
                    $row['email'] ?? null,
                    $row['phone'] ?? null,
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
                    $row['status'] ?? 'new',
                ]);
                $created++;
            } catch (Throwable $e) {
                $errors[] = "Row $i: " . $e->getMessage();
            }
        }
        respond(['message' => "Imported $created lead(s)", 'created' => $created, 'errors' => $errors], $created > 0 ? 201 : 400);
    }

    $id = generateUUID();
    $name = trim($input['name'] ?? '');
    if (!$name) respond(['error' => 'Name is required'], 400);

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
    // Sales rep UI does not show "Assign to" — leads must be assigned to self or they disappear from GET (assigned_to / referred_by filter).
    if (in_array($role, ['sales_representative'], true) && ($assignedTo === null || $assignedTo === '')) {
        $assignedTo = $userId;
    }

    $referredBy = trim((string) ($input['referred_by'] ?? ''));
    $referredBy = $referredBy !== '' ? $referredBy : null;
    // Manual rep entries: stamp referral attribution like form/referral leads (My Leads / analytics).
    if (in_array($role, ['sales_representative'], true) && ($referredBy === null || $referredBy === '')) {
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

    try {
        $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, resume_path, assigned_to, tags, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
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
            $resumePathIn,
            $assignedTo,
            json_encode($input['tags'] ?? []),
            $orgId,
        ]);
        respond(['id' => $id, 'message' => 'Lead created'], 201);
    } catch (Exception $e) {
        try {
            // Backward-compatible fallback for older lead schemas (no resume_path).
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
                json_encode($input['tags'] ?? []),
                $orgId,
            ]);
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

    $allowedStatus = ['new', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'];
    if (array_key_exists('status', $input) && !in_array($input['status'], $allowedStatus, true)) {
        respond(['error' => 'Invalid status'], 400);
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
        try {
            $db->beginTransaction();
            $stmt->execute($params);

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
            if (strlen($msg) > 500) {
                $msg = substr($msg, 0, 500) . '…';
            }
            respond(['error' => 'Lead update failed: ' . $msg], 500);
        }
        respond(['message' => 'Lead updated']);
    }

    $clearStudentOnUnenroll = array_key_exists('status', $input)
        && $prevStatus === 'enrolled'
        && $input['status'] !== 'enrolled';

    if ($clearStudentOnUnenroll) {
        try {
            $db->beginTransaction();
            $stmt->execute($params);
            try {
                $stuSnap = $db->prepare('SELECT * FROM students WHERE lead_id = ?');
                $stuSnap->execute([$id]);
                while ($sr = $stuSnap->fetch(PDO::FETCH_ASSOC)) {
                    trashArchivePayload($db, 'student', $sr, $tokenData);
                }
                $delStu = $db->prepare('DELETE FROM students WHERE lead_id = ?');
                $delStu->execute([$id]);
            } catch (Throwable $delErr) {
                try {
                    $unlink = $db->prepare("UPDATE students SET lead_id = NULL, status = 'dropped' WHERE lead_id = ?");
                    $unlink->execute([$id]);
                } catch (Throwable $ignored) {
                    throw $delErr;
                }
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
            if (strlen($msg) > 500) {
                $msg = substr($msg, 0, 500) . '…';
            }
            respond(['error' => 'Lead update failed: ' . $msg], 500);
        }
        respond(['message' => 'Lead updated']);
    }

    try {
        $stmt->execute($params);
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

    respond(['message' => 'Lead updated']);
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

    trashArchiveRow($db, 'lead', 'leads', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM leads WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Lead deleted']);
}

respond(['error' => 'Method not allowed'], 405);
