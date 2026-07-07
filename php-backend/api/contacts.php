<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

if ($method === 'GET') {
    $where = '1=1';
    $params = [];

    $of = orgFilter($tokenData, 'c', $db);
    $where .= ' AND (' . $of['where'] . ')';
    $params = array_merge($params, $of['params']);

    $effRole = syncpediaNormalizeRoleKey((string) $role);
    if ($effRole === 'sales_representative') {
        $where .= ' AND c.owner_id = ?';
        $params[] = $userId;
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $scope = hierarchyBuildInClause('c.owner_id', $visibleIds);
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    }

    $stmt = $db->prepare("SELECT c.* FROM contacts c WHERE $where ORDER BY c.created_at DESC LIMIT 500");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);

    try {
        $stmt = $db->prepare('INSERT INTO contacts (id, name, email, phone, company, position, lead_id, owner_id, notes, tags, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $input['name'],
            $input['email'] ?? null,
            $input['phone'] ?? null,
            $input['company'] ?? null,
            $input['position'] ?? null,
            $input['lead_id'] ?? null,
            $input['owner_id'] ?? $userId,
            $input['notes'] ?? null,
            json_encode($input['tags'] ?? []),
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare('INSERT INTO contacts (id, name, email, phone, company, position, lead_id, owner_id, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([
                $id,
                $input['name'],
                $input['email'] ?? null,
                $input['phone'] ?? null,
                $input['company'] ?? null,
                $input['position'] ?? null,
                $input['lead_id'] ?? null,
                $input['owner_id'] ?? $userId,
                $input['notes'] ?? null,
                json_encode($input['tags'] ?? []),
            ]);
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Contact created'], 201);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $fields = [];
    $params = [];
    foreach (['name', 'email', 'phone', 'company', 'position', 'notes'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'c', $db);
    $params = array_merge($params, [$id], $orgAnd['params']);
    $stmt = $db->prepare('UPDATE contacts c SET ' . implode(', ', $fields) . ' WHERE c.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    if ($stmt->rowCount() === 0) {
        respond(['error' => 'Contact not found'], 404);
    }
    respond(['message' => 'Contact updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'manager', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }

    $orgAnd = orgFilterSqlAnd($tokenData, 'c', $db);
    $params = array_merge([$id], $orgAnd['params']);
    $chk = $db->prepare('SELECT * FROM contacts c WHERE c.id = ?' . $orgAnd['sql'] . ' LIMIT 1');
    $chk->execute($params);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Contact not found'], 404);
    }

    trashArchivePayload($db, 'contact', $row, $tokenData);
    $stmt = $db->prepare('DELETE FROM contacts c WHERE c.id = ?' . $orgAnd['sql']);
    $stmt->execute($params);
    respond(['message' => 'Contact deleted']);
}

respond(['error' => 'Method not allowed'], 405);
