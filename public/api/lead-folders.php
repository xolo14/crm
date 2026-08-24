<?php
/**
 * Lead source-card folders (Lead Management).
 *
 * GET    ?action=list| (default)     → folders + card keys
 * POST   ?action=create              → { name }
 * POST   ?action=move                → { source_key, folder_id|null }
 * PUT    ?action=rename&id=          → { name }
 * DELETE ?id=                        → delete folder (cards become unfiled)
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$userId = (string) ($tokenData['user_id'] ?? '');

function leadFoldersEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS lead_source_folders (
                id CHAR(36) NOT NULL PRIMARY KEY,
                org_id CHAR(36) NOT NULL,
                name VARCHAR(120) NOT NULL,
                created_by CHAR(36) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_lsf_org (org_id),
                KEY idx_lsf_org_sort (org_id, sort_order)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
        $db->exec(
            "CREATE TABLE IF NOT EXISTS lead_source_folder_cards (
                id CHAR(36) NOT NULL PRIMARY KEY,
                org_id CHAR(36) NOT NULL,
                folder_id CHAR(36) NOT NULL,
                source_key VARCHAR(255) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_lsfc_org_source (org_id, source_key),
                KEY idx_lsfc_folder (folder_id),
                KEY idx_lsfc_org (org_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (Throwable $e) {
        error_log('[lead-folders] schema: ' . $e->getMessage());
    }
    $done = true;
}

leadFoldersEnsureSchema($db);

$orgId = resolveWriteOrgId($db, $tokenData);
if ($orgId === null || trim((string) $orgId) === '') {
    // Super-admin without org context: still allow if they have a token org
    $orgId = getOrgId($tokenData);
}
if ($orgId === null || trim((string) $orgId) === '') {
    respond(['error' => 'Organization context required'], 403);
}
$orgId = (string) $orgId;

requireRole($tokenData, ['admin', 'org', 'super_admin']);

function leadFoldersListPayload(PDO $db, string $orgId): array
{
    $folders = [];
    $st = $db->prepare(
        'SELECT id, org_id, name, created_by, sort_order, created_at, updated_at
         FROM lead_source_folders WHERE org_id = ? ORDER BY sort_order ASC, name ASC'
    );
    $st->execute([$orgId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $cardsByFolder = [];
    $cst = $db->prepare(
        'SELECT folder_id, source_key FROM lead_source_folder_cards WHERE org_id = ?'
    );
    $cst->execute([$orgId]);
    while ($c = $cst->fetch(PDO::FETCH_ASSOC)) {
        $fid = (string) ($c['folder_id'] ?? '');
        $key = (string) ($c['source_key'] ?? '');
        if ($fid === '' || $key === '') {
            continue;
        }
        if (!isset($cardsByFolder[$fid])) {
            $cardsByFolder[$fid] = [];
        }
        $cardsByFolder[$fid][] = $key;
    }

    foreach ($rows as $r) {
        $id = (string) ($r['id'] ?? '');
        $keys = $cardsByFolder[$id] ?? [];
        $folders[] = [
            'id' => $id,
            'name' => (string) ($r['name'] ?? ''),
            'sort_order' => (int) ($r['sort_order'] ?? 0),
            'created_at' => $r['created_at'] ?? null,
            'source_keys' => $keys,
            'card_count' => count($keys),
        ];
    }

    return ['folders' => $folders];
}

if ($method === 'GET') {
    respond(['data' => leadFoldersListPayload($db, $orgId)]);
}

if ($method === 'POST' && ($action === 'create' || $action === '')) {
    $input = getInput();
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        respond(['error' => 'Folder name required'], 422);
    }
    if (mb_strlen($name) > 120) {
        respond(['error' => 'Folder name too long'], 422);
    }
    $id = generateUUID();
    $sort = 0;
    try {
        $mx = $db->prepare('SELECT COALESCE(MAX(sort_order), 0) FROM lead_source_folders WHERE org_id = ?');
        $mx->execute([$orgId]);
        $sort = ((int) $mx->fetchColumn()) + 1;
    } catch (Throwable $e) {
    }
    $ins = $db->prepare(
        'INSERT INTO lead_source_folders (id, org_id, name, created_by, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    $ins->execute([$id, $orgId, $name, $userId !== '' ? $userId : null, $sort]);
    respond(['data' => leadFoldersListPayload($db, $orgId), 'id' => $id, 'message' => 'Folder created'], 201);
}

if ($method === 'POST' && $action === 'move') {
    $input = getInput();
    $sourceKey = trim((string) ($input['source_key'] ?? ''));
    $folderId = array_key_exists('folder_id', $input) ? $input['folder_id'] : null;
    if ($sourceKey === '') {
        respond(['error' => 'source_key required'], 422);
    }
    if (mb_strlen($sourceKey) > 255) {
        respond(['error' => 'source_key too long'], 422);
    }

    // Unfile
    if ($folderId === null || $folderId === '' || $folderId === false) {
        $del = $db->prepare('DELETE FROM lead_source_folder_cards WHERE org_id = ? AND source_key = ?');
        $del->execute([$orgId, $sourceKey]);
        respond(['data' => leadFoldersListPayload($db, $orgId), 'message' => 'Card removed from folder']);
    }

    $folderId = (string) $folderId;
    $chk = $db->prepare('SELECT id FROM lead_source_folders WHERE id = ? AND org_id = ? LIMIT 1');
    $chk->execute([$folderId, $orgId]);
    if (!$chk->fetchColumn()) {
        respond(['error' => 'Folder not found'], 404);
    }

    // Upsert: one folder per source card per org
    $existing = $db->prepare('SELECT id FROM lead_source_folder_cards WHERE org_id = ? AND source_key = ? LIMIT 1');
    $existing->execute([$orgId, $sourceKey]);
    $exId = $existing->fetchColumn();
    if ($exId) {
        $upd = $db->prepare('UPDATE lead_source_folder_cards SET folder_id = ? WHERE id = ? AND org_id = ?');
        $upd->execute([$folderId, $exId, $orgId]);
    } else {
        $ins = $db->prepare(
            'INSERT INTO lead_source_folder_cards (id, org_id, folder_id, source_key) VALUES (?, ?, ?, ?)'
        );
        $ins->execute([generateUUID(), $orgId, $folderId, $sourceKey]);
    }
    respond(['data' => leadFoldersListPayload($db, $orgId), 'message' => 'Card moved']);
}

if ($method === 'PUT' && $action === 'rename') {
    $id = trim((string) ($_GET['id'] ?? ''));
    $input = getInput();
    $name = trim((string) ($input['name'] ?? ''));
    if ($id === '' || $name === '') {
        respond(['error' => 'id and name required'], 422);
    }
    $upd = $db->prepare('UPDATE lead_source_folders SET name = ? WHERE id = ? AND org_id = ?');
    $upd->execute([$name, $id, $orgId]);
    if ($upd->rowCount() < 1) {
        respond(['error' => 'Folder not found'], 404);
    }
    respond(['data' => leadFoldersListPayload($db, $orgId), 'message' => 'Folder renamed']);
}

if ($method === 'DELETE') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $db->prepare('DELETE FROM lead_source_folder_cards WHERE folder_id = ? AND org_id = ?')->execute([$id, $orgId]);
    $del = $db->prepare('DELETE FROM lead_source_folders WHERE id = ? AND org_id = ?');
    $del->execute([$id, $orgId]);
    if ($del->rowCount() < 1) {
        respond(['error' => 'Folder not found'], 404);
    }
    respond(['data' => leadFoldersListPayload($db, $orgId), 'message' => 'Folder deleted']);
}

respond(['error' => 'Method not allowed'], 405);
