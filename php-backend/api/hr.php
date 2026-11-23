<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/holiday_calendar.php';
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
    $stmt->execute([$id, $email, $hash, $fullName, $input['phone'] ?? null, 'hr', $orgId, $userId, referralCodeForNewOrgUser($db, (string) $orgId, 'hr', $fullName)]);
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
    syncpediaBumpUserTokenVersion($db, $id);
    respond(['message' => 'HR deactivated']);
}

requireRole($tokenData, ['hr']);

/** Today in IST (the team's calendar), not the DB server's timezone. */
function hrTodayIst(): string
{
    return (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d');
}

/**
 * "Upcoming holidays" — one rule for the dashboard card and the Holidays page:
 * declared days off (is_approved = 1) from today (IST) through the next 365 days.
 */
function hrUpcomingHolidayCount(PDO $db, array $tokenData): int
{
    $org = orgFilter($tokenData, '', $db);
    $today = hrTodayIst();
    $until = (new DateTime($today))->modify('+365 days')->format('Y-m-d');
    $st = $db->prepare("SELECT COUNT(*) FROM holidays WHERE is_approved = 1 AND date >= ? AND date <= ? AND {$org['where']}");
    $st->execute(array_merge([$today, $until], $org['params']));
    return (int) $st->fetchColumn();
}

/**
 * Buckets for HR charts, oldest first, every bucket present (zeros included):
 * week = last 7 days, month = last 30 days (by day), year = last 12 months (by month).
 *
 * @return list<array{key: string, label: string}>
 */
function hrPeriodBuckets(string $range): array
{
    $tz = new DateTimeZone('Asia/Kolkata');
    $out = [];
    if ($range === 'year') {
        $m = new DateTime('first day of this month', $tz);
        $m->modify('-11 months');
        for ($i = 0; $i < 12; $i++) {
            $out[] = ['key' => $m->format('Y-m'), 'label' => $m->format('M Y')];
            $m->modify('+1 month');
        }
        return $out;
    }
    $days = $range === 'week' ? 7 : 30;
    $d = new DateTime('today', $tz);
    $d->modify('-' . ($days - 1) . ' days');
    for ($i = 0; $i < $days; $i++) {
        $out[] = ['key' => $d->format('Y-m-d'), 'label' => $d->format('d M')];
        $d->modify('+1 day');
    }
    return $out;
}

/**
 * Count rows per bucket. $dateExpr is a column on $table; $where/$params scope the rows.
 *
 * @return list<array{label: string, count: int}>
 */
function hrSeries(PDO $db, string $table, string $dateExpr, string $where, array $params, string $range): array
{
    $buckets = hrPeriodBuckets($range);
    $fmt = $range === 'year' ? '%Y-%m' : '%Y-%m-%d';
    $from = $range === 'year' ? $buckets[0]['key'] . '-01' : $buckets[0]['key'];
    $counts = [];
    try {
        $st = $db->prepare("SELECT DATE_FORMAT({$dateExpr}, '{$fmt}') k, COUNT(*) c FROM {$table}
                             WHERE {$where} AND {$dateExpr} >= ? GROUP BY DATE_FORMAT({$dateExpr}, '{$fmt}')");
        $st->execute(array_merge($params, [$from]));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $counts[(string) $r['k']] = (int) $r['c'];
        }
    } catch (Throwable $e) {
        error_log('[hr series] ' . $e->getMessage());
    }
    return array_map(static fn($b) => ['label' => $b['label'], 'count' => $counts[$b['key']] ?? 0], $buckets);
}

/**
 * HR leads per bucket: the `hr_leads` rows the HR pages show (assigned to this HR user or
 * added by them), plus any CRM `leads` rows assigned to / added by them (older installs).
 */
function hrLeadSeries(PDO $db, string $userId, string $range): array
{
    $hr = hrSeries($db, 'hr_leads', 'created_at', 'hr_id = ? AND deleted_at IS NULL', [$userId], $range);
    $crm = hrSeries($db, 'leads', 'created_at', '(assigned_to = ? OR created_by = ?)', [$userId, $userId], $range);
    foreach ($hr as $i => $row) {
        $hr[$i]['count'] = (int) $row['count'] + (int) ($crm[$i]['count'] ?? 0);
    }
    return $hr;
}

/**
 * Tasks for the Reports page, one period: completions per bucket split into on time / late
 * (completed after the due date), and a summary for tasks due in the period.
 */
function hrTaskReport(PDO $db, string $userId, string $range): array
{
    $buckets = hrPeriodBuckets($range);
    $fmt = $range === 'year' ? '%Y-%m' : '%Y-%m-%d';
    $from = $range === 'year' ? $buckets[0]['key'] . '-01' : $buckets[0]['key'];
    $onTime = [];
    $late = [];
    $summary = ['total' => 0, 'completed' => 0, 'late' => 0, 'overdue' => 0];
    try {
        // Completion time = updated_at when status became completed (tasks have no completed_at).
        $st = $db->prepare("SELECT DATE_FORMAT(updated_at, '{$fmt}') k,
                                   SUM(CASE WHEN due_date IS NOT NULL AND DATE(updated_at) > DATE(due_date) THEN 1 ELSE 0 END) late,
                                   SUM(CASE WHEN due_date IS NULL OR DATE(updated_at) <= DATE(due_date) THEN 1 ELSE 0 END) on_time
                              FROM tasks
                             WHERE assigned_to = ? AND status = 'completed' AND updated_at >= ?
                             GROUP BY DATE_FORMAT(updated_at, '{$fmt}')");
        $st->execute([$userId, $from]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $onTime[(string) $r['k']] = (int) $r['on_time'];
            $late[(string) $r['k']] = (int) $r['late'];
        }
        // Summary: tasks due inside the period (so it moves with the period filter).
        $today = hrTodayIst();
        $sm = $db->prepare("SELECT COUNT(*) total,
                                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) done,
                                   SUM(CASE WHEN status = 'completed' AND DATE(updated_at) > DATE(due_date) THEN 1 ELSE 0 END) late,
                                   SUM(CASE WHEN status <> 'completed' AND DATE(due_date) < ? THEN 1 ELSE 0 END) overdue
                              FROM tasks
                             WHERE assigned_to = ? AND due_date IS NOT NULL AND DATE(due_date) >= ? AND DATE(due_date) <= ?");
        $sm->execute([$today, $userId, $from, $today]);
        $t = $sm->fetch(PDO::FETCH_ASSOC) ?: [];
        $summary = [
            'total' => (int) ($t['total'] ?? 0),
            'completed' => (int) ($t['done'] ?? 0),
            'late' => (int) ($t['late'] ?? 0),
            'overdue' => (int) ($t['overdue'] ?? 0),
        ];
    } catch (Throwable $e) {
        error_log('[hr task report] ' . $e->getMessage());
    }
    $summary['completion_rate'] = $summary['total'] > 0 ? (int) round($summary['completed'] * 100 / $summary['total']) : 0;
    $rows = array_map(static fn($b) => [
        'label' => $b['label'],
        'on_time' => $onTime[$b['key']] ?? 0,
        'late' => $late[$b['key']] ?? 0,
        'completed' => ($onTime[$b['key']] ?? 0) + ($late[$b['key']] ?? 0),
    ], $buckets);
    return ['rows' => $rows, 'summary' => $summary];
}

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
    // Same source as the Assigned Leads page (leads.assigned_to), so the card matches the list.
    try {
        $qAl = $db->prepare('SELECT COUNT(*) c FROM leads WHERE assigned_to = ?');
        $qAl->execute([$userId]);
        $assignedHrLeads = max($assignedHrLeads, (int) (($qAl->fetch()['c'] ?? 0)));
    } catch (Throwable $e) {
    }

    $q3 = $db->prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to=? AND status <> 'completed'"); $q3->execute([$userId]); $c = $q3->fetch();

    // Last 30 days of leads (assigned + own), every day present; trend = running total.
    $activity = array_map(static fn($r) => ['label' => $r['label'], 'value' => $r['count']], hrLeadSeries($db, (string) $userId, 'month'));
    $trend = [];
    $running = 0;
    foreach ($activity as $row) {
        $running += (int) $row['value'];
        $trend[] = ['label' => $row['label'], 'value' => $running];
    }

    respond([
        'stats' => [
            'my_leads_added' => $myHrLeadsWeek,
            'assigned_leads' => $assignedHrLeads,
            'pending_tasks' => (int) ($c['c'] ?? 0),
            'upcoming_holidays' => hrUpcomingHolidayCount($db, $tokenData),
            'my_leads_count' => $myHrLeadsWeek,
            'week' => $bounds['week'],
        ],
        'week' => $bounds['week'],
        'activity' => $activity,
        'trend' => $trend,
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
    $stmt = $db->prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND assigned_to = ? AND status = ?');
    $stmt->execute([$status, $id, $userId, $lead['status']]);
    if ($stmt->rowCount() < 1) {
        respond(['error' => 'Lead was updated by someone else — refresh and try again'], 409);
    }
    if ($status === 'enrolled') {
        try {
            leadsTryAttachStudentForEnrollment($db, $tokenData, $id);
            if (!enrollStudentRowAlreadyExists($db, $id)) {
                throw new RuntimeException('student_create_failed');
            }
        } catch (Throwable $e) {
            error_log('[hr] enroll student: ' . $e->getMessage());
            // Revert status — never leave enrolled without a student.
            try {
                $prev = strtolower(trim((string) ($lead['status'] ?? 'interested')));
                if ($prev === '' || $prev === 'enrolled') {
                    $prev = 'interested';
                }
                $db->prepare(
                    'UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?',
                )->execute([$prev, $id, 'enrolled']);
            } catch (Throwable $revertErr) {
                error_log('[hr] enroll status revert: ' . $revertErr->getMessage());
            }
            respond(['error' => 'Could not create student for enrollment — status reverted'], 500);
        }
    } else {
        $prevNorm = leadsNormalizeStatus((string) ($lead['status'] ?? ''));
        if ($prevNorm === 'enrolled' || $prevNorm === 'converted') {
            leadsDropStudentForLead($db, $id);
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
    // range: week (7 days) | month (30 days) | year (12 months); every period present.
    $range = (string) ($_GET['range'] ?? 'month');
    if (!in_array($range, ['week', 'month', 'year'], true)) {
        $range = 'month';
    }
    $leadReport = hrLeadSeries($db, (string) $userId, $range);
    $tasks = hrTaskReport($db, (string) $userId, $range);

    respond([
        'range' => $range,
        'lead_report' => $leadReport,
        'lead_total' => array_sum(array_map(static fn($r) => (int) $r['count'], $leadReport)),
        'task_report' => $tasks['rows'],
        'task_summary' => $tasks['summary'],
    ]);
}

if ($action === 'notifications' && $method === 'GET') {
    // HR has no payments access, so payment alerts are never shown here (data exposure, not just noise).
    $stmt = $db->prepare("SELECT * FROM notifications WHERE user_id=? AND (type IS NULL OR type NOT IN ('payment', 'payment_link', 'manual_payment')) ORDER BY created_at DESC LIMIT 200");
    $stmt->execute([$userId]);
    respond(['data' => $stmt->fetchAll()]);
}

if ($action === 'holidays' && $method === 'GET') {
    $year = (int) ($_GET['year'] ?? date('Y'));
    if ($year < 1970 || $year > 2100) {
        $year = (int) date('Y');
    }
    try {
        $orgId = resolveWriteOrgId($db, $tokenData);
        syncpediaSeedIndiaHolidayCalendar($db, $orgId ? (string) $orgId : null, $year);
    } catch (Throwable $e) {
        error_log('[hr holidays] calendar seed failed: ' . $e->getMessage());
    }
    $orgHolidays = orgFilter($tokenData, '', $db);
    $stmt = $db->prepare("SELECT * FROM holidays WHERE YEAR(date)=? AND {$orgHolidays['where']} ORDER BY date ASC");
    $stmt->execute(array_merge([$year], $orgHolidays['params']));
    respond([
        'data' => $stmt->fetchAll(),
        // Same rule as the dashboard card, so both show the same number.
        'today' => hrTodayIst(),
        'upcoming_days_off' => hrUpcomingHolidayCount($db, $tokenData),
    ]);
}

if ($action === 'mark_notification_read' && $method === 'PUT') {
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    $stmt = $db->prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?");
    $stmt->execute([$id, $userId]);
    respond(['message' => 'Notification marked read']);
}

respond(['error' => 'Invalid action'], 400);
