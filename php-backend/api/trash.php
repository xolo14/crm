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
    $stmt = $db->prepare(
        "SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ?",
    );
    $stmt->execute([$table]);
    $allowed = [];
    while ($c = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $allowed[] = $c['column_name'];
    }
    $use = [];
    foreach ($allowed as $c) {
        if (array_key_exists($c, $payload)) {
            $use[$c] = $payload[$c];
        }
    }
    if (empty($use['id'])) {
        $use['id'] = $trashRow['entity_id'];
    }
    $cols = array_keys($use);
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $cols) . '`) VALUES (' . $ph . ')';
    $ins = $db->prepare($sql);
    $ins->execute(array_values($use));
}

if ($method === 'GET') {
    requireRole($tokenData, ['admin', 'super_admin', 'org', 'manager']);
    $purged = trashPurgeExpired($db, 30);

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

    $out = [];
    foreach ($rows as $r) {
        $label = '';
        $p = json_decode((string) ($r['payload'] ?? ''), true);
        if (is_array($p)) {
            $label = (string) ($p['name'] ?? $p['title'] ?? $p['subject'] ?? $p['email'] ?? '');
        }
        $out[] = [
            'id' => $r['id'],
            'entity_type' => $r['entity_type'],
            'entity_id' => $r['entity_id'],
            'org_id' => $r['org_id'],
            'deleted_by' => $r['deleted_by'],
            'deleted_at' => $r['deleted_at'],
            'summary' => $label !== '' ? $label : ('ID ' . substr((string) ($r['entity_id'] ?? ''), 0, 8) . '…'),
        ];
    }
    respond(['data' => $out, 'purged_expired' => $purged]);
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
