<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];

$TRASH_TYPE_TO_TABLE = [
    'lead' => 'leads',
    'student' => 'students',
    'contact' => 'contacts',
    'deal' => 'deals',
    'task' => 'tasks',
    'course' => 'courses',
    'batch' => 'batches',
    'payment' => 'payments',
    'holiday' => 'holidays',
    'lead_assignment' => 'lead_assignments',
];

function trashResolveTable(string $entityType, array $map): string {
    if (!isset($map[$entityType])) {
        throw new InvalidArgumentException('Unknown entity type');
    }
    return $map[$entityType];
}

function trashRestoreRow(PDO $db, array $trashRow, array $typeMap): void {
    $table = trashResolveTable($trashRow['entity_type'], $typeMap);
    if (!in_array($table, trashAllowedTables(), true)) {
        throw new RuntimeException('Restore not allowed for this type');
    }
    $payload = json_decode($trashRow['payload'], true);
    if (!is_array($payload)) {
        throw new RuntimeException('Invalid archived payload');
    }
    // MySQL (phpMyAdmin / Hostinger): TABLE_SCHEMA = DATABASE()
    // PostgreSQL: current_schema() — never hardcode 'public' (returns 0 rows on MySQL).
    $allowed = syncpediaTableColumns($db, $table);
    if ($allowed === []) {
        throw new RuntimeException('Restore failed: could not read columns for ' . $table);
    }
    $use = [];
    foreach ($allowed as $c) {
        if (array_key_exists($c, $payload)) {
            $val = $payload[$c];
            // JSON columns may arrive as arrays after json_decode of the archive.
            if (is_array($val) || is_object($val)) {
                $val = json_encode($val, JSON_UNESCAPED_UNICODE);
            }
            $use[$c] = $val;
        }
    }
    if (empty($use['id'])) {
        $use['id'] = $trashRow['entity_id'];
    }
    // Need at least id + one real field; id-only insert fails NOT NULL columns (e.g. leads.name).
    if (count($use) < 2) {
        throw new RuntimeException('Restore failed: archived payload has no matching columns for ' . $table);
    }

    // Soften dead FKs so restore succeeds after assignee/creator users were deleted.
    if ($table === 'leads') {
        foreach (['assigned_to', 'created_by'] as $fkCol) {
            $fkVal = trim((string) ($use[$fkCol] ?? ''));
            if ($fkVal === '') {
                continue;
            }
            try {
                $chk = $db->prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
                $chk->execute([$fkVal]);
                if (!$chk->fetch()) {
                    $use[$fkCol] = null;
                }
            } catch (Throwable $e) {
                $use[$fkCol] = null;
            }
        }
    }

    // Removed team members keep their row (marked role 'deleted') so their history stays linked:
    // restoring puts the archived details back on that same row instead of inserting a new one.
    if ($table === 'users') {
        $exists = $db->prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
        $exists->execute([(string) $use['id']]);
        if ($exists->fetch()) {
            $email = strtolower(trim((string) ($use['email'] ?? '')));
            if ($email !== '') {
                $dup = $db->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1');
                $dup->execute([$email, (string) $use['id']]);
                if ($dup->fetch()) {
                    throw new RuntimeException('Restore failed: ' . $email . ' is now used by another account');
                }
            }
            $set = [];
            $vals = [];
            foreach ($use as $c => $v) {
                if ($c === 'id') {
                    continue;
                }
                $set[] = '`' . $c . '` = ?';
                $vals[] = $v;
            }
            $vals[] = (string) $use['id'];
            $db->prepare('UPDATE `users` SET ' . implode(', ', $set) . ' WHERE id = ?')->execute($vals);
            return;
        }
    }

    $cols = array_keys($use);
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $cols) . '`) VALUES (' . $ph . ')';
    $ins = $db->prepare($sql);
    $ins->execute(array_values($use));

    // Leads: assignment rows CASCADE-deleted on delete — recreate from assigned_to.
    if ($table === 'leads') {
        $assignee = trim((string) ($use['assigned_to'] ?? ''));
        if ($assignee !== '') {
            try {
                leadsSetAssignee($db, (string) $use['id'], $assignee);
            } catch (Throwable $e) {
                leadsSetAssignee($db, (string) $use['id'], null);
            }
        }
    }
}

if ($method === 'GET') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager']);
    // Permanent 30-day purge moved to cron_trash_purge.php — a GET (viewing the page)
    // must never be the trigger for an unconfirmed, permanent delete.

    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        if (!empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
            $where = 'org_id = ?';
            $params = [(string) $_GET['org_id']];
        } else {
            $where = '1=1';
            $params = [];
        }
    } else {
        $org = orgFilter($tokenData);
        $where = '(' . $org['where'] . ')';
        $params = $org['params'];
    }

    $stmt = $db->prepare("SELECT id, entity_type, entity_id, org_id, deleted_by, deleted_at, payload FROM trash_items WHERE $where ORDER BY deleted_at DESC LIMIT 500");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        $rows = array_values(array_filter($rows, static function ($r) use ($visibleIds) {
            return is_array($r) && trashRowVisibleToDownline($r, $visibleIds);
        }));
    }

    // Resolve who deleted each row (display name) in one query.
    $deleterNames = [];
    $deleterIds = array_values(array_unique(array_filter(array_map(static function ($r) {
        return is_array($r) ? trim((string) ($r['deleted_by'] ?? '')) : '';
    }, $rows))));
    if ($deleterIds) {
        try {
            $ph = implode(',', array_fill(0, count($deleterIds), '?'));
            $us = $db->prepare("SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), email) AS n FROM users WHERE id IN ($ph)");
            $us->execute($deleterIds);
            foreach ($us->fetchAll(PDO::FETCH_ASSOC) as $u) {
                $deleterNames[(string) $u['id']] = (string) $u['n'];
            }
        } catch (Throwable $e) {
            error_log('[trash] deleter names: ' . $e->getMessage());
        }
    }

    $out = [];
    foreach ($rows as $r) {
        $label = '';
        $p = json_decode((string) ($r['payload'] ?? ''), true);
        if (is_array($p)) {
            foreach (['name', 'full_name', 'title', 'customer_name', 'subject', 'email', 'phone', 'code'] as $k) {
                $v = trim(preg_replace('/[\x{200B}-\x{200F}\x{2060}\x{FEFF}]/u', '', (string) ($p[$k] ?? '')));
                // Skip one-letter junk names (e.g. "w", "h") in favour of a better field.
                if (mb_strlen($v) >= 2) {
                    $label = $v;
                    break;
                }
            }
            if ($label !== '' && !empty($p['email']) && $label !== $p['email'] && strpos($label, '@') === false) {
                $label .= ' · ' . (string) $p['email'];
            }
        }
        $deletedTs = strtotime((string) ($r['deleted_at'] ?? '')) ?: time();
        $daysLeft = max(0, 30 - (int) floor((time() - $deletedTs) / 86400));
        $out[] = [
            'id' => $r['id'],
            'entity_type' => $r['entity_type'],
            'entity_id' => $r['entity_id'],
            'org_id' => $r['org_id'],
            'deleted_by' => $r['deleted_by'],
            'deleted_at' => $r['deleted_at'],
            'deleted_by_name' => $deleterNames[(string) ($r['deleted_by'] ?? '')] ?? null,
            'days_until_purge' => $daysLeft,
            'summary' => $label !== '' ? $label : ('ID ' . substr((string) ($r['entity_id'] ?? ''), 0, 8) . '…'),
        ];
    }
    respond(['data' => $out]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager']);
    $input = getInput();
    if (!is_array($input)) {
        $input = [];
    }
    $action = trim((string) ($input['action'] ?? $_GET['action'] ?? ''));

    // Permanently empty trash (no restore) — scoped like the list, not waiting for 30-day purge
    if ($action === 'clear' || $action === 'empty') {
        @set_time_limit(120);
        if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
            if (!empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
                $where = 'org_id = ?';
                $params = [(string) $_GET['org_id']];
            } else {
                $where = '1=1';
                $params = [];
            }
        } else {
            $org = orgFilter($tokenData);
            $where = '(' . $org['where'] . ')';
            $params = $org['params'];
        }

        $deleted = 0;
        if (hierarchyRoleUsesDownlineScope($tokenData)) {
            $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
            $sel = $db->prepare("SELECT id, entity_type, entity_id, org_id, deleted_by, payload FROM trash_items WHERE $where");
            $sel->execute($params);
            $ids = [];
            while ($r = $sel->fetch(PDO::FETCH_ASSOC)) {
                if (is_array($r) && trashRowVisibleToDownline($r, $visibleIds)) {
                    $ids[] = (string) $r['id'];
                }
            }
            if ($ids !== []) {
                $del = $db->prepare('DELETE FROM trash_items WHERE id = ?');
                foreach ($ids as $tid) {
                    $del->execute([$tid]);
                    $deleted += $del->rowCount();
                }
            }
        } else {
            $stmt = $db->prepare("DELETE FROM trash_items WHERE $where");
            $stmt->execute($params);
            $deleted = (int) $stmt->rowCount();
        }
        syncpediaAuditLog($db, $tokenData, 'deleted', 'trash', null, "Cleared trash ({$deleted} item(s) permanently deleted)");
        respond([
            'message' => 'Trash cleared',
            'deleted' => $deleted,
            'handler' => 'trash_clear',
        ]);
    }

    if ($action !== 'restore') {
        respond(['error' => 'Invalid action'], 400);
    }
    $trashId = $input['id'] ?? '';
    if (!$trashId) {
        respond(['error' => 'Trash id required'], 400);
    }

    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        if (!empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
            $stmt = $db->prepare('SELECT * FROM trash_items WHERE id = ? AND org_id = ? LIMIT 1');
            $stmt->execute([$trashId, (string) $_GET['org_id']]);
        } else {
            $stmt = $db->prepare('SELECT * FROM trash_items WHERE id = ? LIMIT 1');
            $stmt->execute([$trashId]);
        }
    } else {
        $org = orgFilter($tokenData);
        $stmt = $db->prepare('SELECT * FROM trash_items WHERE id = ? AND (' . $org['where'] . ') LIMIT 1');
        $stmt->execute(array_merge([$trashId], $org['params']));
    }

    $tr = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$tr) {
        respond(['error' => 'Trash item not found'], 404);
    }

    if (hierarchyRoleUsesDownlineScope($tokenData)) {
        $visibleIds = hierarchyGetVisibleUserIds($db, $tokenData);
        if (!trashRowVisibleToDownline($tr, $visibleIds)) {
            respond(['error' => 'Trash item not found'], 404);
        }
    }

    try {
        $db->beginTransaction();
        trashRestoreRow($db, $tr, $TRASH_TYPE_TO_TABLE);
        $db->prepare('DELETE FROM trash_items WHERE id = ?')->execute([$trashId]);
        $db->commit();
    } catch (Throwable $e) {
        try {
            $db->rollBack();
        } catch (Throwable $ignored) {
        }
        $msg = $e->getMessage();
        if (stripos($msg, '1062') !== false || stripos($msg, 'Duplicate') !== false) {
            respond(['error' => 'Cannot restore: a record with this id already exists. Remove the duplicate first.'], 409);
        }
        respond(['error' => 'Restore failed: ' . (strlen($msg) > 400 ? substr($msg, 0, 400) . '…' : $msg)], 500);
    }
    syncpediaAuditLog($db, $tokenData, 'restored', 'trash', (string) $trashId, 'Restored item from trash');
    respond(['message' => 'Restored successfully']);
}

respond(['error' => 'Method not allowed'], 405);
