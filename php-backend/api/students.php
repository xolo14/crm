<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/PaymentCandidates.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

function studentsMarkLinkedEnrolledLeadLost(PDO $db, array $studentRow): void
{
    $leadId = trim((string) ($studentRow['lead_id'] ?? ''));
    if ($leadId === '') {
        return;
    }
    $db->prepare(
        "UPDATE leads SET status = 'lost', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND LOWER(TRIM(COALESCE(status, ''))) = 'enrolled'",
    )->execute([$leadId]);
}

if ($method === 'GET') {
    ensureStudentsEnrolledByColumn($db);
    $where = '1=1';
    $params = [];

    if (!empty($_GET['search'])) {
        $where .= ' AND (s.name LIKE ? OR s.email LIKE ? OR s.phone LIKE ? OR l.college LIKE ? OR l.course_interest LIKE ? OR o.name LIKE ? OR l.name LIKE ? OR c.name LIKE ? OR b.name LIKE ? OR au.full_name LIKE ?)';
        $s = '%' . $_GET['search'] . '%';
        $params = array_merge($params, array_fill(0, 10, $s));
    }

    if (!empty($_GET['status']) && $_GET['status'] !== 'all') {
        $where .= ' AND s.status = ?';
        $params[] = $_GET['status'];
    }

    // Tenant + hierarchy scope
    $scope = tenantStudentListScopeSql($db, $tokenData);
    $where .= $scope['sql'];
    $params = array_merge($params, $scope['params']);

    $orgId = tenantListOrgId($db, $tokenData);

    // Slim list: no correlated email→lead subquery (O(n) dependent lookups hang large orgs).
    // lead_id join only; payment summaries are batched in studentsAttachPaymentSummaries.
    $stmt = $db->prepare("
        SELECT s.id, s.name, s.email, s.phone, s.college, s.year_of_study, s.course_id, s.batch_id,
            s.org_id, s.status, s.enrollment_date, s.lead_id, s.enrolled_by, s.created_at, s.updated_at,
            c.name AS course_name,
            b.name AS batch_name,
            l.id AS source_lead_id,
            l.name AS lead_contact_name,
            l.source AS lead_source,
            l.course_interest AS lead_course_interest,
            l.company AS lead_company,
            LEFT(COALESCE(l.notes, ''), 2000) AS lead_notes,
            l.status AS lead_status,
            l.tags AS lead_tags,
            l.referred_by AS lead_referred_by,
            l.phone AS lead_phone,
            l.college AS lead_college,
            l.email AS lead_email,
            l.assigned_to AS lead_assigned_to,
            COALESCE(s.enrolled_by, l.assigned_to) AS enrolled_by_id,
            COALESCE(NULLIF(TRIM(eu.full_name), ''), NULLIF(TRIM(au.full_name), '')) AS enrolled_by_name,
            o.name AS organization_name,
            o.slug AS organization_slug
        FROM students s
        LEFT JOIN leads l ON l.id = s.lead_id
        LEFT JOIN users eu ON eu.id = s.enrolled_by
        LEFT JOIN users au ON au.id = l.assigned_to
        LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, l.org_id)
        LEFT JOIN courses c ON s.course_id = c.id
        LEFT JOIN batches b ON s.batch_id = b.id
        WHERE $where
        ORDER BY s.created_at DESC
        LIMIT 500
    ");
    try {
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (Throwable $e) {
        // Older schemas may lack enrolled_by / updated_at.
        error_log('students list slim: ' . $e->getMessage());
        $stmt = $db->prepare("
            SELECT s.id, s.name, s.email, s.phone, s.college, s.year_of_study, s.course_id, s.batch_id,
                s.org_id, s.status, s.enrollment_date, s.lead_id, s.created_at,
                c.name AS course_name,
                b.name AS batch_name,
                l.id AS source_lead_id,
                l.name AS lead_contact_name,
                l.source AS lead_source,
                l.course_interest AS lead_course_interest,
                l.company AS lead_company,
                LEFT(COALESCE(l.notes, ''), 2000) AS lead_notes,
                l.status AS lead_status,
                l.tags AS lead_tags,
                l.referred_by AS lead_referred_by,
                l.phone AS lead_phone,
                l.college AS lead_college,
                l.email AS lead_email,
                l.assigned_to AS lead_assigned_to,
                l.assigned_to AS enrolled_by_id,
                NULLIF(TRIM(au.full_name), '') AS enrolled_by_name,
                o.name AS organization_name,
                o.slug AS organization_slug
            FROM students s
            LEFT JOIN leads l ON l.id = s.lead_id
            LEFT JOIN users au ON au.id = l.assigned_to
            LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, l.org_id)
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN batches b ON s.batch_id = b.id
            WHERE $where
            ORDER BY s.created_at DESC
            LIMIT 500
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    }
    $tenantOrgLabel = '';
    if ($orgId) {
        $on = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $on->execute([$orgId]);
        $tenantOrgLabel = (string) ($on->fetchColumn() ?: '');
    }
    foreach ($rows as &$row) {
        if (($row['organization_name'] ?? '') === '' && $tenantOrgLabel !== '') {
            $row['organization_name'] = $tenantOrgLabel;
        }
    }
    unset($row);
    studentsAttachPaymentSummaries($db, $rows);
    respond(['data' => $rows]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org']);
    ensureStudentsEnrolledByColumn($db);
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $enrolledBy = trim((string) ($tokenData['user_id'] ?? ''));
    if ($enrolledBy === '') {
        $enrolledBy = null;
    }

    if ($enrolledBy !== null && syncpediaColumnExists($db, 'students', 'enrolled_by')) {
        $stmt = $db->prepare("INSERT INTO students (id, name, email, phone, college, year_of_study, course_id, batch_id, org_id, status, enrollment_date, enrolled_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'],
            $input['email'],
            $input['phone'] ?? null,
            $input['college'] ?? null,
            $input['year_of_study'] ?? null,
            $input['course_id'] ?? null,
            $input['batch_id'] ?? null,
            $orgId,
            $input['status'] ?? 'active',
            $input['enrollment_date'] ?? date('Y-m-d'),
            $enrolledBy,
        ]);
    } else {
        $stmt = $db->prepare("INSERT INTO students (id, name, email, phone, college, year_of_study, course_id, batch_id, org_id, status, enrollment_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'],
            $input['email'],
            $input['phone'] ?? null,
            $input['college'] ?? null,
            $input['year_of_study'] ?? null,
            $input['course_id'] ?? null,
            $input['batch_id'] ?? null,
            $orgId,
            $input['status'] ?? 'active',
            $input['enrollment_date'] ?? date('Y-m-d'),
        ]);
    }
    respond(['id' => $id, 'message' => 'Student enrolled'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org']);
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    $existing = $db->prepare('SELECT * FROM students WHERE id = ? LIMIT 1');
    $existing->execute([$id]);
    $studentRow = $existing->fetch(PDO::FETCH_ASSOC);
    if (!$studentRow) {
        respond(['error' => 'Student not found'], 404);
    }
    if (!userCanAccessStudentRow($db, $tokenData, $userId, $role, $studentRow)) {
        respond(['error' => 'Forbidden'], 403);
    }

    $fields = [];
    $params = [];
    foreach (['name', 'email', 'phone', 'college', 'year_of_study', 'course_id', 'batch_id', 'status', 'mentor_id'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $isDropped = array_key_exists('status', $input)
        && strtolower(trim((string) $input['status'])) === 'dropped';
    $db->beginTransaction();
    try {
        $params[] = $id;
        $stmt = $db->prepare("UPDATE students SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);
        if ($isDropped) {
            studentsMarkLinkedEnrolledLeadLost($db, $studentRow);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Could not update student', 'detail' => $e->getMessage()], 500);
    }
    respond(['message' => 'Student updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager']);
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') respond(['error' => 'ID required'], 400);

    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    $existing = $db->prepare('SELECT * FROM students WHERE id = ? LIMIT 1');
    $existing->execute([$id]);
    $studentRow = $existing->fetch(PDO::FETCH_ASSOC);
    if (!$studentRow) {
        respond(['error' => 'Student not found'], 404);
    }
    if (!userCanAccessStudentRow($db, $tokenData, $userId, $role, $studentRow)) {
        respond(['error' => 'Forbidden'], 403);
    }

    $db->beginTransaction();
    try {
        trashArchiveRow($db, 'student', 'students', $id, $tokenData);
        studentsMarkLinkedEnrolledLeadLost($db, $studentRow);
        // Clear dependents first (live DBs may lack ON DELETE CASCADE on payments).
        try {
            $db->prepare('DELETE FROM payments WHERE student_id = ?')->execute([$id]);
        } catch (Throwable $ignored) {
            /* payments table / column may differ on older schemas */
        }
        $stmt = $db->prepare('DELETE FROM students WHERE id = ?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() < 1) {
            throw new RuntimeException('Student row was not deleted');
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Could not delete student', 'detail' => $e->getMessage()], 500);
    }
    respond(['message' => 'Student deleted']);
}
