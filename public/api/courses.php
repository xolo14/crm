<?php

require_once __DIR__ . '/helpers.php';

cors();



$db = (new Database())->getConnection();

$tokenData = verifyToken();

$method = $_SERVER['REQUEST_METHOD'];



if ($method === 'GET') {

 try {

 $catalog = tenantCourseCatalogWhere($db, $tokenData, 'c');

 $stmt = $db->prepare("

 SELECT DISTINCT c.*

 FROM courses c

 WHERE {$catalog['where']}

 ORDER BY c.created_at DESC

 ");

 $stmt->execute($catalog['params']);

 $courses = $stmt->fetchAll();

 } catch (Throwable $e) {

 respond(['error' => 'Could not load courses'], 500);

 }

 foreach ($courses as &$c) {

 $c['modules'] = json_decode($c['modules'] ?? '[]', true);

 $c['is_active'] = (bool)$c['is_active'];

 }

 respond(['data' => $courses]);

}



if ($method === 'POST' && ($_GET['action'] ?? '') === 'bulk') {

 requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org', 'operational_manager']);

 $input = getInput();

 $rows = $input['courses'] ?? $input;

 if (!is_array($rows) || $rows === []) {

 respond(['error' => 'Expected non-empty courses array'], 400);

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

 $modules = is_array($row['modules'] ?? null) ? $row['modules'] : (is_string($row['modules'] ?? null) ? json_decode($row['modules'], true) : []);

 if (!is_array($modules)) $modules = [];

 $stmt = $db->prepare("INSERT INTO courses (id, name, description, price, duration_weeks, modules, is_active, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

 $stmt->execute([

 $id,

 $name,

 $row['description'] ?? null,

 isset($row['price']) ? (float) $row['price'] : 0,

 isset($row['duration_weeks']) ? (int) $row['duration_weeks'] : null,

 json_encode($modules),

 isset($row['is_active']) ? (int) $row['is_active'] : 1,

 $bulkOrgId,

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



 try {

 $stmt = $db->prepare("INSERT INTO courses (id, name, description, price, duration_weeks, modules, is_active, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

 $stmt->execute([

 $id,

 $input['name'],

 $input['description'] ?? null,

 $input['price'] ?? 0,

 $input['duration_weeks'] ?? null,

 json_encode($input['modules'] ?? []),

 $input['is_active'] ?? 1,

 $orgId,

 ]);

 } catch (Throwable $e) {

 if (stripos($e->getMessage(), 'Unknown column') !== false && stripos($e->getMessage(), 'org_id') !== false) {

 $stmt = $db->prepare("INSERT INTO courses (id, name, description, price, duration_weeks, modules, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)");

 $stmt->execute([

 $id,

 $input['name'],

 $input['description'] ?? null,

 $input['price'] ?? 0,

 $input['duration_weeks'] ?? null,

 json_encode($input['modules'] ?? []),

 $input['is_active'] ?? 1,

 ]);

 } else {

 throw $e;

 }

 }

 respond(['id' => $id, 'message' => 'Course created'], 201);

}



if ($method === 'PUT') {

 requireRole($tokenData, ['admin', 'manager', 'super_admin', 'org', 'operational_manager']);

 $input = getInput();

 $id = $_GET['id'] ?? '';

 if (!$id) respond(['error' => 'ID required'], 400);



 $fields = [];

 $params = [];

 foreach (['name', 'description', 'price', 'duration_weeks', 'is_active'] as $f) {

 if (array_key_exists($f, $input)) {

 $fields[] = "$f = ?";

 $params[] = $input[$f];

 }

 }

 if (array_key_exists('modules', $input)) {

 $fields[] = "modules = ?";

 $params[] = json_encode($input['modules']);

 }

 if (empty($fields)) respond(['error' => 'Nothing to update'], 400);



 $catalog = tenantCourseCatalogWhere($db, $tokenData, 'c');

 $params[] = $id;

 $stmt = $db->prepare("UPDATE courses c SET " . implode(', ', $fields) . " WHERE c.id = ? AND ({$catalog['where']})");

 $stmt->execute(array_merge($params, $catalog['params']));

 if ($stmt->rowCount() === 0) {

 respond(['error' => 'Course not found'], 404);

 }

 respond(['message' => 'Course updated']);

}



if ($method === 'DELETE') {

 requireRole($tokenData, ['admin', 'super_admin', 'org']);

 $id = $_GET['id'] ?? '';

 if (!$id) respond(['error' => 'ID required'], 400);



 $catalog = tenantCourseCatalogWhere($db, $tokenData, 'c');

 $chk = $db->prepare("SELECT c.id FROM courses c WHERE c.id = ? AND ({$catalog['where']}) LIMIT 1");

 $chk->execute(array_merge([$id], $catalog['params']));

 if (!$chk->fetch()) {

 respond(['error' => 'Course not found'], 404);

 }



 trashArchiveRow($db, 'course', 'courses', $id, $tokenData);

 $stmt = $db->prepare("DELETE FROM courses WHERE id = ?");

 $stmt->execute([$id]);

 respond(['message' => 'Course deleted']);

}



respond(['error' => 'Method not allowed'], 405);


