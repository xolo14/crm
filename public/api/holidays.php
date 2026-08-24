<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/holiday_calendar.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $year = (int) ($_GET['year'] ?? date('Y'));
    if ($year < 1970 || $year > 2100) {
        $year = (int) date('Y');
    }
    $orgId = resolveWriteOrgId($db, $tokenData);
    try {
        syncpediaSeedIndiaHolidayCalendar($db, $orgId ? (string) $orgId : null, $year);
    } catch (Throwable $e) {
        error_log('[holidays] calendar seed failed: ' . $e->getMessage());
    }
    $org = orgFilter($tokenData, 'h', $db);
    $params = array_merge([$year], $org['params']);
    $stmt = $db->prepare("SELECT * FROM holidays h WHERE YEAR(h.date) = ? AND {$org['where']} ORDER BY h.date ASC");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);
    $type = strtolower(trim((string) ($input['type'] ?? 'custom')));
    if (!in_array($type, ['national', 'public', 'regional', 'festival', 'custom'], true)) {
        $type = 'custom';
    }
    $isAdmin = in_array(syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')), ['admin', 'super_admin'], true);
    $isSpecial = in_array($type, ['regional', 'festival'], true);
    $approved = ($isAdmin && !$isSpecial) ? 1 : 0;

    try {
        $stmt = $db->prepare("INSERT INTO holidays (id, name, date, type, notes, is_approved, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'],
            $input['date'],
            $type,
            $input['notes'] ?? null,
            $approved,
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare("INSERT INTO holidays (id, name, date, type, notes, is_approved) VALUES (?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $input['name'],
                $input['date'],
                $type,
                $input['notes'] ?? null,
                $approved,
            ]);
        } else {
            throw $e;
        }
    }
    $hName = trim((string) ($input['name'] ?? 'Holiday'));
    syncpediaNotifyHolidayChange($db, (string) $userId, $orgId ? (string) $orgId : null, $hName, 'added');
    respond(['id' => $id, 'message' => 'Holiday created'], 201);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $input = getInput();
    $fields = [];
    $params = [];
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $canApprove = in_array($role, ['admin', 'super_admin'], true);

    foreach (['name', 'date', 'type', 'notes'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }

    // Never trust client is_approved / approved_by — only admin/super_admin may approve.
    if (array_key_exists('is_approved', $input)) {
        if (!$canApprove) {
            respond(['error' => 'Only admin can approve holidays'], 403);
        }
        $approve = !empty($input['is_approved']);
        $fields[] = 'is_approved = ?';
        $params[] = $approve ? 1 : 0;
        if ($approve) {
            $fields[] = 'approved_by = ?';
            $params[] = $userId;
            $fields[] = 'approved_at = NOW()';
        } else {
            $fields[] = 'approved_by = NULL';
            $fields[] = 'approved_at = NULL';
        }
    }

    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'h', $db);
    $params = array_merge($params, [$id], $orgAnd['params']);
    $stmt = $db->prepare('UPDATE holidays h SET ' . implode(', ', $fields) . ' WHERE h.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    if ($stmt->rowCount() === 0) {
        respond(['error' => 'Holiday not found'], 404);
    }
    respond(['message' => 'Holiday updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'h', $db);
    $params = array_merge([$id], $orgAnd['params']);
    $chk = $db->prepare('SELECT id, name, org_id FROM holidays h WHERE h.id = ?' . $orgAnd['sql'] . ' LIMIT 1');
    $chk->execute($params);
    $holidayRow = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$holidayRow) {
        respond(['error' => 'Holiday not found'], 404);
    }

    trashArchiveRow($db, 'holiday', 'holidays', $id, $tokenData);
    $stmt = $db->prepare('DELETE FROM holidays h WHERE h.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    syncpediaNotifyHolidayChange(
        $db,
        (string) $userId,
        isset($holidayRow['org_id']) ? (string) $holidayRow['org_id'] : resolveWriteOrgId($db, $tokenData),
        (string) ($holidayRow['name'] ?? 'Holiday'),
        'removed',
    );
    respond(['message' => 'Holiday deleted']);
}

respond(['error' => 'Method not allowed'], 405);
