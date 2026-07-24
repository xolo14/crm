<?php
require_once __DIR__ . '/helpers.php';
ensureUploadDirectoriesExist();
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$userId = $tokenData['user_id'];
$rawRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

/** Add attachment_path if missing. */
function callLogsEnsureAttachmentColumn(PDO $db): void
{
    try {
        if (syncpediaColumnExists($db, 'call_logs', 'attachment_path')) {
            // Backward compat: if older schemas kept recording path in legacy columns, copy into attachment_path.
            try {
                if (syncpediaColumnExists($db, 'call_logs', 'recording_url')) {
                    $db->exec("UPDATE call_logs SET attachment_path = recording_url WHERE (attachment_path IS NULL OR TRIM(attachment_path) = '') AND recording_url IS NOT NULL AND TRIM(recording_url) <> ''");
                }
            } catch (Throwable $ignored) {
            }
            try {
                if (syncpediaColumnExists($db, 'call_logs', 'recording_path')) {
                    $db->exec("UPDATE call_logs SET attachment_path = recording_path WHERE (attachment_path IS NULL OR TRIM(attachment_path) = '') AND recording_path IS NOT NULL AND TRIM(recording_path) <> ''");
                }
            } catch (Throwable $ignored) {
            }
            return;
        }
        $db->exec('ALTER TABLE call_logs ADD COLUMN attachment_path VARCHAR(500) DEFAULT NULL');
        try {
            if (syncpediaColumnExists($db, 'call_logs', 'recording_url')) {
                $db->exec("UPDATE call_logs SET attachment_path = recording_url WHERE (attachment_path IS NULL OR TRIM(attachment_path) = '') AND recording_url IS NOT NULL AND TRIM(recording_url) <> ''");
            }
        } catch (Throwable $ignored) {
        }
        try {
            if (syncpediaColumnExists($db, 'call_logs', 'recording_path')) {
                $db->exec("UPDATE call_logs SET attachment_path = recording_path WHERE (attachment_path IS NULL OR TRIM(attachment_path) = '') AND recording_path IS NOT NULL AND TRIM(recording_path) <> ''");
            }
        } catch (Throwable $ignored) {
        }
    } catch (Throwable $ignored) {
    }
}

function ensureCallLogsTable(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    if (syncpediaSkipRuntimeDdl($db)) {
        $done = true;
        return;
    }
    $sql = "CREATE TABLE IF NOT EXISTS call_logs (
      id SERIAL PRIMARY KEY,
      sales_rep_id CHAR(36) NOT NULL,
      org_id CHAR(36) NOT NULL,
      lead_id CHAR(36) DEFAULT NULL,
      call_type VARCHAR(20) NOT NULL,
      call_status VARCHAR(40) NOT NULL DEFAULT 'connected',
      duration_seconds INT NOT NULL DEFAULT 0,
      client_phone VARCHAR(20) DEFAULT NULL,
      client_name VARCHAR(255) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      attachment_path VARCHAR(500) DEFAULT NULL,
      call_date DATE NOT NULL,
      call_time TIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_calllog_rep FOREIGN KEY (sales_rep_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_calllog_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_calllog_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    )";
    try {
        $db->exec($sql);
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_rep_id ON call_logs (sales_rep_id)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_date ON call_logs (call_date)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_org ON call_logs (org_id)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_type ON call_logs (call_type)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_rep_date ON call_logs (sales_rep_id, call_date)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_calllog_org_date ON call_logs (org_id, call_date)');
    } catch (PDOException $e) {
        // Table exists / FK ordering — ignore for idempotent deploys
    }
    callLogsEnsureAttachmentColumn($db);
    $done = true;
}

ensureCallLogsTable($db);

/** Roles allowed to use call logs API */
function callLogsAllowedRole(string $role): bool
{
    return in_array($role, ['sales_representative', 'admin', 'super_admin', 'org', 'manager'], true);
}

function callLogsResolveOrgId(PDO $db, array $tokenData, string $userId): ?string
{
    $oid = $tokenData['org_id'] ?? null;
    if ($oid !== null && $oid !== '') {
        return trim((string) $oid);
    }
    $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $oid = $row['org_id'] ?? null;
    return ($oid !== null && $oid !== '') ? trim((string) $oid) : null;
}

/**
 * For admin/manager views:
 * - include assigned hierarchy members (self + downline)
 * - include unassigned same-org members (reports_to_id IS NULL) except admin/super_admin
 *
 * @return string[] user ids
 */
function callLogsVisibleOrgMemberIds(PDO $db, array $tokenData, string $userId, string $orgId): array
{
    $ids = [];
    try {
        $ids = hierarchyGetVisibleUserIds($db, $tokenData);
    } catch (Throwable $ignored) {
        $ids = [$userId];
    }
    if (empty($ids)) {
        $ids = [$userId];
    }

    try {
        $st = $db->prepare("
            SELECT id
            FROM users
            WHERE org_id = ?
              AND is_active = 1
              AND (reports_to_id IS NULL OR reports_to_id = '')
              AND LOWER(TRIM(role)) NOT IN ('admin', 'super_admin')
        ");
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $uid) {
            if (is_string($uid) && $uid !== '' && !in_array($uid, $ids, true)) {
                $ids[] = $uid;
            }
        }
    } catch (Throwable $ignored) {
    }

    return $ids;
}

/**
 * Pick an org_id that exists in table organizations. Tries JWT org, then logged-in user org, then rep org.
 * Avoids FK 1452 when the token carries a stale/deleted org id but users.org_id is valid.
 */
function callLogsResolveOrgIdForInsert(PDO $db, array $tokenData, string $loggedInUserId, string $repId): ?string
{
    $candidates = [];
    $t = isset($tokenData['org_id']) ? trim((string) $tokenData['org_id']) : '';
    if ($t !== '') {
        $candidates[] = $t;
    }
    foreach ([$loggedInUserId, $repId] as $uid) {
        $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$uid]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $oid = isset($row['org_id']) ? trim((string) $row['org_id']) : '';
        if ($oid !== '' && !in_array($oid, $candidates, true)) {
            $candidates[] = $oid;
        }
    }
    $verify = $db->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
    foreach ($candidates as $oid) {
        $verify->execute([$oid]);
        if ($verify->fetch()) {
            return $oid;
        }
    }
    return null;
}

/**
 * Scope SQL fragment for call_logs aliased as `cl`.
 *
 * @return array{0: string, 1: array}
 */
function callLogsScopeWhere(PDO $db, string $role, string $userId, array $tokenData): array
{
    $tokenOrgId = $tokenData['org_id'] ?? null;
    if ($role === 'super_admin') {
        if (!empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
            return ['cl.org_id = ?', [(string) $_GET['org_id']]];
        }
        return ['1=1', []];
    }
    if (in_array($role, ['admin', 'org', 'manager'], true)) {
        $orgId = ($tokenOrgId !== null && $tokenOrgId !== '') ? (string) $tokenOrgId : callLogsResolveOrgId($db, $tokenData, $userId);
        if ($orgId) {
            $ids = callLogsVisibleOrgMemberIds($db, $tokenData, $userId, $orgId);
            if (!empty($ids)) {
                $in = implode(',', array_fill(0, count($ids), '?'));
                return ["cl.org_id = ? AND cl.sales_rep_id IN ($in)", array_merge([$orgId], $ids)];
            }
            return ['cl.org_id = ? AND cl.sales_rep_id = ?', [$orgId, $userId]];
        }
        return ['(cl.org_id IS NULL OR cl.org_id = \'\')', []];
    }
    return ['cl.sales_rep_id = ?', [$userId]];
}

function callLogsPeriodBounds(string $period, ?string $dateFromIn, ?string $dateToIn): array
{
    $today = new DateTimeImmutable('today');
    $period = strtolower(trim($period));
    if ($period === 'custom' && $dateFromIn && $dateToIn) {
        return [$dateFromIn, $dateToIn];
    }
    if ($period === 'week') {
        $dow = (int) $today->format('N');
        $start = $today->modify('-' . ($dow - 1) . ' days');
        $end = $start->modify('+6 days');
        return [$start->format('Y-m-d'), $end->format('Y-m-d')];
    }
    if ($period === 'month') {
        $start = $today->modify('first day of this month');
        $end = $today->modify('last day of this month');
        return [$start->format('Y-m-d'), $end->format('Y-m-d')];
    }
    $d = $today->format('Y-m-d');
    return [$d, $d];
}

function callLogsPeriodLabel(string $period, string $dateFrom, string $dateTo): string
{
    $period = strtolower(trim($period));
    if ($period === 'today') {
        return $dateFrom === $dateTo
            ? (new DateTimeImmutable($dateFrom))->format('d M Y')
            : $dateFrom . ' – ' . $dateTo;
    }
    if ($period === 'week') {
        $a = new DateTimeImmutable($dateFrom);
        $b = new DateTimeImmutable($dateTo);
        if ($a->format('M Y') === $b->format('M Y')) {
            return $a->format('M j') . '–' . $b->format('j, Y');
        }
        return $a->format('M j') . ' – ' . $b->format('M j, Y');
    }
    if ($period === 'month') {
        return (new DateTimeImmutable($dateFrom))->format('M Y');
    }
    return $dateFrom === $dateTo ? (new DateTimeImmutable($dateFrom))->format('j M Y') : ($dateFrom . ' – ' . $dateTo);
}

function formatDurationSeconds(?int $total): string
{
    if ($total === null || $total <= 0) {
        return '-';
    }
    $h = intdiv($total, 3600);
    $m = intdiv($total % 3600, 60);
    $s = $total % 60;
    return sprintf('%02d:%02d:%02d', $h, $m, $s);
}

/** Sum duration helper row */
function callLogsSumDuration(PDO $db, string $whereSql, array $params, string $extraAnd = ''): int
{
    $sql = "SELECT COALESCE(SUM(cl.duration_seconds), 0) AS s FROM call_logs cl WHERE $whereSql $extraAnd";
    $st = $db->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return (int) ($row['s'] ?? 0);
}

/** Working hours: sum per-day (max-min) when 2+ timed calls that day */
function callLogsWorkingHoursSeconds(PDO $db, string $whereSql, array $params): ?int
{
    $sql = "SELECT COALESCE(SUM(day_sec), 0) AS wh FROM (
      SELECT call_date,
        CASE WHEN COUNT(*) >= 2 AND MIN(call_time) IS NOT NULL AND MAX(call_time) IS NOT NULL
          THEN TIMESTAMPDIFF(SECOND,
            MIN(TIMESTAMP(call_date, call_time)),
            MAX(TIMESTAMP(call_date, call_time)))
          ELSE 0 END AS day_sec
      FROM call_logs cl
      WHERE $whereSql AND cl.call_time IS NOT NULL
      GROUP BY call_date
    ) x";
    $st = $db->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $v = (int) ($row['wh'] ?? 0);
    return $v > 0 ? $v : null;
}

if (!callLogsAllowedRole($rawRole)) {
    respond(['error' => 'Access denied'], 403);
}

$tokenOrgId = $tokenData['org_id'] ?? null;

// ---------- GET daily_report_metrics — counts from call_logs (+ lead pipeline) for one day ----------
if ($method === 'GET' && $action === 'daily_report_metrics') {
    $date = trim((string) ($_GET['date'] ?? ''));
    if ($date === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        respond(['error' => 'date required (YYYY-MM-DD)'], 400);
    }
    [$scopeSql, $scopeParams] = callLogsScopeWhere($db, $rawRole, $userId, $tokenData);
    $whereFull = "$scopeSql AND cl.call_date = ?";
    $params = array_merge($scopeParams, [$date]);

    $sql = "
        SELECT
            COUNT(*) AS total_calls,
            COALESCE(SUM(CASE WHEN cl.call_type = 'missed' OR cl.call_status = 'never_attended' THEN 1 ELSE 0 END), 0) AS total_followups,
            COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(l.status, ''))) IN ('demo_scheduled', 'demo_attended') THEN 1 ELSE 0 END), 0) AS total_demos,
            COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(l.status, ''))) IN ('enrolled', 'converted') THEN 1 ELSE 0 END), 0) AS total_conversions,
            COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(l.status, ''))) IN ('new', 'contacted') THEN 1 ELSE 0 END), 0) AS new_leads_contacted,
            COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(l.status, ''))) = 'lost' THEN 1 ELSE 0 END), 0) AS total_lost
        FROM call_logs cl
        LEFT JOIN leads l ON l.id = cl.lead_id
        WHERE $whereFull
    ";
    $st = $db->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];

    respond([
        'success' => true,
        'metrics' => [
            'total_calls' => (int) ($row['total_calls'] ?? 0),
            'total_followups' => (int) ($row['total_followups'] ?? 0),
            'total_demos' => (int) ($row['total_demos'] ?? 0),
            'total_conversions' => (int) ($row['total_conversions'] ?? 0),
            'new_leads_contacted' => (int) ($row['new_leads_contacted'] ?? 0),
            'total_lost' => (int) ($row['total_lost'] ?? 0),
        ],
        'date' => $date,
    ]);
}

// ---------- POST add_log ----------
if ($method === 'POST' && $action === 'add_log') {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    $multipart = stripos($ct, 'multipart/form-data') !== false;
    $input = $multipart ? $_POST : getInput();
    $types = ['incoming', 'outgoing', 'missed', 'rejected'];
    $statuses = ['connected', 'never_attended', 'not_pickup_by_client'];
    $callType = $input['call_type'] ?? '';
    $callStatus = $input['call_status'] ?? 'connected';
    if (!in_array($callType, $types, true)) {
        respond(['error' => 'Invalid call_type'], 400);
    }
    if (!in_array($callStatus, $statuses, true)) {
        respond(['error' => 'Invalid call_status'], 400);
    }
    // Missed/rejected calls cannot be "connected" with talk time.
    if (in_array($callType, ['missed', 'rejected'], true) && $callStatus === 'connected') {
        respond(['error' => 'Missed/rejected calls cannot have status connected'], 400);
    }
    $callDate = trim((string) ($input['call_date'] ?? ''));
    if ($callDate === '') {
        respond(['error' => 'call_date required'], 400);
    }
    $duration = max(0, (int) ($input['duration_seconds'] ?? 0));
    if (in_array($callType, ['missed', 'rejected'], true) && $duration > 0) {
        $duration = 0;
    }
    if ($callStatus !== 'connected' && $duration > 0) {
        respond(['error' => 'Duration only applies when call status is connected'], 400);
    }
    $callTime = isset($input['call_time']) && $input['call_time'] !== '' ? $input['call_time'] : null;
    $leadId = isset($input['lead_id']) && $input['lead_id'] !== '' ? (string) $input['lead_id'] : null;

    $repId = $userId;
    if (in_array($rawRole, ['admin', 'super_admin', 'org', 'manager'], true) && !empty($input['sales_rep_id'])) {
        $repId = (string) $input['sales_rep_id'];
    }

    $orgId = callLogsResolveOrgIdForInsert($db, $tokenData, $userId, $repId);
    if ($orgId === null || $orgId === '') {
        respond([
            'error' => 'Organization required for call logs',
            'detail' => 'No valid organizations.id matches your account. An admin should set users.org_id to an existing organization, or create the missing organization row.',
        ], 400);
    }

    if ($repId !== $userId && in_array($rawRole, ['admin', 'org', 'manager'], true)) {
        $chk = $db->prepare('SELECT id FROM users WHERE id = ? AND org_id = ? LIMIT 1');
        $chk->execute([$repId, $orgId]);
        if (!$chk->fetch()) {
            respond(['error' => 'Invalid sales_rep_id for organization'], 400);
        }
    }
    if ($repId !== $userId && $rawRole === 'super_admin') {
        $chk = $db->prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
        $chk->execute([$repId]);
        if (!$chk->fetch()) {
            respond(['error' => 'Invalid sales_rep_id'], 400);
        }
    }

    $leadStatusIn = isset($input['lead_status']) ? trim((string) $input['lead_status']) : '';
    if ($leadStatusIn !== '' && $leadId === null) {
        respond(['error' => 'lead_status requires lead_id'], 400);
    }

    $clientName = isset($input['client_name']) ? trim((string) $input['client_name']) : null;
    $clientPhone = isset($input['client_phone']) ? trim((string) $input['client_phone']) : null;
    if ($clientName === '') {
        $clientName = null;
    }
    if ($clientPhone === '') {
        $clientPhone = null;
    }

    if ($leadId !== null) {
        $leadRow = syncpediaAssertLeadInScope($db, $tokenData, $leadId);
        $lfName = trim((string) ($leadRow['name'] ?? ''));
        $lfPhone = trim((string) ($leadRow['phone'] ?? ''));
        if ($lfName !== '') {
            $clientName = $lfName;
        }
        if ($lfPhone !== '') {
            $clientPhone = $lfPhone;
        }
    }

    $attachPath = null;
    if ($multipart) {
        foreach (['call_recording', 'recording'] as $fk) {
            if (!empty($_FILES[$fk]) && is_array($_FILES[$fk])) {
                $tryAttach = saveCallRecordingUpload($_FILES[$fk]);
                if ($tryAttach !== null) {
                    $attachPath = $tryAttach;
                    break;
                }
            }
        }
    }

    $rowVals = [
        $repId,
        $orgId,
        $leadId,
        $callType,
        $callStatus,
        $duration,
        $clientPhone,
        $clientName,
        $input['notes'] ?? null,
        $attachPath,
        $callDate,
        $callTime,
    ];

    // TIME column reads back as HH:MM:SS — pad HH:MM input so identical resubmits still match.
    $dupTime = $callTime;
    if (is_string($dupTime) && preg_match('/^\d{1,2}:\d{2}$/', $dupTime)) {
        $dupTime .= ':00';
    }

    $db->beginTransaction();
    try {
        // Serialize concurrent logs for the same lead (reduces double-insert races).
        if (is_string($leadId) && $leadId !== '') {
            $lock = $db->prepare('SELECT id FROM leads WHERE id = ? FOR UPDATE');
            $lock->execute([$leadId]);
        }
        $dupSt = $db->prepare(
            "SELECT id FROM call_logs
             WHERE sales_rep_id = ? AND org_id = ? AND call_date = ? AND call_type = ?
               AND COALESCE(lead_id, '') = COALESCE(?, '')
               AND COALESCE(client_phone, '') = COALESCE(?, '')
               AND COALESCE(call_time, '') = COALESCE(?, '')
               AND COALESCE(duration_seconds, 0) = ?
               AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
             LIMIT 1",
        );
        $dupSt->execute([$repId, $orgId, $callDate, $callType, $leadId, $clientPhone, $dupTime, $duration]);
        if ($dupSt->fetch(PDO::FETCH_ASSOC)) {
            $db->rollBack();
            respond(['error' => 'Duplicate call log — already logged in the last 2 minutes'], 409);
        }

        try {
            $stmt = $db->prepare('INSERT INTO call_logs (sales_rep_id, org_id, lead_id, call_type, call_status, duration_seconds, client_phone, client_name, notes, attachment_path, call_date, call_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            $stmt->execute($rowVals);
        } catch (PDOException $e) {
            $em = $e->getMessage();
            $missingAttachCol = stripos($em, 'attachment_path') !== false;
            if ($missingAttachCol) {
                callLogsEnsureAttachmentColumn($db);
                try {
                    $stmt = $db->prepare('INSERT INTO call_logs (sales_rep_id, org_id, lead_id, call_type, call_status, duration_seconds, client_phone, client_name, notes, attachment_path, call_date, call_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
                    $stmt->execute($rowVals);
                } catch (PDOException $eRetry) {
                    $emRetry = $eRetry->getMessage();
                    if ($attachPath !== null) {
                        $db->rollBack();
                        respond([
                            'error' => 'Could not save call log with recording',
                            'detail' => $emRetry . ' — run: ALTER TABLE call_logs ADD COLUMN attachment_path VARCHAR(500) NULL;',
                        ], 500);
                    }
                    try {
                        $stmt2 = $db->prepare('INSERT INTO call_logs (sales_rep_id, org_id, lead_id, call_type, call_status, duration_seconds, client_phone, client_name, notes, call_date, call_time) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
                        $stmt2->execute([
                            $repId,
                            $orgId,
                            $leadId,
                            $callType,
                            $callStatus,
                            $duration,
                            $clientPhone,
                            $clientName,
                            $input['notes'] ?? null,
                            $callDate,
                            $callTime,
                        ]);
                    } catch (PDOException $e2) {
                        $db->rollBack();
                        respond(['error' => 'Could not save call log', 'detail' => $e2->getMessage()], 500);
                    }
                }
            } else {
                $db->rollBack();
                respond(['error' => 'Could not save call log', 'detail' => $em], 500);
            }
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            try { $db->rollBack(); } catch (Throwable $ignored) {}
        }
        respond(['error' => 'Could not save call log', 'detail' => $e->getMessage()], 500);
    }
    $id = (int) $db->lastInsertId();

    if ($leadStatusIn !== '') {
        $err = leadsSyncPipelineStatusFromCallLog($db, $tokenData, $userId, $rawRole, (string) $leadId, $leadStatusIn);
        if ($err !== null) {
            try {
                $db->prepare('DELETE FROM call_logs WHERE id = ?')->execute([$id]);
            } catch (Throwable $ignored) {
            }
            respond(['error' => $err], 400);
        }
    }

    $q = $db->prepare('SELECT cl.*, u.full_name AS sales_rep_name, l.name AS lead_name, l.status AS lead_status FROM call_logs cl LEFT JOIN users u ON u.id = cl.sales_rep_id LEFT JOIN leads l ON l.id = cl.lead_id WHERE cl.id = ?');
    $q->execute([$id]);
    respond(['success' => true, 'log' => $q->fetch(PDO::FETCH_ASSOC)]);
}

// ---------- GET get_stats ----------
if ($method === 'GET' && $action === 'get_stats') {
    $period = $_GET['period'] ?? 'today';
    $dateFromIn = isset($_GET['date_from']) ? trim((string) $_GET['date_from']) : null;
    $dateToIn = isset($_GET['date_to']) ? trim((string) $_GET['date_to']) : null;
    [$df, $dt] = callLogsPeriodBounds($period, $dateFromIn, $dateToIn);

    [$scopeSql, $scopeParams] = callLogsScopeWhere($db, $rawRole, $userId, $tokenData);
    $dateSql = 'cl.call_date BETWEEN ? AND ?';
    $baseParams = array_merge($scopeParams, [$df, $dt]);
    $whereFull = "$scopeSql AND $dateSql";

    $totalCalls = 0;
    $st = $db->prepare("SELECT COUNT(*) AS c FROM call_logs cl WHERE $whereFull");
    $st->execute($baseParams);
    $totalCalls = (int) ($st->fetch()['c'] ?? 0);

    $sumDur = callLogsSumDuration($db, $whereFull, $baseParams);
    $incDur = callLogsSumDuration($db, $whereFull, $baseParams, "AND cl.call_type = 'incoming'");
    $outDur = callLogsSumDuration($db, $whereFull, $baseParams, "AND cl.call_type = 'outgoing'");

    $counts = static function (PDO $db, string $where, array $p, string $extra) {
        $sql = "SELECT COUNT(*) AS c FROM call_logs cl WHERE $where $extra";
        $s = $db->prepare($sql);
        $s->execute($p);
        return (int) ($s->fetch()['c'] ?? 0);
    };

    $incoming = $counts($db, $whereFull, $baseParams, "AND cl.call_type = 'incoming'");
    $outgoing = $counts($db, $whereFull, $baseParams, "AND cl.call_type = 'outgoing'");
    $missed = $counts($db, $whereFull, $baseParams, "AND cl.call_type = 'missed'");
    $rejected = $counts($db, $whereFull, $baseParams, "AND cl.call_type = 'rejected'");
    $neverAttended = $counts($db, $whereFull, $baseParams, "AND cl.call_status = 'never_attended'");
    $notPickup = $counts($db, $whereFull, $baseParams, "AND cl.call_status = 'not_pickup_by_client'");
    $connected = $counts($db, $whereFull, $baseParams, "AND cl.call_status = 'connected'");

    $uq = $db->prepare("SELECT COUNT(DISTINCT NULLIF(TRIM(cl.client_phone), '')) AS c FROM call_logs cl WHERE $whereFull AND cl.client_phone IS NOT NULL AND TRIM(cl.client_phone) <> ''");
    $uq->execute($baseParams);
    $uniqueClients = (int) ($uq->fetch()['c'] ?? 0);

    $whSec = callLogsWorkingHoursSeconds($db, $whereFull, $baseParams);

    respond([
        'success' => true,
        'stats' => [
            'total_calls' => $totalCalls,
            'call_duration' => formatDurationSeconds($sumDur),
            'incoming' => $incoming,
            'incoming_duration' => formatDurationSeconds($incDur),
            'outgoing' => $outgoing,
            'outgoing_duration' => formatDurationSeconds($outDur),
            'missed' => $missed,
            'rejected' => $rejected,
            'never_attended' => $neverAttended,
            'not_pickup_by_client' => $notPickup,
            'unique_clients' => $uniqueClients,
            'working_hours' => $whSec !== null ? formatDurationSeconds($whSec) : '-',
            'connected_calls' => $connected,
            'period_label' => callLogsPeriodLabel($period, $df, $dt),
        ],
        'period' => ['from' => $df, 'to' => $dt, 'key' => $period],
    ]);
}

// ---------- GET get_logs ----------
if ($method === 'GET' && $action === 'get_logs') {
    $period = $_GET['period'] ?? 'today';
    $dateFromIn = isset($_GET['date_from']) ? trim((string) $_GET['date_from']) : null;
    $dateToIn = isset($_GET['date_to']) ? trim((string) $_GET['date_to']) : null;
    [$df, $dt] = callLogsPeriodBounds($period, $dateFromIn, $dateToIn);

    [$scopeSql, $scopeParams] = callLogsScopeWhere($db, $rawRole, $userId, $tokenData);
    $whereFull = "$scopeSql AND cl.call_date BETWEEN ? AND ?";
    $params = array_merge($scopeParams, [$df, $dt]);

    if (!empty($_GET['call_type']) && in_array($_GET['call_type'], ['incoming', 'outgoing', 'missed', 'rejected'], true)) {
        $whereFull .= ' AND cl.call_type = ?';
        $params[] = $_GET['call_type'];
    }
    if (!empty($_GET['call_status']) && in_array($_GET['call_status'], ['connected', 'never_attended', 'not_pickup_by_client'], true)) {
        $whereFull .= ' AND cl.call_status = ?';
        $params[] = $_GET['call_status'];
    }

    $page = max(1, (int) ($_GET['page'] ?? 1));
    $limit = max(1, min(100, (int) ($_GET['limit'] ?? 25)));
    $offset = ($page - 1) * $limit;

    $cst = $db->prepare("SELECT COUNT(*) AS c FROM call_logs cl WHERE $whereFull");
    $cst->execute($params);
    $total = (int) ($cst->fetch()['c'] ?? 0);

    $lst = $db->prepare("SELECT cl.*, u.full_name AS sales_rep_name, l.name AS lead_name, l.status AS lead_status FROM call_logs cl LEFT JOIN users u ON u.id = cl.sales_rep_id LEFT JOIN leads l ON l.id = cl.lead_id WHERE $whereFull ORDER BY cl.call_date DESC, cl.id DESC LIMIT $limit OFFSET $offset");
    $lst->execute($params);

    respond([
        'success' => true,
        'logs' => $lst->fetchAll(PDO::FETCH_ASSOC),
        'total' => $total,
        'page' => $page,
        'limit' => $limit,
        'period' => [
            'from' => $df,
            'to' => $dt,
            'label' => callLogsPeriodLabel($period, $df, $dt),
            'key' => $period,
        ],
    ]);
}

// ---------- PUT / POST update_log (POST + multipart for file replace)
if (($method === 'PUT' && $action === 'update_log') || ($method === 'POST' && $action === 'update_log')) {
    $multipart = $method === 'POST' && stripos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') !== false;
    $input = $multipart ? $_POST : getInput();
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        respond(['error' => 'id required'], 400);
    }
    $sel = $db->prepare('SELECT * FROM call_logs WHERE id = ?');
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }

    $canEdit = false;
    if ($rawRole === 'super_admin') {
        $canEdit = true;
    } elseif (in_array($rawRole, ['admin', 'org', 'manager'], true)) {
        $orgId = callLogsResolveOrgId($db, $tokenData, $userId);
        $canEdit = $orgId && ($row['org_id'] === $orgId);
    } else {
        $canEdit = ($row['sales_rep_id'] === $userId);
    }
    if (!$canEdit) {
        respond(['error' => 'Forbidden'], 403);
    }

    $fields = [];
    $params = [];
    $allowed = ['call_type', 'call_status', 'duration_seconds', 'notes', 'call_date', 'call_time', 'lead_id'];
    $types = ['incoming', 'outgoing', 'missed', 'rejected'];
    $statuses = ['connected', 'never_attended', 'not_pickup_by_client'];
    $nextType = $row['call_type'] ?? '';
    $nextStatus = $row['call_status'] ?? '';
    $nextDuration = (int) ($row['duration_seconds'] ?? 0);
    foreach ($allowed as $f) {
        if (!array_key_exists($f, $input)) {
            continue;
        }
        if ($f === 'call_type') {
            $ct = (string) $input['call_type'];
            if (!in_array($ct, $types, true)) {
                respond(['error' => 'Invalid call_type'], 400);
            }
            $nextType = $ct;
            $fields[] = 'call_type = ?';
            $params[] = $ct;
            continue;
        }
        if ($f === 'call_status') {
            $cs = (string) $input['call_status'];
            if (!in_array($cs, $statuses, true)) {
                respond(['error' => 'Invalid call_status'], 400);
            }
            $nextStatus = $cs;
            $fields[] = 'call_status = ?';
            $params[] = $cs;
            continue;
        }
        if ($f === 'duration_seconds') {
            $nextDuration = max(0, (int) $input['duration_seconds']);
            $fields[] = 'duration_seconds = ?';
            $params[] = $nextDuration;
            continue;
        }
        if ($f === 'lead_id') {
            $lid = $input['lead_id'];
            if ($lid === null || $lid === '') {
                $fields[] = 'lead_id = NULL';
                $fields[] = 'client_name = NULL';
                $fields[] = 'client_phone = NULL';
            } else {
                $leadRow = syncpediaAssertLeadInScope($db, $tokenData, (string) $lid);
                $fields[] = 'lead_id = ?';
                $params[] = (string) $lid;
                $cn = isset($leadRow['name']) && trim((string) $leadRow['name']) !== '' ? trim((string) $leadRow['name']) : null;
                $cp = isset($leadRow['phone']) && trim((string) $leadRow['phone']) !== '' ? trim((string) $leadRow['phone']) : null;
                $fields[] = 'client_name = ?';
                $params[] = $cn;
                $fields[] = 'client_phone = ?';
                $params[] = $cp;
            }
            continue;
        }
        if ($f === 'call_time' && ($input[$f] === null || $input[$f] === '')) {
            $fields[] = 'call_time = NULL';
            continue;
        }
        $fields[] = "$f = ?";
        $params[] = $input[$f];
    }

    if (in_array($nextType, ['missed', 'rejected'], true) && $nextStatus === 'connected') {
        respond(['error' => 'Missed/rejected calls cannot have status connected'], 400);
    }
    if ($nextStatus !== 'connected' && $nextDuration > 0) {
        respond(['error' => 'Duration only applies when call status is connected'], 400);
    }
    if (in_array($nextType, ['missed', 'rejected'], true) && $nextDuration > 0) {
        $fields[] = 'duration_seconds = ?';
        $params[] = 0;
        $nextDuration = 0;
    }

    $resLeadId = $row['lead_id'] ?? null;
    if (array_key_exists('lead_id', $input)) {
        $lidRaw = $input['lead_id'];
        if ($lidRaw === null || $lidRaw === '') {
            $resLeadId = null;
        } else {
            $resLeadId = (string) $lidRaw;
        }
    }
    $scopedLeadRow = null;
    if ($resLeadId !== null && $resLeadId !== '') {
        $scopedLeadRow = syncpediaAssertLeadInScope($db, $tokenData, (string) $resLeadId);
    }
    if ($scopedLeadRow && !array_key_exists('lead_id', $input)) {
        $cn = isset($scopedLeadRow['name']) && trim((string) $scopedLeadRow['name']) !== '' ? trim((string) $scopedLeadRow['name']) : null;
        $cp = isset($scopedLeadRow['phone']) && trim((string) $scopedLeadRow['phone']) !== '' ? trim((string) $scopedLeadRow['phone']) : null;
        $fields[] = 'client_name = ?';
        $params[] = $cn;
        $fields[] = 'client_phone = ?';
        $params[] = $cp;
    }

    $leadStatusIn = array_key_exists('lead_status', $input) ? trim((string) $input['lead_status']) : '';

    if ($leadStatusIn !== '' && $scopedLeadRow && empty($fields)) {
        $cn = isset($scopedLeadRow['name']) && trim((string) $scopedLeadRow['name']) !== '' ? trim((string) $scopedLeadRow['name']) : null;
        $cp = isset($scopedLeadRow['phone']) && trim((string) $scopedLeadRow['phone']) !== '' ? trim((string) $scopedLeadRow['phone']) : null;
        $fields[] = 'client_name = ?';
        $params[] = $cn;
        $fields[] = 'client_phone = ?';
        $params[] = $cp;
    }

    if ($multipart) {
        foreach (['call_recording', 'recording'] as $fk) {
            if (empty($_FILES[$fk]) || !is_array($_FILES[$fk])) {
                continue;
            }
            $saved = saveCallRecordingUpload($_FILES[$fk]);
            if ($saved !== null) {
                deleteCallRecordingIfExists($row['attachment_path'] ?? null);
                $fields[] = 'attachment_path = ?';
                $params[] = $saved;
                break;
            }
        }
    }

    if (!$fields && $leadStatusIn === '') {
        respond(['error' => 'Nothing to update'], 400);
    }
    if ($leadStatusIn !== '' && ($resLeadId === null || $resLeadId === '')) {
        respond(['error' => 'lead_status requires a linked lead'], 400);
    }

    if ($fields) {
        $params[] = $id;
        $sql = 'UPDATE call_logs SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $db->prepare($sql)->execute($params);
    }

    if ($leadStatusIn !== '') {
        $err = leadsSyncPipelineStatusFromCallLog($db, $tokenData, $userId, $rawRole, (string) $resLeadId, $leadStatusIn);
        if ($err !== null) {
            respond(['error' => $err], 400);
        }
    }

    respond(['success' => true, 'message' => 'Updated']);
}

// ---------- DELETE delete_log ----------
if ($method === 'DELETE' && $action === 'delete_log') {
    $input = getInput();
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        respond(['error' => 'id required'], 400);
    }
    $sel = $db->prepare('SELECT * FROM call_logs WHERE id = ?');
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    $canDel = false;
    if ($rawRole === 'super_admin') {
        $canDel = true;
    } elseif (in_array($rawRole, ['admin', 'org', 'manager'], true)) {
        $orgId = callLogsResolveOrgId($db, $tokenData, $userId);
        $canDel = $orgId && ($row['org_id'] === $orgId);
    } else {
        $canDel = ($row['sales_rep_id'] === $userId);
    }
    if (!$canDel) {
        respond(['error' => 'Forbidden'], 403);
    }
    deleteCallRecordingIfExists($row['attachment_path'] ?? null);
    $db->prepare('DELETE FROM call_logs WHERE id = ?')->execute([$id]);
    respond(['success' => true, 'message' => 'Deleted']);
}

respond(['error' => 'Invalid action'], 400);
