<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

function dailyReportsEnsureLostColumn(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $dbName = $db->query('SELECT DATABASE()')->fetchColumn();
        if ($dbName === false || $dbName === '') {
            return;
        }
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
        );
        $stmt->execute([(string) $dbName, 'daily_reports', 'total_lost']);
        if ((int) $stmt->fetchColumn() > 0) {
            $done = true;
            return;
        }
        foreach ([
            'ALTER TABLE `daily_reports` ADD COLUMN `total_lost` INT NOT NULL DEFAULT 0 AFTER `new_leads_contacted`',
            'ALTER TABLE `daily_reports` ADD COLUMN `total_lost` INT NOT NULL DEFAULT 0',
        ] as $alterSql) {
            try {
                $db->exec($alterSql);
                break;
            } catch (PDOException $ignored) {
            }
        }
    } catch (Throwable $ignored) {
    }
    $done = true;
}

// GET - List daily reports
if ($method === 'GET') {
    $where = "1=1";
    $params = [];
    $effRole = syncpediaNormalizeRoleKey((string) $role);

    // Filter by user
    if (!empty($_GET['user_id'])) {
        $where .= " AND dr.user_id = ?";
        $params[] = $_GET['user_id'];
    } elseif (in_array($effRole, ['sales_representative', 'sales_marketing'], true)) {
        $where .= " AND dr.user_id = ?";
        $params[] = $userId;
    } elseif (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $scope = hierarchyBuildInClause('dr.user_id', $visibleIds);
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    } elseif (in_array($effRole, ['admin', 'org'], true)) {
        $scope = hierarchyOrgUserIdsScopeSql($tokenData, 'dr.user_id');
        $where .= $scope['sql'];
        $params = array_merge($params, $scope['params']);
    } elseif ($effRole === 'super_admin' && !empty($_GET['org_id'])) {
        $where .= ' AND dr.user_id IN (SELECT id FROM users WHERE org_id = ?)';
        $params[] = (string) $_GET['org_id'];
    }

    // Filter by date
    if (!empty($_GET['date'])) {
        $where .= " AND dr.report_date = ?";
        $params[] = $_GET['date'];
    }

    if (!empty($_GET['from'])) {
        $where .= " AND dr.report_date >= ?";
        $params[] = $_GET['from'];
    }
    if (!empty($_GET['to'])) {
        $where .= " AND dr.report_date <= ?";
        $params[] = $_GET['to'];
    }

    $stmt = $db->prepare("
        SELECT dr.*, u.full_name as user_name, u.email as user_email
        FROM daily_reports dr
        LEFT JOIN users u ON u.id = dr.user_id
        WHERE $where
        ORDER BY dr.report_date DESC, dr.created_at DESC
        LIMIT 500
    ");
    $stmt->execute($params);
    $reports = $stmt->fetchAll();

    // Parse JSON fields
    foreach ($reports as &$r) {
        $r['lead_updates'] = json_decode($r['lead_updates'] ?? '[]', true);
    }

    respond(['data' => $reports]);
}

// POST - Create/submit daily report
if ($method === 'POST') {
    dailyReportsEnsureLostColumn($db);
    $input = getInput();
    $id = generateUUID();
    $reportDate = $input['report_date'] ?? date('Y-m-d');
    $totalLost = (int) ($input['total_lost'] ?? 0);

    // Check if report already exists for this date
    $stmt = $db->prepare("SELECT id FROM daily_reports WHERE user_id = ? AND report_date = ?");
    $stmt->execute([$userId, $reportDate]);
    $existing = $stmt->fetch();

    if ($existing) {
        // Update existing report
        $stmt = $db->prepare("UPDATE daily_reports SET
            total_calls = ?, total_followups = ?, total_demos = ?, total_conversions = ?,
            new_leads_contacted = ?, total_lost = ?, lead_updates = ?, summary = ?, challenges = ?
            WHERE id = ?");
        $stmt->execute([
            $input['total_calls'] ?? 0,
            $input['total_followups'] ?? 0,
            $input['total_demos'] ?? 0,
            $input['total_conversions'] ?? 0,
            $input['new_leads_contacted'] ?? 0,
            $totalLost,
            json_encode($input['lead_updates'] ?? []),
            $input['summary'] ?? null,
            $input['challenges'] ?? null,
            $existing['id'],
        ]);
        respond(['id' => $existing['id'], 'message' => 'Report updated']);
    }

    $stmt = $db->prepare("INSERT INTO daily_reports (id, user_id, report_date, total_calls, total_followups, total_demos, total_conversions, new_leads_contacted, total_lost, lead_updates, summary, challenges) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $id,
        $userId,
        $reportDate,
        $input['total_calls'] ?? 0,
        $input['total_followups'] ?? 0,
        $input['total_demos'] ?? 0,
        $input['total_conversions'] ?? 0,
        $input['new_leads_contacted'] ?? 0,
        $totalLost,
        json_encode($input['lead_updates'] ?? []),
        $input['summary'] ?? null,
        $input['challenges'] ?? null,
    ]);

    respond(['id' => $id, 'message' => 'Report submitted'], 201);
}

// GET team members (for managers to pick a rep)
if ($method === 'GET' && isset($_GET['action']) && $_GET['action'] === 'team_summary') {
    requireRole($tokenData, ['admin', 'manager']);

    $stmt = $db->prepare("
        SELECT u.id, u.full_name, u.email,
            COUNT(dr.id) as total_reports,
            MAX(dr.report_date) as last_report_date
        FROM users u
        LEFT JOIN daily_reports dr ON dr.user_id = u.id
        WHERE u.role = 'sales_representative' AND u.is_active = 1
        GROUP BY u.id, u.full_name, u.email
        ORDER BY u.full_name
    ");
    $stmt->execute();
    respond(['data' => $stmt->fetchAll()]);
}

respond(['error' => 'Method not allowed'], 405);
