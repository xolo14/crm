<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
requireRole($tokenData, ['admin', 'super_admin', 'manager', 'finance', 'org']);

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$action = $_GET['action'] ?? '';
$from = $_GET['from'] ?? '';
$to = $_GET['to'] ?? '';

function reportDateSql(string $alias, string $from, string $to): array {
    $p = $alias ? "$alias." : '';
    $conds = [];
    $params = [];
    if ($from && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        $conds[] = "{$p}created_at >= ?";
        $params[] = $from . ' 00:00:00';
    }
    if ($to && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        $conds[] = "{$p}created_at <= ?";
        $params[] = $to . ' 23:59:59';
    }
    return [$conds ? (' AND ' . implode(' AND ', $conds)) : '', $params];
}

if ($action === 'summary') {
    [$dLeads, $pLeads] = reportDateSql('l', $from, $to);
    [$dDeals, $pDeals] = reportDateSql('d', $from, $to);
    [$dPay, $pPay] = reportDateSql('p', $from, $to);
    [$dTasks, $pTasks] = reportDateSql('t', $from, $to);
    [$dContacts, $pContacts] = reportDateSql('c', $from, $to);

    $leadScope = reportsLeadOwnershipScopeSql($db, $tokenData, 'l');
    $stmt = $db->prepare(
        'SELECT COUNT(*) as total, SUM(status = \'enrolled\') as converted FROM leads l WHERE 1=1'
        . $leadScope['sql'] . $dLeads
    );
    $stmt->execute(array_merge($leadScope['params'], $pLeads));
    $leads = $stmt->fetch();

    $dealScope = reportsDealScopeSql($db, $tokenData, 'd');
    $stmt = $db->prepare(
        'SELECT COUNT(*) as total, SUM(status = \'won\') as won, SUM(CASE WHEN status = \'won\' THEN value ELSE 0 END) as deal_revenue, SUM(CASE WHEN status = \'open\' THEN value ELSE 0 END) as pipeline FROM deals d WHERE 1=1'
        . $dealScope['sql'] . $dDeals
    );
    $stmt->execute(array_merge($dealScope['params'], $pDeals));
    $deals = $stmt->fetch();

    $payScope = reportsPaymentScopeSql($db, $tokenData, 'p');
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(CASE WHEN status = \'paid\' THEN amount ELSE 0 END), 0) as paid_revenue FROM payments p WHERE 1=1'
        . $payScope['sql'] . $dPay
    );
    $stmt->execute(array_merge($payScope['params'], $pPay));
    $payRow = $stmt->fetch();

    $taskScope = reportsTaskScopeSql($db, $tokenData, 't');
    $stmt = $db->prepare(
        'SELECT COUNT(*) as total, SUM(status = \'completed\') as completed FROM tasks t WHERE 1=1'
        . $taskScope['sql'] . $dTasks
    );
    $stmt->execute(array_merge($taskScope['params'], $pTasks));
    $tasks = $stmt->fetch();

    $contactScope = reportsContactScopeSql($db, $tokenData, 'c');
    $stmt = $db->prepare(
        'SELECT COUNT(*) as total FROM contacts c WHERE 1=1'
        . $contactScope['sql'] . $dContacts
    );
    $stmt->execute(array_merge($contactScope['params'], $pContacts));
    $contacts = $stmt->fetch();

    $rev = (float)($payRow['paid_revenue'] ?? 0);
    respond([
        'totalLeads' => (int)($leads['total'] ?? 0),
        'convertedLeads' => (int)($leads['converted'] ?? 0),
        'totalDeals' => (int)($deals['total'] ?? 0),
        'wonDeals' => (int)($deals['won'] ?? 0),
        'revenue' => $rev,
        'deal_revenue' => (float)($deals['deal_revenue'] ?? 0),
        'pipeline' => (float)($deals['pipeline'] ?? 0),
        'totalTasks' => (int)($tasks['total'] ?? 0),
        'completedTasks' => (int)($tasks['completed'] ?? 0),
        'totalContacts' => (int)($contacts['total'] ?? 0),
        'total_leads' => (int)($leads['total'] ?? 0),
        'total_deals' => (int)($deals['total'] ?? 0),
        'tasks_done' => (int)($tasks['completed'] ?? 0),
    ]);
}

if ($action === 'leads_by_source') {
    [$dLeads, $pLeads] = reportDateSql('l', $from, $to);
    $leadScope = reportsLeadOwnershipScopeSql($db, $tokenData, 'l');
    $stmt = $db->prepare(
        'SELECT source, COUNT(*) as total, SUM(status = \'enrolled\') as converted FROM leads l WHERE 1=1'
        . $leadScope['sql'] . $dLeads . ' GROUP BY source'
    );
    $stmt->execute(array_merge($leadScope['params'], $pLeads));
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'deals_by_stage') {
    $orgId = tenantListOrgId($db, $tokenData);
    $stageScope = $orgId
        ? ['sql' => ' AND ps.org_id = ?', 'params' => [$orgId]]
        : (tenantIsMasterView($tokenData) ? ['sql' => '', 'params' => []] : ['sql' => ' AND 1=0', 'params' => []]);
    $dealScope = reportsDealScopeSql($db, $tokenData, 'd');
    $joinDeal = 'LEFT JOIN deals d ON d.stage_id = ps.id AND d.status = \'open\'' . $dealScope['sql'];
    $params = array_merge($dealScope['params'], $stageScope['params']);
    $stmt = $db->prepare("
        SELECT ps.id, ps.name, ps.position, COUNT(d.id) as count, COALESCE(SUM(d.value), 0) as value
        FROM pipeline_stages ps
        {$joinDeal}
        WHERE 1=1{$stageScope['sql']}
        GROUP BY ps.id, ps.name, ps.position
        ORDER BY ps.position
    ");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'team') {
    $userScope = reportsTeamUserScopeSql($db, $tokenData);
    $orgId = tenantListOrgId($db, $tokenData);
    $leadOrgClause = $orgId ? ' AND l.org_id = ?' : '';
    $dealOrgClause = $orgId ? ' AND d2.org_id = ?' : '';
    $dealOrgClause3 = $orgId ? ' AND d3.org_id = ?' : '';

    $sql = "SELECT u.id, u.full_name, u.email, u.role,
            (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = u.id{$leadOrgClause}) as leads_count,
            (SELECT COUNT(*) FROM deals d2 WHERE d2.owner_id = u.id AND d2.status = 'won'{$dealOrgClause}) as deals_won,
            (SELECT COALESCE(SUM(value), 0) FROM deals d3 WHERE d3.owner_id = u.id AND d3.status = 'won'{$dealOrgClause3}) as revenue
            FROM users u WHERE u.is_active = 1{$userScope['sql']} ORDER BY revenue DESC";
    $params = $userScope['params'];
    if ($orgId) {
        $params = array_merge($params, [$orgId, $orgId, $orgId]);
    }
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

respond(['error' => 'Invalid request'], 400);
