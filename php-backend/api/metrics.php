<?php
/**
 * One definition for the headline numbers shown on dashboards.
 *
 * GET /api/metrics.php?action=summary[&org_id=...]
 *   super_admin: all organizations, or one org via org_id
 *   org:         own organization only (org_id ignored)
 *
 * Definitions (documented once, here):
 *   leads_total   every lead row in scope (deleted leads live in trash_items, not here)
 *   by_status     lead count per normalized status; the values sum to leads_total
 *   unassigned    leads with no assigned_to
 *   enrolled      leads whose CRM status is enrolled/converted (the only source of truth)
 *   registered    students with no course and no batch yet (registration fee only)
 *   students_enrolled  students with a course or batch
 *   collected / outstanding  sum of Payment Records candidate totals (same math as that page)
 *   active_users  users with is_active = 1, excluding test/reviewer accounts
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
requireRole($tokenData, ['super_admin', 'org']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$orgId = null;
if ($role === 'super_admin') {
    $req = trim((string) ($_GET['org_id'] ?? ''));
    if ($req !== '' && $req !== 'all') {
        $orgId = $req;
    }
} else {
    $orgId = trim((string) ($tokenData['org_id'] ?? ''));
    if ($orgId === '') {
        respond(['error' => 'Organization required'], 403);
    }
}

/** @return array{0: string, 1: array<int, string>} */
function metricsOrgWhere(?string $orgId, string $col = 'org_id'): array
{
    return $orgId === null ? ['1=1', []] : ["{$col} = ?", [$orgId]];
}

function metricsCount(PDO $db, string $sql, array $params): int
{
    try {
        $st = $db->prepare($sql);
        $st->execute($params);
        return (int) $st->fetchColumn();
    } catch (Throwable $e) {
        error_log('[metrics] ' . $e->getMessage());
        return 0;
    }
}

$action = $_GET['action'] ?? 'summary';
if ($action !== 'summary') {
    respond(['error' => 'Unknown action'], 400);
}

[$w, $p] = metricsOrgWhere($orgId);

// ── Leads ───────────────────────────────────────────────────────────────
$byStatus = [];
try {
    $st = $db->prepare(
        "SELECT LOWER(TRIM(COALESCE(NULLIF(status, ''), 'new'))) AS s, COUNT(*) AS c
           FROM leads WHERE {$w} GROUP BY s"
    );
    $st->execute($p);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $key = (string) $r['s'];
        if ($key === 'converted') {
            $key = 'enrolled';
        }
        $byStatus[$key] = ($byStatus[$key] ?? 0) + (int) $r['c'];
    }
} catch (Throwable $e) {
    error_log('[metrics] by_status: ' . $e->getMessage());
}
$leadsTotal = array_sum($byStatus);
$enrolled = (int) ($byStatus['enrolled'] ?? 0);
$lost = (int) ($byStatus['lost'] ?? 0);
$new = (int) ($byStatus['new'] ?? 0);
$unassigned = metricsCount(
    $db,
    "SELECT COUNT(*) FROM leads WHERE {$w} AND (assigned_to IS NULL OR assigned_to = '')",
    $p,
);

// Unassigned aging buckets (how long leads wait for an owner)
$aging = ['0_2d' => 0, '3_7d' => 0, '8_30d' => 0, '30d_plus' => 0];
try {
    $st = $db->prepare(
        "SELECT
            SUM(created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)) AS a,
            SUM(created_at < DATE_SUB(NOW(), INTERVAL 2 DAY) AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS b,
            SUM(created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS c,
            SUM(created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)) AS d
           FROM leads WHERE {$w} AND (assigned_to IS NULL OR assigned_to = '')"
    );
    $st->execute($p);
    $r = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $aging = [
        '0_2d' => (int) ($r['a'] ?? 0),
        '3_7d' => (int) ($r['b'] ?? 0),
        '8_30d' => (int) ($r['c'] ?? 0),
        '30d_plus' => (int) ($r['d'] ?? 0),
    ];
} catch (Throwable $e) {
    error_log('[metrics] aging: ' . $e->getMessage());
}

// Leads by source (top 8 + Other)
$bySource = [];
try {
    $st = $db->prepare(
        "SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS src, COUNT(*) AS c
           FROM leads WHERE {$w} GROUP BY src ORDER BY c DESC"
    );
    $st->execute($p);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $other = 0;
    foreach ($rows as $i => $r) {
        if ($i < 8) {
            $bySource[] = ['source' => (string) $r['src'], 'count' => (int) $r['c']];
        } else {
            $other += (int) $r['c'];
        }
    }
    if ($other > 0) {
        $bySource[] = ['source' => 'Other', 'count' => $other];
    }
} catch (Throwable $e) {
    error_log('[metrics] by_source: ' . $e->getMessage());
}

// New leads per week, oldest → newest (last 12 weeks)
$leadsByWeek = [];
try {
    $st = $db->prepare(
        "SELECT YEARWEEK(created_at, 3) AS yw, MIN(DATE(created_at)) AS d, COUNT(*) AS c
           FROM leads WHERE {$w} AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
          GROUP BY yw ORDER BY yw ASC"
    );
    $st->execute($p);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $leadsByWeek[] = ['week_start' => (string) $r['d'], 'count' => (int) $r['c']];
    }
} catch (Throwable $e) {
    error_log('[metrics] by_week: ' . $e->getMessage());
}

// ── Students (registration vs enrollment) ───────────────────────────────
$registered = metricsCount(
    $db,
    "SELECT COUNT(*) FROM students WHERE {$w}
        AND (course_id IS NULL OR course_id = '') AND (batch_id IS NULL OR batch_id = '')",
    $p,
);
$studentsTotal = metricsCount($db, "SELECT COUNT(*) FROM students WHERE {$w}", $p);

// ── Payments (identical math to Payment Records) ────────────────────────
$collected = 0.0;
$outstanding = 0.0;
$candidates = 0;
try {
    require_once __DIR__ . '/lib/PaymentCandidates.php';
    $st = $db->prepare("SELECT * FROM payment_candidates WHERE {$w}");
    $st->execute($p);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $cand) {
        $candidates++;
        try {
            $t = paymentCandidatesComputeTotals($db, $cand);
            $collected += (float) ($t['total_paid'] ?? 0);
            $outstanding += max(0.0, (float) ($t['remaining'] ?? 0));
        } catch (Throwable $e) {
            // skip one bad row rather than failing the summary
        }
    }
} catch (Throwable $e) {
    error_log('[metrics] payments: ' . $e->getMessage());
}

$pendingApprovals = metricsCount(
    $db,
    "SELECT COUNT(*) FROM manual_payments WHERE {$w} AND status = 'pending'",
    $p,
);

// ── Users ───────────────────────────────────────────────────────────────
$activeUsers = metricsCount(
    $db,
    "SELECT COUNT(*) FROM users WHERE {$w} AND is_active = 1
        AND LOWER(COALESCE(email, '')) NOT LIKE 'reviewer@%'
        AND LOWER(TRIM(COALESCE(role, ''))) <> 'super_admin'",
    $p,
);

respond([
    'success' => true,
    'data' => [
        'scope' => $orgId ?? 'all',
        'as_of' => gmdate('c'),
        'leads_total' => $leadsTotal,
        'by_status' => $byStatus,
        'new' => $new,
        'in_pipeline' => max(0, $leadsTotal - $new - $enrolled - $lost),
        'enrolled' => $enrolled,
        'lost' => $lost,
        'unassigned' => $unassigned,
        'unassigned_aging' => $aging,
        'by_source' => $bySource,
        'leads_by_week' => $leadsByWeek,
        'students_total' => $studentsTotal,
        'registered' => $registered,
        'students_enrolled' => max(0, $studentsTotal - $registered),
        'payment_candidates' => $candidates,
        'collected' => round($collected, 2),
        'outstanding' => round($outstanding, 2),
        'pending_approvals' => $pendingApprovals,
        'active_users' => $activeUsers,
    ],
]);
