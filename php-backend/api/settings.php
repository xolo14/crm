<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
requireRole($tokenData, ['admin', 'super_admin', 'org']);

$method = $_SERVER['REQUEST_METHOD'];

/** Roles an actor may assign via settings (never includes super_admin except for super_admin). */
function settingsAssignableRoles(string $actorRole): array
{
    $actor = syncpediaNormalizeRoleKey($actorRole);
    if ($actor === 'super_admin') {
        return array_merge(['admin', 'org', 'manager'], syncpediaL1AssignableRoles(), ['trainer', 'finance', 'student']);
    }
    if ($actor === 'admin') {
        return array_merge(['manager'], syncpediaL1AssignableRoles(), ['trainer', 'finance', 'student']);
    }
    return [];
}

if ($method === 'GET') {
    if (tenantIsMasterView($tokenData)) {
        $stmt = $db->prepare('SELECT id, email, full_name, phone, role, is_active, created_at, org_id FROM users ORDER BY created_at DESC');
        $stmt->execute();
    } else {
        $orgId = resolveCreatorOrgId($db, $tokenData);
        if ($orgId === null || $orgId === '') {
            respond(['data' => []]);
        }
        $stmt = $db->prepare('SELECT id, email, full_name, phone, role, is_active, created_at, org_id FROM users WHERE org_id = ? ORDER BY created_at DESC');
        $stmt->execute([$orgId]);
    }
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'PUT') {
    $input = getInput();
    $id = $_GET['id'] ?? '';
    if (!$id) {
        respond(['error' => 'ID required'], 400);
    }
    $target = syncpediaAssertTargetUserEditable($db, $tokenData, $id);
    $callerRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $targetRole = syncpediaNormalizeRoleKey((string) ($target['role'] ?? ''));

    $fields = [];
    $params = [];

    if (array_key_exists('full_name', $input)) {
        $fields[] = 'full_name = ?';
        $params[] = trim((string) $input['full_name']);
    }

    if (array_key_exists('is_active', $input)) {
        if ($callerRole === 'org') {
            respond(['error' => 'Use Team page to activate or deactivate users'], 403);
        }
        $fields[] = 'is_active = ?';
        $params[] = (int) $input['is_active'];
    }

    if (array_key_exists('role', $input)) {
        if ($callerRole === 'org') {
            respond(['error' => 'Role changes must be done via Team management'], 403);
        }
        $newRole = normalizeRoleValue((string) $input['role']);
        $newRoleNorm = syncpediaNormalizeRoleKey($newRole);
        if ($targetRole === 'super_admin' && $callerRole !== 'super_admin') {
            respond(['error' => 'Forbidden'], 403);
        }
        if ($newRoleNorm === 'super_admin' && $callerRole !== 'super_admin') {
            respond(['error' => 'Only Super Admin can assign Super Admin role'], 403);
        }
        $allowed = settingsAssignableRoles($callerRole);
        if (!in_array($newRoleNorm, $allowed, true)) {
            respond(['error' => 'You cannot assign this role'], 403);
        }
        if ($newRoleNorm === 'admin' && $targetRole !== 'admin') {
            $targetOrgId = $target['org_id'] ?? null;
            if ($targetOrgId) {
                $cstmt = $db->prepare("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND LOWER(TRIM(role)) = 'admin' AND is_active = 1 AND id != ?");
                $cstmt->execute([$targetOrgId, $id]);
                if ((int) ($cstmt->fetch()['c'] ?? 0) >= 1) {
                    respond(['error' => 'This organization already has one admin'], 409);
                }
            }
        }
        $fields[] = 'role = ?';
        $params[] = $newRole;
    }

    if (empty($fields)) {
        respond(['error' => 'Nothing to update'], 400);
    }

    $params[] = $id;
    $stmt = $db->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?');
    $stmt->execute($params);
    respond(['message' => 'User updated']);
}

if ($method === 'POST' && isset($_GET['action']) && $_GET['action'] === 'stages') {
    $stmt = $db->prepare('SELECT * FROM pipeline_stages ORDER BY position');
    $stmt->execute();
    respond(['data' => $stmt->fetchAll()]);
}

respond(['error' => 'Invalid request'], 400);
