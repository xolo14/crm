<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Super admin should see all batches unless an explicit org_id filter is requested.
    $effectiveToken = $tokenData;
    if (($tokenData['role'] ?? '') === 'super_admin' && empty($_GET['org_id'])) {
        $effectiveToken['org_id'] = null;
    }
    $rawOrg = getOrgId($effectiveToken);
    $orgIdFilter = (is_string($rawOrg) && trim($rawOrg) !== '') ? trim($rawOrg) : '';
    try {
        if ($orgIdFilter !== '') {
            // Batches in this org OR batches for courses owned by this org (legacy NULL batch.org_id).
            $stmt = $db->prepare("
                SELECT b.*, c.name as course_name, c.price as course_price,
                (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as enrolled
                FROM batches b
                LEFT JOIN courses c ON b.course_id = c.id
                WHERE (b.org_id = ? OR c.org_id = ?)
                ORDER BY b.created_at DESC
            ");
            $stmt->execute([$orgIdFilter, $orgIdFilter]);
        } else {
            $org = orgFilter($effectiveToken, 'b');
            $stmt = $db->prepare("
                SELECT b.*, c.name as course_name, c.price as course_price,
                (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as enrolled
                FROM batches b
                LEFT JOIN courses c ON b.course_id = c.id
                WHERE {$org['where']}
                ORDER BY b.created_at DESC
            ");
            $stmt->execute($org['params']);
        }
    } catch (Throwable $e) {
        $stmt = $db->prepare("
            SELECT b.*, c.name as course_name, c.price as course_price,
            (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as enrolled
            FROM batches b
            LEFT JOIN courses c ON b.course_id = c.id
            ORDER BY b.created_at DESC
        ");
        $stmt->execute();
    }
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    batchesSyncScheduleStatus($db, $rows);
    $rows = batchesFilterViewerSchedule($tokenData, $rows);
    respond(['data' => $rows]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin']);
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);
    if (($orgId === null || $orgId === '') && !empty($input['course_id'])) {
        $cst = $db->prepare('SELECT org_id FROM courses WHERE id = ? LIMIT 1');
        $cst->execute([$input['course_id']]);
        $courseOrg = $cst->fetchColumn();
        if ($courseOrg !== false && trim((string) $courseOrg) !== '') {
            $orgId = (string) $courseOrg;
        }
    }

    $startDate = $input['start_date'] ?? null;
    $endDate = $input['end_date'] ?? null;
    $status = batchScheduleStatus($startDate, $endDate);

    try {
        $stmt = $db->prepare("INSERT INTO batches (id, name, course_id, start_date, end_date, seat_limit, status, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'],
            $input['course_id'] ?? null,
            $startDate,
            $endDate,
            $input['seat_limit'] ?? 30,
            $status,
            $orgId,
        ]);
    } catch (Throwable $e) {
        // Backward compatibility for older schemas without org_id.
        if (stripos($e->getMessage(), 'Unknown column') !== false && stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare("INSERT INTO batches (id, name, course_id, start_date, end_date, seat_limit, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $input['name'],
                $input['course_id'] ?? null,
                $startDate,
                $endDate,
                $input['seat_limit'] ?? 30,
                $status,
            ]);
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Batch created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin']);
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $cur = $db->prepare('SELECT start_date, end_date FROM batches WHERE id = ? LIMIT 1');
    $cur->execute([$id]);
    $existing = $cur->fetch(PDO::FETCH_ASSOC);
    if (!$existing) {
        respond(['error' => 'Batch not found'], 404);
    }

    $startDate = array_key_exists('start_date', $input) ? $input['start_date'] : $existing['start_date'];
    $endDate = array_key_exists('end_date', $input) ? $input['end_date'] : $existing['end_date'];
    $input['status'] = batchScheduleStatus($startDate, $endDate);

    $fields = [];
    $params = [];
    foreach (['name', 'course_id', 'start_date', 'end_date', 'seat_limit', 'status', 'trainer_id'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE batches SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Batch updated', 'status' => $input['status']]);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    trashArchiveRow($db, 'batch', 'batches', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM batches WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Batch deleted']);
}
