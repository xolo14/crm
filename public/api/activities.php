<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];

if ($method === 'GET') {
    $scope = activitiesListScopeSql($db, $tokenData, 'a');
    $leadId = trim((string) ($_GET['lead_id'] ?? ''));
    $sql = 'SELECT * FROM activities a WHERE 1=1' . $scope['sql'];
    $params = $scope['params'];

    // Per-lead history: latest N for that lead (not a global org-wide cap).
    if ($leadId !== '') {
        $sql .= ' AND a.lead_id = ?';
        $params[] = $leadId;
        $sql .= ' ORDER BY COALESCE(a.occurred_at, a.created_at) DESC LIMIT 10';
    } else {
        $sql .= ' ORDER BY COALESCE(a.occurred_at, a.created_at) DESC LIMIT 100';
    }

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $input = getInput();
    $id = generateUUID();
    $orgId = resolveWriteOrgId($db, $tokenData);
    // Explicit IST wall-clock so activity time matches the agent's clock (not Hostinger UTC).
    $occurredAt = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d H:i:s');

    try {
        $stmt = $db->prepare('INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes, occurred_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
            $occurredAt,
            $orgId,
        ]);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'org_id') !== false) {
            try {
                $stmt = $db->prepare('INSERT INTO activities (id, type, subject, description, lead_id, contact_id, deal_id, user_id, duration_minutes, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
                    $occurredAt,
                ]);
            } catch (Throwable $e2) {
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
            }
        } else {
            throw $e;
        }
    }
    respond(['id' => $id, 'message' => 'Activity logged', 'occurred_at' => $occurredAt], 201);
}

respond(['error' => 'Method not allowed'], 405);
