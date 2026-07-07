<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $where = '1=1';
    $params = [];

    if (!empty($_GET['search'])) {
        $where .= ' AND (s.name LIKE ? OR s.email LIKE ? OR s.phone LIKE ? OR l.college LIKE ? OR l.course_interest LIKE ? OR o.name LIKE ? OR l.name LIKE ? OR l2.college LIKE ? OR l2.course_interest LIKE ? OR l2.name LIKE ? OR c.name LIKE ? OR b.name LIKE ?)';
        $s = '%' . $_GET['search'] . '%';
        $params = array_merge($params, array_fill(0, 12, $s));
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

    $stmt = $db->prepare("
        SELECT s.*,
            c.name AS course_name,
            b.name AS batch_name,
            COALESCE(l.id, l2.id) AS source_lead_id,
            COALESCE(l.name, l2.name) AS lead_contact_name,
            COALESCE(l.source, l2.source) AS lead_source,
            COALESCE(l.course_interest, l2.course_interest) AS lead_course_interest,
            COALESCE(l.company, l2.company) AS lead_company,
            COALESCE(l.notes, l2.notes) AS lead_notes,
            COALESCE(l.status, l2.status) AS lead_status,
            COALESCE(l.tags, l2.tags) AS lead_tags,
            COALESCE(l.referred_by, l2.referred_by) AS lead_referred_by,
            COALESCE(l.phone, l2.phone) AS lead_phone,
            COALESCE(l.college, l2.college) AS lead_college,
            COALESCE(l.email, l2.email) AS lead_email,
            o.name AS organization_name,
            o.slug AS organization_slug
        FROM students s
        LEFT JOIN leads l ON l.id = s.lead_id
        LEFT JOIN leads l2 ON (
            (s.lead_id IS NULL OR l.id IS NULL)
            AND s.email IS NOT NULL AND TRIM(s.email) <> ''
            AND l2.id = (
                SELECT le.id FROM leads le
                WHERE le.email = s.email AND TRIM(le.email) <> ''
                AND (s.org_id IS NULL OR TRIM(s.org_id) = '' OR le.org_id = s.org_id)
                ORDER BY le.created_at DESC
                LIMIT 1
            )
        )
        LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, l.org_id, l2.org_id)
        LEFT JOIN courses c ON s.course_id = c.id
        LEFT JOIN batches b ON s.batch_id = b.id
        WHERE $where
        ORDER BY s.created_at DESC
        LIMIT 500
    ");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
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
    respond(['data' => $rows]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org']);
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveCreatorOrgId($db, $tokenData);

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

    $params[] = $id;
    $stmt = $db->prepare("UPDATE students SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Student updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
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

    trashArchiveRow($db, 'student', 'students', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM students WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Student deleted']);
}
