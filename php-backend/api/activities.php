<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $scope = activitiesListScopeSql($db, $tokenData, 'a');
    $stmt = $db->prepare('SELECT * FROM activities a WHERE 1=1' . $scope['sql'] . ' ORDER BY a.occurred_at DESC LIMIT 100');
    $stmt->execute($scope['params']);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);

    try {
        $stmt = $db->prepare('INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $id,
            $input['type'],
            $input['subject'],
            $input['description'] ?? null,
            $input['lead_id'] ?? null,
            $input['contact_id'] ?? null,
            $input['deal_id'] ?? null,
            $userId,
            $input['duration_minutes'] ?? null,
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            $stmt = $db->prepare('INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([
                $id,
                $input['type'],
                $input['subject'],
                $input['description'] ?? null,
                $input['lead_id'] ?? null,
                $input['contact_id'] ?? null,
                $input['deal_id'] ?? null,
                $userId,
                $input['duration_minutes'] ?? null,
            ]);
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Activity logged'], 201);
}

respond(['error' => 'Method not allowed'], 405);
