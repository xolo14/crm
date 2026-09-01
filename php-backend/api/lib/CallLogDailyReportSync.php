<?php
/**
 * Keep daily_reports metric columns in sync with call_logs for a user + date.
 * Creates a report when the first call exists; updates metrics on later changes.
 * Preserves summary / challenges / lead_updates when updating.
 */

function syncpediaEnsureDailyReportsLostColumn(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (function_exists('syncpediaSkipRuntimeDdl') && syncpediaSkipRuntimeDdl($db)) {
            $done = true;
            return;
        }
        $dbName = $db->query('SELECT DATABASE()')->fetchColumn();
        if ($dbName === false || $dbName === '') {
            $done = true;
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

/** @return array{total_calls:int,total_followups:int,total_demos:int,total_conversions:int,new_leads_contacted:int,total_lost:int} */
function syncpediaCallLogDayMetricsForRep(PDO $db, string $salesRepId, string $callDate): array
{
    $empty = [
        'total_calls' => 0,
        'total_followups' => 0,
        'total_demos' => 0,
        'total_conversions' => 0,
        'new_leads_contacted' => 0,
        'total_lost' => 0,
    ];
    if ($salesRepId === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $callDate)) {
        return $empty;
    }

    $useSnapshot = false;
    try {
        if (function_exists('syncpediaColumnExists')) {
            $useSnapshot = syncpediaColumnExists($db, 'call_logs', 'pipeline_status_at_call');
        }
    } catch (Throwable $ignored) {
    }

    $pipelineStatus = $useSnapshot
        ? "LOWER(TRIM(COALESCE(cl.pipeline_status_at_call, l.status, '')))"
        : "LOWER(TRIM(COALESCE(l.status, '')))";

    $sql = "
        SELECT
            COUNT(*) AS total_calls,
            COALESCE(SUM(CASE WHEN cl.call_type = 'missed' OR cl.call_status = 'never_attended' THEN 1 ELSE 0 END), 0) AS total_followups,
            COUNT(DISTINCT CASE WHEN cl.lead_id IS NOT NULL AND $pipelineStatus IN ('demo_scheduled', 'demo_attended') THEN cl.lead_id END) AS total_demos,
            COUNT(DISTINCT CASE WHEN cl.lead_id IS NOT NULL AND $pipelineStatus IN ('enrolled', 'converted') THEN cl.lead_id END) AS total_conversions,
            COUNT(DISTINCT CASE WHEN cl.lead_id IS NOT NULL AND $pipelineStatus IN ('new', 'contacted') THEN cl.lead_id END) AS new_leads_contacted,
            COUNT(DISTINCT CASE WHEN cl.lead_id IS NOT NULL AND $pipelineStatus = 'lost' THEN cl.lead_id END) AS total_lost
        FROM call_logs cl
        LEFT JOIN leads l ON l.id = cl.lead_id
        WHERE cl.sales_rep_id = ? AND cl.call_date = ?
    ";
    try {
        $st = $db->prepare($sql);
        $st->execute([$salesRepId, $callDate]);
        $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        return $empty;
    }

    return [
        'total_calls' => (int) ($row['total_calls'] ?? 0),
        'total_followups' => (int) ($row['total_followups'] ?? 0),
        'total_demos' => (int) ($row['total_demos'] ?? 0),
        'total_conversions' => (int) ($row['total_conversions'] ?? 0),
        'new_leads_contacted' => (int) ($row['new_leads_contacted'] ?? 0),
        'total_lost' => (int) ($row['total_lost'] ?? 0),
    ];
}

/**
 * Upsert daily_reports metrics for sales_rep_id + call_date from that day's call_logs.
 * No-op create when there are zero calls (updates existing report metrics to zero if present).
 */
function syncpediaSyncDailyReportFromCallLogs(
    PDO $db,
    string $salesRepId,
    string $callDate,
    ?string $orgId = null
): void {
    $salesRepId = trim($salesRepId);
    $callDate = substr(trim($callDate), 0, 10);
    if ($salesRepId === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $callDate)) {
        return;
    }

    try {
        syncpediaEnsureDailyReportsLostColumn($db);
    } catch (Throwable $ignored) {
    }

    $m = syncpediaCallLogDayMetricsForRep($db, $salesRepId, $callDate);

    if ($orgId === null || trim($orgId) === '') {
        try {
            $u = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
            $u->execute([$salesRepId]);
            $orgId = trim((string) ($u->fetchColumn() ?: ''));
            if ($orgId === '') {
                $orgId = null;
            }
        } catch (Throwable $ignored) {
            $orgId = null;
        }
    } else {
        $orgId = trim($orgId);
        if ($orgId === '') {
            $orgId = null;
        }
    }

    try {
        $sel = $db->prepare('SELECT id FROM daily_reports WHERE user_id = ? AND report_date = ? LIMIT 1');
        $sel->execute([$salesRepId, $callDate]);
        $existingId = $sel->fetchColumn();
    } catch (Throwable $e) {
        return;
    }

    if (!$existingId) {
        if ($m['total_calls'] <= 0) {
            return;
        }
        $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
        try {
            if ($orgId !== null) {
                $ins = $db->prepare(
                    'INSERT INTO daily_reports (id, user_id, report_date, total_calls, total_followups, total_demos, total_conversions, new_leads_contacted, total_lost, lead_updates, summary, challenges, org_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)'
                );
                $ins->execute([
                    $id,
                    $salesRepId,
                    $callDate,
                    $m['total_calls'],
                    $m['total_followups'],
                    $m['total_demos'],
                    $m['total_conversions'],
                    $m['new_leads_contacted'],
                    $m['total_lost'],
                    '[]',
                    $orgId,
                ]);
            } else {
                $ins = $db->prepare(
                    'INSERT INTO daily_reports (id, user_id, report_date, total_calls, total_followups, total_demos, total_conversions, new_leads_contacted, total_lost, lead_updates, summary, challenges)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)'
                );
                $ins->execute([
                    $id,
                    $salesRepId,
                    $callDate,
                    $m['total_calls'],
                    $m['total_followups'],
                    $m['total_demos'],
                    $m['total_conversions'],
                    $m['new_leads_contacted'],
                    $m['total_lost'],
                    '[]',
                ]);
            }
        } catch (Throwable $e) {
            // Unique race: another request inserted — fall through to update
            try {
                $sel->execute([$salesRepId, $callDate]);
                $existingId = $sel->fetchColumn();
            } catch (Throwable $ignored) {
                return;
            }
            if (!$existingId) {
                return;
            }
        }
    }

    if ($existingId) {
        try {
            if ($orgId !== null) {
                $upd = $db->prepare(
                    'UPDATE daily_reports SET
                        total_calls = ?, total_followups = ?, total_demos = ?, total_conversions = ?,
                        new_leads_contacted = ?, total_lost = ?, org_id = ?
                     WHERE id = ?'
                );
                $upd->execute([
                    $m['total_calls'],
                    $m['total_followups'],
                    $m['total_demos'],
                    $m['total_conversions'],
                    $m['new_leads_contacted'],
                    $m['total_lost'],
                    $orgId,
                    $existingId,
                ]);
            } else {
                $upd = $db->prepare(
                    'UPDATE daily_reports SET
                        total_calls = ?, total_followups = ?, total_demos = ?, total_conversions = ?,
                        new_leads_contacted = ?, total_lost = ?
                     WHERE id = ?'
                );
                $upd->execute([
                    $m['total_calls'],
                    $m['total_followups'],
                    $m['total_demos'],
                    $m['total_conversions'],
                    $m['new_leads_contacted'],
                    $m['total_lost'],
                    $existingId,
                ]);
            }
        } catch (Throwable $ignored) {
        }
    }
}
