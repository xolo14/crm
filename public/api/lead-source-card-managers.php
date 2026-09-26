<?php
/**
 * Lead source-card manager access (form / assessment cards).
 *
 * GET  ?action=list                 → { grants: { source_key: [manager_id, ...] }, my_keys: [...] }
 * GET  ?action=managers             → org managers for checkbox UI
 * POST ?action=set                  → { source_key, manager_user_ids: string[] }
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

syncpediaLeadSourceCardManagersEnsureSchema($db);

$orgId = resolveWriteOrgId($db, $tokenData);
if ($orgId === null || trim((string) $orgId) === '') {
    $orgId = getOrgId($tokenData);
}
if ($orgId === null || trim((string) $orgId) === '') {
    respond(['error' => 'Organization context required'], 403);
}
$orgId = (string) $orgId;

function leadSourceCardManagersGrantsMap(PDO $db, string $orgId): array
{
    $map = [];
    try {
        $st = $db->prepare(
            'SELECT source_key, manager_user_id FROM lead_source_card_managers WHERE org_id = ?'
        );
        $st->execute([$orgId]);
        while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
            $key = trim((string) ($row['source_key'] ?? ''));
            $mid = trim((string) ($row['manager_user_id'] ?? ''));
            if ($key === '' || $mid === '') {
                continue;
            }
            if (!isset($map[$key])) {
                $map[$key] = [];
            }
            $map[$key][] = $mid;
        }
    } catch (Throwable $e) {
    }
    return $map;
}

function leadSourceCardManagersKeysForUser(PDO $db, string $orgId, string $managerId): array
{
    $keys = [];
    try {
        $st = $db->prepare(
            'SELECT source_key FROM lead_source_card_managers WHERE org_id = ? AND manager_user_id = ?'
        );
        $st->execute([$orgId, $managerId]);
        while ($key = $st->fetchColumn()) {
            $key = trim((string) $key);
            if ($key !== '') {
                $keys[] = $key;
            }
        }
    } catch (Throwable $e) {
    }
    return array_values(array_unique($keys));
}

if ($method === 'GET' && ($action === 'list' || $action === '')) {
    // Admins see full grant map; managers see only their granted keys.
    if (in_array($role, ['admin', 'org', 'super_admin'], true)) {
        respond([
            'data' => [
                'grants' => leadSourceCardManagersGrantsMap($db, $orgId),
                'my_keys' => [],
            ],
        ]);
    }
    if (in_array($role, ['manager', 'operational_manager'], true)) {
        respond([
            'data' => [
                'grants' => [],
                'my_keys' => leadSourceCardManagersKeysForUser($db, $orgId, $userId),
            ],
        ]);
    }
    respond(['error' => 'Insufficient permissions'], 403);
}

if ($method === 'GET' && $action === 'managers') {
    requireRole($tokenData, ['admin', 'org', 'super_admin']);
    $rows = [];
    try {
        $st = $db->prepare(
            "SELECT id, full_name, email, role, is_active
             FROM users
             WHERE org_id = ?
             ORDER BY full_name ASC"
        );
        $st->execute([$orgId]);
        while ($u = $st->fetch(PDO::FETCH_ASSOC)) {
            if (!is_array($u)) {
                continue;
            }
            $rk = syncpediaNormalizeRoleKey((string) ($u['role'] ?? ''));
            if (!in_array($rk, ['manager', 'operational_manager'], true)) {
                continue;
            }
            $active = $u['is_active'] ?? 1;
            $isActive = $active === true || $active === 1 || $active === '1' || strtolower((string) $active) === 'true';
            if (!$isActive) {
                continue;
            }
            $rows[] = [
                'id' => (string) ($u['id'] ?? ''),
                'full_name' => (string) ($u['full_name'] ?? ''),
                'email' => (string) ($u['email'] ?? ''),
                'role' => $rk,
            ];
        }
    } catch (Throwable $e) {
        respond(['error' => 'Could not load managers'], 500);
    }
    respond(['data' => $rows]);
}

if ($method === 'POST' && $action === 'set') {
    requireRole($tokenData, ['admin', 'org', 'super_admin']);
    $input = getInput();
    $sourceKey = trim((string) ($input['source_key'] ?? ''));
    $managerIds = $input['manager_user_ids'] ?? [];
    if ($sourceKey === '' || strlen($sourceKey) > 255) {
        respond(['error' => 'source_key required'], 422);
    }
    if (!is_array($managerIds)) {
        respond(['error' => 'manager_user_ids must be an array'], 422);
    }
    $cleanIds = [];
    foreach ($managerIds as $mid) {
        $mid = trim((string) $mid);
        if ($mid !== '') {
            $cleanIds[$mid] = true;
        }
    }
    $cleanIds = array_keys($cleanIds);

    // Validate managers belong to org
    $valid = [];
    if ($cleanIds !== []) {
        $ph = implode(',', array_fill(0, count($cleanIds), '?'));
        $st = $db->prepare(
            "SELECT id, role FROM users
             WHERE org_id = ? AND id IN ($ph)"
        );
        $st->execute(array_merge([$orgId], $cleanIds));
        while ($u = $st->fetch(PDO::FETCH_ASSOC)) {
            if (!is_array($u)) {
                continue;
            }
            $rk = syncpediaNormalizeRoleKey((string) ($u['role'] ?? ''));
            if (!in_array($rk, ['manager', 'operational_manager'], true)) {
                continue;
            }
            $id = trim((string) ($u['id'] ?? ''));
            if ($id !== '') {
                $valid[] = $id;
            }
        }
    }

    try {
        $db->beginTransaction();
        $del = $db->prepare('DELETE FROM lead_source_card_managers WHERE org_id = ? AND source_key = ?');
        $del->execute([$orgId, $sourceKey]);
        if ($valid !== []) {
            $ins = $db->prepare(
                'INSERT INTO lead_source_card_managers (id, org_id, source_key, manager_user_id, granted_by)
                 VALUES (?, ?, ?, ?, ?)'
            );
            foreach ($valid as $mid) {
                $ins->execute([generateUUID(), $orgId, $sourceKey, $mid, $userId !== '' ? $userId : null]);
            }
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('[lead-source-card-managers] set: ' . $e->getMessage());
        respond(['error' => 'Could not save manager access'], 500);
    }

    respond([
        'data' => [
            'grants' => leadSourceCardManagersGrantsMap($db, $orgId),
            'source_key' => $sourceKey,
            'manager_user_ids' => $valid,
        ],
        'message' => 'Manager access updated',
    ]);
}

respond(['error' => 'Method not allowed'], 405);
