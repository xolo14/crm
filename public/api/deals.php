<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

if ($method === 'GET') {
    // Check if requesting stages
    if (isset($_GET['stages'])) {
        $stg = pipelineStagesOrgFilter($tokenData, 'ps', $db);
        $stmt = $db->prepare("SELECT ps.* FROM pipeline_stages ps WHERE {$stg['where']} ORDER BY ps.position");
        $stmt->execute($stg['params']);
        respond(['data' => $stmt->fetchAll()]);
    }

    $where = "1=1";
    $params = [];

    $of = orgFilter($tokenData, 'd');
    $where .= ' AND (' . $of['where'] . ')';
    $params = array_merge($params, $of['params']);

    $effRole = syncpediaNormalizeRoleKey((string) $role);
    if ($effRole === 'sales_representative') {
        $where .= " AND d.owner_id = ?";
        $params[] = $userId;
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $scope = hierarchyBuildInClause('d.owner_id', $visibleIds);
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    }

    if (!empty($_GET['status'])) {
        $where .= " AND d.status = ?";
        $params[] = $_GET['status'];
    }

    $stmt = $db->prepare("SELECT d.*, c.name as contact_name, ps.name as stage_name, ps.color as stage_color 
        FROM deals d 
        LEFT JOIN contacts c ON d.contact_id = c.id 
        LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id 
        WHERE $where ORDER BY d.created_at DESC LIMIT 500");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();

    $dealOrgId = resolveWriteOrgId($db, $tokenData);
    if (($role ?? '') === 'super_admin' && !empty($input['org_id'])) {
        $dealOrgId = $input['org_id'];
    }

    $stmt = $db->prepare("INSERT INTO deals (id, title, value, stage_id, contact_id, owner_id, expected_close_date, probability, description, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id, $input['title'], $input['value'] ?? 0, $input['stage_id'] ?? null,
        $input['contact_id'] ?? null, $input['owner_id'] ?? $userId,
        $input['expected_close_date'] ?? null, $input['probability'] ?? 50, $input['description'] ?? null,
        $dealOrgId,
    ]);
    respond(['id' => $id, 'message' => 'Deal created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $fields = [];
    $params = [];
    foreach (['title', 'value', 'stage_id', 'contact_id', 'expected_close_date', 'probability', 'description', 'status'] as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $orgAnd = orgFilterSqlAnd($tokenData, 'd', $db);
    $params = array_merge($params, [$id], $orgAnd['params']);
    $stmt = $db->prepare('UPDATE deals d SET ' . implode(', ', $fields) . ' WHERE d.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    if ($stmt->rowCount() === 0) {
        respond(['error' => 'Deal not found'], 404);
    }
    respond(['message' => 'Deal updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'manager', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $orgAnd = orgFilterSqlAnd($tokenData, 'd', $db);
    $params = array_merge([$id], $orgAnd['params']);
    $chk = $db->prepare('SELECT * FROM deals d WHERE d.id = ?' . $orgAnd['sql'] . ' LIMIT 1');
    $chk->execute($params);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Deal not found'], 404);
    }

    trashArchivePayload($db, 'deal', $row, $tokenData);
    $stmt = $db->prepare('DELETE FROM deals d WHERE d.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    respond(['message' => 'Deal deleted']);
}

respond(['error' => 'Method not allowed'], 405);
