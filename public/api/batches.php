<?php

require_once __DIR__ . '/helpers.php';

cors();



$db = (new Database())->getConnection();

$tokenData = verifyToken();

$method = $_SERVER['REQUEST_METHOD'];



if ($method === 'GET') {

 try {

 $catalog = tenantBatchCatalogWhere($db, $tokenData, 'b', 'c');

 $stmt = $db->prepare("

 SELECT b.*, c.name as course_name, c.price as course_price,

 (SELECT COUNT(*) FROM students s
 WHERE s.batch_id = b.id
 AND s.lead_id IS NOT NULL AND TRIM(s.lead_id) <> ''
 AND LOWER(TRIM(COALESCE(s.status, 'active'))) NOT IN ('dropped', 'inactive', 'deleted')
 ) as enrolled

 FROM batches b

 LEFT JOIN courses c ON b.course_id = c.id

 WHERE {$catalog['where']}

 ORDER BY b.created_at DESC

 ");

 $stmt->execute($catalog['params']);

 } catch (Throwable $e) {

 respond(['error' => 'Could not load batches'], 500);

 }

 $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

 batchesSyncScheduleStatus($db, $rows);

 $rows = batchesFilterViewerSchedule($tokenData, $rows);

 respond(['data' => $rows]);

}



if ($method === 'POST' && ($_GET['action'] ?? '') === 'bulk') {

 requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org', 'operational_manager']);

 $input = getInput();

 $rows = $input['batches'] ?? $input;

 if (!is_array($rows) || $rows === []) {

 respond(['error' => 'Expected non-empty batches array'], 400);

 }

 $callerRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

 $bulkOrgId = resolveCreatorOrgId($db, $tokenData);

 $explicitOrg = trim((string) ($input['org_id'] ?? ''));

 if ($callerRole === 'super_admin') {

 if ($explicitOrg === '') {

 foreach ($rows as $probe) {

 if (is_array($probe)) {

 $explicitOrg = trim((string) ($probe['org_id'] ?? ''));

 if ($explicitOrg !== '') break;

 }

 }

 }

 if ($explicitOrg === '') {

 respond(['error' => 'Select an organization for this import (org_id is required for Super Admin)'], 400);

 }

 $chk = $db->prepare('SELECT id FROM organizations WHERE id = ? AND is_active = 1 LIMIT 1');

 $chk->execute([$explicitOrg]);

 if (!$chk->fetch()) {

 respond(['error' => 'Organization not found'], 404);

 }

 $bulkOrgId = $explicitOrg;

 }

 $created = 0;

 $skipped = 0;

 $errors = [];

 $seenNames = [];

 try {

 $db->beginTransaction();

 foreach ($rows as $i => $row) {

 if (!is_array($row)) { $skipped++; continue; }

 $name = trim((string) ($row['name'] ?? ''));

 if ($name === '') {

 $skipped++;

 $errors[] = "Row " . ($i + 1) . ": name is required";

 continue;

 }

 $nameKey = strtolower($name);

 if (isset($seenNames[$nameKey])) {

 $skipped++;

 $errors[] = "Row " . ($i + 1) . ": duplicate name in this import ({$name})";

 continue;

 }

 $seenNames[$nameKey] = true;

 $id = generateUUID();

 $courseId = !empty($row['course_id']) ? $row['course_id'] : null;

 $startDate = batchParseScheduleDate($row['start_date'] ?? null)?->format('Y-m-d');

 $endDate = batchParseScheduleDate($row['end_date'] ?? null)?->format('Y-m-d');

 $status = batchScheduleStatus($startDate, $endDate);

 $seatLimit = isset($row['seat_limit']) ? (int) $row['seat_limit'] : 30;

 $resolvedOrgId = $bulkOrgId;

 if ($courseId && empty($resolvedOrgId)) {

 $cst = $db->prepare('SELECT org_id FROM courses WHERE id = ? LIMIT 1');

 $cst->execute([$courseId]);

 $courseOrg = $cst->fetchColumn();

 if ($courseOrg !== false && trim((string) $courseOrg) !== '') {

 $resolvedOrgId = (string) $courseOrg;

 }

 }

 $stmt = $db->prepare("INSERT INTO batches (id, name, course_id, start_date, end_date, seat_limit, status, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

 $stmt->execute([

 $id,

 $name,

 $courseId,

 $startDate,

 $endDate,

 $seatLimit,

 $status,

 $resolvedOrgId,

 ]);

 $created++;

 }

 $db->commit();

 } catch (Throwable $e) {

 $db->rollBack();

 respond(['error' => 'Bulk import failed: ' . $e->getMessage()], 500);

 }

 respond([

 'message' => 'Import complete',

 'created' => $created,

 'skipped' => $skipped,

 'errors' => $errors,

 ]);

}



if ($method === 'POST') {

 requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org', 'operational_manager']);

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

 $startDate = batchParseScheduleDate($startDate !== null ? (string) $startDate : null)?->format('Y-m-d');

 $endDate = batchParseScheduleDate($endDate !== null ? (string) $endDate : null)?->format('Y-m-d');

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

 requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org', 'operational_manager']);

 $input = getInput();

 $id = $_GET['id'] ?? '';

 if (!$id) respond(['error' => 'ID required'], 400);



 $catalog = tenantBatchCatalogWhere($db, $tokenData, 'b', 'c');

 $cur = $db->prepare("SELECT b.start_date, b.end_date FROM batches b LEFT JOIN courses c ON b.course_id = c.id WHERE b.id = ? AND ({$catalog['where']}) LIMIT 1");

 $cur->execute(array_merge([$id], $catalog['params']));

 $existing = $cur->fetch(PDO::FETCH_ASSOC);

 if (!$existing) {

 respond(['error' => 'Batch not found'], 404);

 }



 $startDate = array_key_exists('start_date', $input) ? $input['start_date'] : $existing['start_date'];

 $endDate = array_key_exists('end_date', $input) ? $input['end_date'] : $existing['end_date'];

 $startDate = batchParseScheduleDate($startDate !== null ? (string) $startDate : null)?->format('Y-m-d');

 $endDate = batchParseScheduleDate($endDate !== null ? (string) $endDate : null)?->format('Y-m-d');

 if (array_key_exists('start_date', $input)) {

 $input['start_date'] = $startDate;

 }

 if (array_key_exists('end_date', $input)) {

 $input['end_date'] = $endDate;

 }

 $input['status'] = batchScheduleStatus($startDate, $endDate);



 $fields = [];

 $params = [];

 foreach (['name', 'course_id', 'start_date', 'end_date', 'seat_limit', 'status', 'trainer_id'] as $f) {

 if (array_key_exists($f, $input)) {

 $fields[] = "b.$f = ?";

 $params[] = $input[$f];

 }

 }

 if (empty($fields)) respond(['error' => 'Nothing to update'], 400);



 $params[] = $id;

 $stmt = $db->prepare("UPDATE batches b LEFT JOIN courses c ON b.course_id = c.id SET " . implode(', ', $fields) . " WHERE b.id = ? AND ({$catalog['where']})");

 $stmt->execute(array_merge($params, $catalog['params']));

 respond(['message' => 'Batch updated', 'status' => $input['status']]);

}



if ($method === 'DELETE') {

 requireRole($tokenData, ['admin', 'super_admin', 'org']);

 $id = $_GET['id'] ?? '';

 if (!$id) respond(['error' => 'ID required'], 400);



 $catalog = tenantBatchCatalogWhere($db, $tokenData, 'b', 'c');

 $chk = $db->prepare("SELECT b.id FROM batches b LEFT JOIN courses c ON b.course_id = c.id WHERE b.id = ? AND ({$catalog['where']}) LIMIT 1");

 $chk->execute(array_merge([$id], $catalog['params']));

 if (!$chk->fetch()) {

 respond(['error' => 'Batch not found'], 404);

 }



 trashArchiveRow($db, 'batch', 'batches', $id, $tokenData);

 $stmt = $db->prepare("DELETE FROM batches WHERE id = ?");

 $stmt->execute([$id]);

 respond(['message' => 'Batch deleted']);

}



respond(['error' => 'Method not allowed'], 405);


