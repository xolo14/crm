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

/**
 * Scope clause. "All organizations" still only counts rows whose org exists, so the
 * all-org total always equals the sum of the per-org rows on Organizations.
 *
 * @return array{0: string, 1: array<int, string>}
 */
function metricsOrgWhere(?string $orgId, string $col = 'org_id'): array
{
    return $orgId === null
        ? ["{$col} IN (SELECT id FROM organizations)", []]
        : ["{$col} = ?", [$orgId]];
}

/** Human label for a raw leads.source key. */
function metricsSourceLabel(PDO $db, string $key, array &$cache): string
{
    $k = trim($key);
    if (isset($cache[$k])) {
        return $cache[$k];
    }
    $lower = strtolower($k);
    $label = $k;
    if ($lower === '' || $lower === 'unknown') {
        $label = 'Unknown';
    } elseif (in_array($lower, ['other', 'import', 'imported', 'csv', 'bulk_import'], true)) {
        $label = 'Imports';
    } elseif (in_array($lower, ['facebook', 'meta', 'meta_ads', 'fb', 'instagram'], true) || preg_match('/^\d{10,}$/', $k)) {
        $label = 'Meta Ads';
    } elseif (strpos($lower, 'form_') === 0) {
        $slug = substr($k, 5);
        $name = '';
        try {
            $st = $db->prepare('SELECT name FROM lead_forms WHERE slug = ? LIMIT 1');
            $st->execute([$slug]);
            $name = trim((string) $st->fetchColumn());
        } catch (Throwable $e) {
        }
        $label = 'Form · ' . ($name !== '' ? $name : ucwords(str_replace(['-', '_'], ' ', $slug)));
    } elseif (strpos($lower, 'peaklyy:') === 0) {
        $id = substr($k, 8);
        $title = '';
        try {
            $st = $db->prepare('SELECT title FROM peaklyy_assessments WHERE id = ? LIMIT 1');
            $st->execute([$id]);
            $title = trim((string) $st->fetchColumn());
        } catch (Throwable $e) {
        }
        $label = 'Assignment · ' . ($title !== '' ? $title : 'Peaklyy');
    } else {
        $label = ucwords(str_replace(['_', '-'], ' ', $k));
    }
    $label = trim((string) preg_replace('/[\x{200B}-\x{200F}\x{2060}\x{FEFF}]/u', '', $label));
    $cache[$k] = $label;
    return $label;
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
// Lead counts follow the same visibility as the Leads page (see SYNCPEDIA_HIDE_OM_IMPORTS).
$omHide = syncpediaHiddenOmImportsSql($tokenData, '');
$wl = $w . $omHide['sql'];
$pl = array_merge($p, $omHide['params']);

// ── Leads ───────────────────────────────────────────────────────────────
$byStatus = [];
try {
    $st = $db->prepare(
        "SELECT LOWER(TRIM(COALESCE(NULLIF(status, ''), 'new'))) AS s, COUNT(*) AS c
           FROM leads WHERE {$wl} GROUP BY s"
    );
    $st->execute($pl);
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
$registeredLeads = (int) ($byStatus['registered'] ?? 0);
$unassigned = metricsCount(
    $db,
    "SELECT COUNT(*) FROM leads WHERE {$wl} AND (assigned_to IS NULL OR assigned_to = '')",
    $pl,
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
           FROM leads WHERE {$wl} AND (assigned_to IS NULL OR assigned_to = '')"
    );
    $st->execute($pl);
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
           FROM leads WHERE {$wl} GROUP BY src ORDER BY c DESC"
    );
    $st->execute($pl);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $labelCache = [];
    $merged = [];
    foreach ($rows as $r) {
        $label = metricsSourceLabel($db, (string) $r['src'], $labelCache);
        $merged[$label] = ($merged[$label] ?? 0) + (int) $r['c'];
    }
    arsort($merged);
    $other = 0;
    $i = 0;
    foreach ($merged as $label => $c) {
        if ($i++ < 8) {
            $bySource[] = ['source' => (string) $label, 'count' => (int) $c];
        } else {
            $other += (int) $c;
        }
    }
    if ($other > 0) {
        $bySource[] = ['source' => 'All other sources', 'count' => $other];
    }
} catch (Throwable $e) {
    error_log('[metrics] by_source: ' . $e->getMessage());
}

// New leads per week, oldest → newest (last 12 weeks)
$leadsByWeek = [];
try {
    $thisMonday = new DateTimeImmutable('monday this week');
    $firstMonday = $thisMonday->modify('-11 weeks');
    $counts = [];
    $st = $db->prepare(
        "SELECT DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY) AS wk, COUNT(*) AS c
           FROM leads WHERE {$wl} AND created_at >= ?
          GROUP BY wk"
    );
    $st->execute(array_merge($pl, [$firstMonday->format('Y-m-d 00:00:00')]));
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $counts[(string) $r['wk']] = (int) $r['c'];
    }
    for ($i = 0; $i < 12; $i++) {
        $wk = $firstMonday->modify("+{$i} weeks")->format('Y-m-d');
        $leadsByWeek[] = ['week_start' => $wk, 'count' => $counts[$wk] ?? 0, 'partial' => $i === 11];
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
$pitchTotal = 0.0;
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
            $pitchTotal += (float) ($t['pitch_price'] ?? 0);
        } catch (Throwable $e) {
            // skip one bad row rather than failing the summary
        }
    }
} catch (Throwable $e) {
    error_log('[metrics] payments: ' . $e->getMessage());
}

// Same identity Payment Records shows: Remaining = total pitch − total collected.
$outstanding = $pitchTotal - $collected;

$pendingApprovals = metricsCount(
    $db,
    "SELECT COUNT(*) FROM manual_payments WHERE {$w} AND status = 'pending'",
    $p,
);

// ── Users ───────────────────────────────────────────────────────────────
$activeUsers = metricsCount(
    $db,
    "SELECT COUNT(*) FROM users WHERE {$w} AND " . syncpediaActiveUserSql(),
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
        // new + in_pipeline + registered_leads + enrolled + lost = leads_total
        'in_pipeline' => max(0, $leadsTotal - $new - $registeredLeads - $enrolled - $lost),
        'registered_leads' => $registeredLeads,
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
        'pitch_total' => round($pitchTotal, 2),
        'collected' => round($collected, 2),
        'outstanding' => round($outstanding, 2),
        'pending_approvals' => $pendingApprovals,
        'active_users' => $activeUsers,
    ],
]);
