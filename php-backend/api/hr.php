<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$userId = $tokenData['user_id'];
$role = strtolower((string) ($tokenData['role'] ?? ''));
$normalizedRole = $role === 'superadmin' ? 'super_admin' : ($role === 'organisation' ? 'org' : $role);
$currentOrgId = getOrgId($tokenData);
$input = getInput();

function hrEnsureColumns(PDO $db): void {
    static $done = false;
    if ($done) return;
    try { $db->exec("ALTER TABLE users ADD COLUMN created_by CHAR(36) NULL"); } catch (Throwable $e) {}
    try { $db->exec("ALTER TABLE users ADD INDEX idx_users_created_by (created_by)"); } catch (Throwable $e) {}
    try { $db->exec("ALTER TABLE leads ADD COLUMN created_by CHAR(36) NULL"); } catch (Throwable $e) {}
    try { $db->exec("ALTER TABLE leads ADD INDEX idx_leads_created_by (created_by)"); } catch (Throwable $e) {}
    $done = true;
}
hrEnsureColumns($db);

if ($action === 'create_hr' && $method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $fullName = trim($input['full_name'] ?? '');
    $email = trim($input['email'] ?? '');
    $password = (string) ($input['password'] ?? '');
    if ($fullName === '' || $email === '' || strlen($password) < 8) respond(['error' => 'Invalid payload'], 400);

    $dup = $db->prepare("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1");
    $dup->execute([$email]);
    if ($dup->fetch()) respond(['error' => 'Email already exists'], 409);

    $id = generateUUID();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role, org_id, created_by, referral_code) VALUES (?,?,?,?,?,?,?,?,?)");
    $stmt->execute([$id, $email, $hash, $fullName, $input['phone'] ?? null, 'hr', $orgId, $userId, strtoupper(substr(str_replace('-', '', $id), 0, 8))]);
    syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'member_welcome');
    $welcomeResult = syncpediaSendMemberWelcomeEmail($fullName, $email, $password, 'hr', $input['phone'] ?? null);
    $payload = ['id' => $id, 'message' => 'HR user created', 'email_sent' => $welcomeResult['email_sent'], 'email_from' => $welcomeResult['from']];
    if ($welcomeResult['email_error'] !== null) {
        $payload['email_error'] = $welcomeResult['email_error'];
    }
    respond($payload, 201);
}

if ($action === 'list_hrs' && $method === 'GET') {
    if (!in_array($normalizedRole, ['super_admin', 'admin', 'org'], true)) {
        respond(['error' => 'Insufficient permissions'], 403);
    }
    if ($normalizedRole === 'super_admin') {
        $orgFilter = trim((string) ($_GET['org_id'] ?? ''));
        if ($orgFilter !== '' && $orgFilter !== 'all') {
            $stmt = $db->prepare("SELECT id, full_name, email, phone, role, org_id, created_by, is_active, created_at FROM users WHERE role='hr' AND org_id=? ORDER BY created_at DESC");
            $stmt->execute([$orgFilter]);
            respond(['data' => $stmt->fetchAll()]);
        }
        $stmt = $db->query("SELECT id, full_name, email, phone, role, org_id, created_by, is_active, created_at FROM users WHERE role='hr' ORDER BY created_at DESC");
        respond(['data' => $stmt->fetchAll()]);
    }
    // Admin/Org: only HR users from own organization
    $stmt = $db->prepare("SELECT id, full_name, email, phone, role, org_id, created_by, is_active, created_at FROM users WHERE role='hr' AND org_id=? ORDER BY created_at DESC");
    $stmt->execute([$currentOrgId]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'update_hr' && $method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    $fields = [];
    $params = [];
    foreach (['full_name', 'phone', 'email'] as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f=?"; $params[] = $input[$f]; }
    }
    if (!$fields) respond(['error' => 'Nothing to update'], 400);
    $params[] = $id;
    $stmt = $db->prepare("UPDATE users SET " . implode(',', $fields) . " WHERE id=? AND role='hr'");
    $stmt->execute($params);
    respond(['message' => 'HR updated']);
}

if ($action === 'delete_hr' && $method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin']);
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    $stmt = $db->prepare("UPDATE users SET is_active = 0 WHERE id=? AND role='hr'");
    $stmt->execute([$id]);
    respond(['message' => 'HR deactivated']);
}

requireRole($tokenData, ['hr']);

if ($action === 'hr_dashboard' && $method === 'GET') {
    $bounds = hrLeadsWeekBoundsAndMeta();
    $wkStart = $bounds['start'];
    $wkEnd = $bounds['end'];

    $myHrLeadsWeek = 0;
    $assignedHrLeads = 0;
    try {
        $qAw = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE hr_id = ? AND is_assigned = 0 AND deleted_at IS NULL AND created_at >= ? AND created_at <= ?");
        $qAw->execute([$userId, $wkStart, $wkEnd]);
        $myHrLeadsWeek = (int) (($qAw->fetch()['c'] ?? 0));

        $qAs = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE hr_id = ? AND is_assigned = 1 AND deleted_at IS NULL");
        $qAs->execute([$userId]);
        $assignedHrLeads = (int) (($qAs->fetch()['c'] ?? 0));
    } catch (Throwable $e) {
        // HR leads (`hr_leads` table) may be missing on older installs
    }

    $q3 = $db->prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to=? AND status <> 'completed'"); $q3->execute([$userId]); $c = $q3->fetch();
    $q4 = $db->prepare("SELECT COUNT(*) c FROM holidays WHERE date >= CURDATE()"); $q4->execute(); $d = $q4->fetch();

    $activity = [];
    try {
        $q5 = $db->prepare("SELECT DATE_FORMAT(created_at, '%b %d') label, COUNT(*) value FROM hr_leads WHERE hr_id=? AND is_assigned=0 AND deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY DATE(created_at)");
        $q5->execute([$userId]);
        $activity = $q5->fetchAll();
    } catch (Throwable $e) {
        $q5 = $db->prepare("SELECT DATE_FORMAT(created_at, '%b %d') label, COUNT(*) value FROM leads WHERE created_by=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY DATE(created_at)");
        $q5->execute([$userId]);
        $activity = $q5->fetchAll();
    }

    respond([
        'stats' => [
            'my_leads_added' => $myHrLeadsWeek,
            'assigned_leads' => $assignedHrLeads,
            'pending_tasks' => (int) ($c['c'] ?? 0),
            'upcoming_holidays' => (int) ($d['c'] ?? 0),
            'my_leads_count' => $myHrLeadsWeek,
            'week' => $bounds['week'],
        ],
        'week' => $bounds['week'],
        'activity' => $activity,
    ]);
}

if ($action === 'add_lead' && $method === 'POST') {
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') respond(['error' => 'name required'], 400);
    $id = generateUUID();
    $stmt = $db->prepare("INSERT INTO leads (id, name, phone, email, source, status, notes, assigned_to, created_by, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)");
    $stmt->execute([$id, $name, $input['phone'] ?? null, $input['email'] ?? null, $input['source'] ?? 'other', $input['status'] ?? 'new', $input['notes'] ?? null, $userId, $userId, $tokenData['org_id'] ?? null]);
    respond(['id' => $id, 'message' => 'Lead added'], 201);
}

if ($action === 'my_leads' && $method === 'GET') {
    $where = "created_by = ?";
    $params = [$userId];
    $search = trim((string) ($_GET['search'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? 'all'));
    if ($status !== '' && $status !== 'all') { $where .= " AND status = ?"; $params[] = $status; }
    if ($search !== '') { $where .= " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)"; $s = "%$search%"; $params[] = $s; $params[] = $s; $params[] = $s; }
    $stmt = $db->prepare("SELECT * FROM leads WHERE $where ORDER BY created_at DESC LIMIT 300");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'assigned_leads' && $method === 'GET') {
    $where = "l.assigned_to = ?";
    $params = [$userId];
    $search = trim((string) ($_GET['search'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? 'all'));
    if ($status !== '' && $status !== 'all') { $where .= " AND l.status = ?"; $params[] = $status; }
    if ($search !== '') { $where .= " AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)"; $s = "%$search%"; $params[] = $s; $params[] = $s; $params[] = $s; }
    $stmt = $db->prepare("SELECT l.*, u.full_name as assigned_by_name FROM leads l LEFT JOIN users u ON l.created_by = u.id WHERE $where ORDER BY l.updated_at DESC LIMIT 300");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'assigned_leads' && $method === 'PUT') {
    $id = trim((string) ($input['id'] ?? ''));
    $status = leadsNormalizeStatus(trim((string) ($input['status'] ?? '')));
    if ($id === '' || $status === '') respond(['error' => 'id/status required'], 400);
    if (!in_array($status, leadsAllowedStatuses(), true)) {
        respond(['error' => 'Invalid status'], 400);
    }
    $sel = $db->prepare('SELECT id, status FROM leads WHERE id = ? AND assigned_to = ? LIMIT 1');
    $sel->execute([$id, $userId]);
    $lead = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$lead) {
        respond(['error' => 'Lead not found'], 404);
    }
    $transitionErr = leadsAssertStatusTransition((string) ($lead['status'] ?? ''), $status);
    if ($transitionErr !== null) {
        respond(['error' => $transitionErr], 400);
    }
    if ($status === 'enrolled') {
        $em = $db->prepare('SELECT email FROM leads WHERE id = ? LIMIT 1');
        $em->execute([$id]);
        $email = trim((string) ($em->fetchColumn() ?: ''));
        if ($email === '') {
            respond(['error' => 'Add an email on the lead before enrolling'], 400);
        }
    }
    $stmt = $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND assigned_to = ?');
    $stmt->execute([$status, $id, $userId]);
    if ($status === 'enrolled') {
        try {
            leadsTryAttachStudentForEnrollment($db, $tokenData, $id);
        } catch (Throwable $e) {
            error_log('[hr] enroll student: ' . $e->getMessage());
        }
    }
    respond(['message' => 'Lead status updated']);
}

if ($action === 'tasks' && $method === 'GET') {
    $stmt = $db->prepare("SELECT t.*, u.full_name AS assigned_by_name FROM tasks t LEFT JOIN users u ON t.created_by = u.id WHERE t.assigned_to=? ORDER BY t.due_date ASC");
    $stmt->execute([$userId]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'tasks' && $method === 'PUT') {
    $id = trim((string) ($input['id'] ?? ''));
    $status = trim((string) ($input['status'] ?? ''));
    if ($id === '' || $status === '') respond(['error' => 'id/status required'], 400);
    $stmt = $db->prepare("UPDATE tasks SET status=? WHERE id=? AND assigned_to=?");
    $stmt->execute([$status, $id, $userId]);
    respond(['message' => 'Task updated']);
}

if ($action === 'reports' && $method === 'GET') {
    $lead = $db->prepare("SELECT DATE_FORMAT(created_at, '%b %d') label, COUNT(*) count FROM leads WHERE created_by=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY DATE(created_at)");
    $lead->execute([$userId]);
    $task = $db->prepare("SELECT DATE_FORMAT(updated_at, '%b %d') label, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM tasks WHERE assigned_to=? AND updated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(updated_at) ORDER BY DATE(updated_at)");
    $task->execute([$userId]);
    respond(['lead_report' => $lead->fetchAll(), 'task_report' => $task->fetchAll()]);
}

if ($action === 'notifications' && $method === 'GET') {
    $stmt = $db->prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200");
    $stmt->execute([$userId]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'holidays' && $method === 'GET') {
    $year = $_GET['year'] ?? date('Y');
    $stmt = $db->prepare("SELECT * FROM holidays WHERE YEAR(date)=? ORDER BY date ASC");
    $stmt->execute([$year]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'mark_notification_read' && $method === 'PUT') {
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    $stmt = $db->prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?");
    $stmt->execute([$id, $userId]);
    respond(['message' => 'Notification marked read']);
}

respond(['error' => 'Invalid action'], 400);
