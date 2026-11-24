<?php
/**
 * Read-only feed for the Syncpedia admin hub (app.syncpedia.in/admin).
 *
 * GET ?action=summary              lead totals and stage counts
 * GET ?action=leads&limit=300      latest leads with owner and next follow-up
 *
 * Auth: header X-Admin-Feed-Key must equal CRM_ADMIN_FEED_KEY (env var or config.php
 * constant, at least 32 characters). Anything else gets a plain 404, so the endpoint
 * doesn't advertise itself. Optional CRM_ADMIN_FEED_ORG_ID limits results to one org.
 *
 * Safety: GET only, rate limited, and every query runs inside a READ ONLY transaction,
 * so this file can never change CRM data.
 */
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/helpers.php';

syncpediaSecurityHeaders();

function adminFeedNotFound(): void
{
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
    exit;
}

function adminFeedSetting(string $name): string
{
    $v = getenv($name);
    if ($v !== false && trim((string) $v) !== '') {
        return trim((string) $v);
    }
    if (defined($name)) {
        return trim((string) constant($name));
    }
    return '';
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    adminFeedNotFound();
}

$expected = adminFeedSetting('CRM_ADMIN_FEED_KEY');
$given = trim((string) ($_SERVER['HTTP_X_ADMIN_FEED_KEY'] ?? ''));
if (strlen($expected) < 32 || $given === '' || !hash_equals($expected, $given)) {
    syncpediaRateLimitConsume('admin_feed_denied', 30, 900);
    adminFeedNotFound();
}

syncpediaRateLimitConsume('admin_feed', 240, 900);

$db = (new Database())->getConnection();
$orgId = adminFeedSetting('CRM_ADMIN_FEED_ORG_ID');
$action = trim((string) ($_GET['action'] ?? 'summary'));

try {
    if (syncpediaDbDriver() === 'mysql') {
        $db->exec('SET SESSION TRANSACTION READ ONLY');
        $db->exec('START TRANSACTION READ ONLY');
    } else {
        $db->exec('BEGIN TRANSACTION READ ONLY');
    }

    $orgSql = $orgId !== '' ? ' AND l.org_id = :org' : '';
    $bind = function (PDOStatement $st) use ($orgId): void {
        if ($orgId !== '') {
            $st->bindValue(':org', $orgId);
        }
    };

    if ($action === 'summary') {
        $st = $db->prepare("SELECT COUNT(*) AS total,
                SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS week
            FROM leads l WHERE 1=1{$orgSql}");
        $bind($st);
        $st->execute();
        $totals = $st->fetch() ?: ['total' => 0, 'week' => 0];

        $st = $db->prepare("SELECT l.status, COUNT(*) AS c FROM leads l WHERE 1=1{$orgSql} GROUP BY l.status");
        $bind($st);
        $st->execute();
        $byStatus = [];
        foreach ($st->fetchAll() as $r) {
            $byStatus[(string) $r['status']] = (int) $r['c'];
        }
        $db->exec('COMMIT');
        echo json_encode([
            'ok' => true,
            'total' => (int) ($totals['total'] ?? 0),
            'week' => (int) ($totals['week'] ?? 0),
            'byStatus' => $byStatus,
        ]);
        exit;
    }

    if ($action === 'leads') {
        $limit = max(1, min(500, (int) ($_GET['limit'] ?? 300)));
        $st = $db->prepare("SELECT l.id, l.name, l.email, l.phone, l.college, l.year_of_study, l.course_interest,
                l.source, l.source_label, l.status, l.next_follow_up, l.created_at, u.full_name AS owner
            FROM leads l
            LEFT JOIN users u ON u.id = l.assigned_to
            WHERE 1=1{$orgSql}
            ORDER BY l.created_at DESC
            LIMIT {$limit}");
        $bind($st);
        $st->execute();
        $rows = $st->fetchAll();
        $db->exec('COMMIT');
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => (string) $r['id'],
                'name' => (string) ($r['name'] ?? ''),
                'email' => (string) ($r['email'] ?? ''),
                'phone' => (string) ($r['phone'] ?? ''),
                'college' => (string) ($r['college'] ?? ''),
                'year' => (string) ($r['year_of_study'] ?? ''),
                'courseInterest' => (string) ($r['course_interest'] ?? ''),
                'source' => (string) ($r['source'] ?? ''),
                'sourceLabel' => (string) ($r['source_label'] ?? ''),
                'status' => (string) ($r['status'] ?? ''),
                'nextFollowUp' => $r['next_follow_up'] ? (string) $r['next_follow_up'] : null,
                'owner' => (string) ($r['owner'] ?? ''),
                'createdAt' => (string) ($r['created_at'] ?? ''),
            ];
        }
        echo json_encode(['ok' => true, 'leads' => $out]);
        exit;
    }

    $db->exec('ROLLBACK');
    adminFeedNotFound();
} catch (Throwable $e) {
    try {
        $db->exec('ROLLBACK');
    } catch (Throwable $ignored) {
    }
    error_log('[admin-feed] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Feed unavailable']);
    exit;
}
