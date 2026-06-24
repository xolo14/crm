<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Super admin should see all courses unless an explicit org_id filter is requested.
    $effectiveToken = $tokenData;
    if (($tokenData['role'] ?? '') === 'super_admin' && empty($_GET['org_id'])) {
        $effectiveToken['org_id'] = null;
    }
    $rawOrg = getOrgId($effectiveToken);
    $orgIdFilter = (is_string($rawOrg) && trim($rawOrg) !== '') ? trim($rawOrg) : '';
    try {
        if ($orgIdFilter !== '') {
            // Include courses tagged to the org OR courses that have at least one batch in this org
            // (fixes legacy rows with NULL course.org_id but batch.org_id set).
            $stmt = $db->prepare("
                SELECT DISTINCT c.*
                FROM courses c
                WHERE (
                    c.org_id = ?
                    OR EXISTS (
                        SELECT 1 FROM batches b
                        WHERE b.course_id = c.id AND b.org_id = ? AND b.course_id IS NOT NULL
                    )
                )
                ORDER BY c.created_at DESC
            ");
            $stmt->execute([$orgIdFilter, $orgIdFilter]);
        } else {
            $org = orgFilter($effectiveToken, 'c');
            $stmt = $db->prepare("SELECT c.* FROM courses c WHERE {$org['where']} ORDER BY c.created_at DESC");
            $stmt->execute($org['params']);
        }
        $courses = $stmt->fetchAll();
    } catch (Throwable $e) {
        $stmt = $db->prepare("SELECT * FROM courses ORDER BY created_at DESC");
        $stmt->execute();
        $courses = $stmt->fetchAll();
    }
    foreach ($courses as &$c) {
        $c['modules'] = json_decode($c['modules'] ?? '[]', true);
        $c['is_active'] = (bool)$c['is_active'];
    }
    respond(['data' => $courses]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'manager', 'super_admin']);
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
        // Backward compatibility for older schemas without org_id.
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
    requireRole($tokenData, ['admin', 'manager', 'super_admin']);
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

    $params[] = $id;
    $stmt = $db->prepare("UPDATE courses SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Course updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    trashArchiveRow($db, 'course', 'courses', $id, $tokenData);
    $stmt = $db->prepare("DELETE FROM courses WHERE id = ?");
    $stmt->execute([$id]);
    respond(['message' => 'Course deleted']);
}
