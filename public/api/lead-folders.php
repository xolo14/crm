<?php
/**
 * Lead source-card folders (Lead Management).
 *
 * GET    ?action=list| (default)     → folders + card keys
 * POST   ?action=create              → { name }
 * POST   ?action=move                → { source_key, folder_id|null }
 * PUT    ?action=rename&id=          → { name }
 * DELETE ?id=                        → delete folder (cards become unfiled)
 *
 * Org lock:
 *   - admin / org       → only their organisation's folders
 *   - super_admin       → all orgs when no org_id; one org when ?org_id= is set
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$userId = (string) ($tokenData['user_id'] ?? '');

requireRole($tokenData, ['admin', 'org', 'super_admin']);

$roleKey = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$isSuperAdmin = $roleKey === 'super_admin';

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

function leadFoldersResolveOrgId(PDO $db, array $tokenData, bool $isSuperAdmin): ?string
{
    if ($isSuperAdmin) {
        $fromGet = trim((string) ($_GET['org_id'] ?? ''));
        $fromHdr = trim((string) ($_SERVER['HTTP_X_ORG_ID'] ?? ''));
        if ($fromGet !== '') {
            return $fromGet;
        }
        if ($fromHdr !== '') {
            return $fromHdr;
        }
        return null;
    }
    $orgId = resolveWriteOrgId($db, $tokenData);
    if ($orgId === null || trim((string) $orgId) === '') {
        $orgId = getOrgId($tokenData);
    }
    return $orgId !== null && trim((string) $orgId) !== '' ? trim((string) $orgId) : null;
}

$orgId = leadFoldersResolveOrgId($db, $tokenData, $isSuperAdmin);
if (!$isSuperAdmin && ($orgId === null || $orgId === '')) {
    respond(['error' => 'Organization context required'], 403);
}

function leadFoldersEnsureMetaAdsFolder(PDO $db, string $orgId, string $userId = ''): void
{
    static $ensured = [];
    if ($orgId === '' || isset($ensured[$orgId])) {
        return;
    }
    try {
        $chk = $db->prepare(
            "SELECT id FROM lead_source_folders
             WHERE org_id = ? AND LOWER(TRIM(name)) = 'meta ads'
             LIMIT 1"
        );
        $chk->execute([$orgId]);
        if ($chk->fetchColumn()) {
            $ensured[$orgId] = true;
            return;
        }
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
        $ins->execute([generateUUID(), $orgId, 'Meta Ads', $userId !== '' ? $userId : null, $sort]);
    } catch (Throwable $e) {
        error_log('[lead-folders] ensure Meta Ads folder: ' . $e->getMessage());
    }
    $ensured[$orgId] = true;
}

/** @param string|null $orgId null = all orgs (super_admin only) */
function leadFoldersListPayload(PDO $db, ?string $orgId): array
{
    $folders = [];
    if ($orgId !== null && $orgId !== '') {
        $st = $db->prepare(
            'SELECT id, org_id, name, created_by, sort_order, created_at, updated_at
             FROM lead_source_folders
             WHERE org_id = ?
             ORDER BY sort_order ASC, name ASC'
        );
        $st->execute([$orgId]);
    } else {
        $st = $db->query(
            'SELECT id, org_id, name, created_by, sort_order, created_at, updated_at
             FROM lead_source_folders
             ORDER BY org_id ASC, sort_order ASC, name ASC'
        );
    }
    $rows = $st ? ($st->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];

    $orgNames = [];
    try {
        $ost = $db->query('SELECT id, name FROM organizations');
        if ($ost) {
            while ($o = $ost->fetch(PDO::FETCH_ASSOC)) {
                $oid = trim((string) ($o['id'] ?? ''));
                if ($oid !== '') {
                    $orgNames[strtolower($oid)] = (string) ($o['name'] ?? '');
                }
            }
        }
    } catch (Throwable $e) {
        /* ignore */
    }

    $cardsByFolder = [];
    if ($orgId !== null && $orgId !== '') {
        $cst = $db->prepare('SELECT folder_id, source_key FROM lead_source_folder_cards WHERE org_id = ?');
        $cst->execute([$orgId]);
    } else {
        $cst = $db->query('SELECT folder_id, source_key FROM lead_source_folder_cards');
    }
    if ($cst) {
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
    }

    foreach ($rows as $r) {
        $id = (string) ($r['id'] ?? '');
        $rowOrg = trim((string) ($r['org_id'] ?? ''));
        $keys = $cardsByFolder[$id] ?? [];
        $folders[] = [
            'id' => $id,
            'org_id' => $rowOrg,
            'org_name' => $orgNames[strtolower($rowOrg)] ?? null,
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
    try {
        if ($orgId !== null && $orgId !== '') {
            leadFoldersEnsureMetaAdsFolder($db, $orgId, $userId);
        }
        respond(['data' => leadFoldersListPayload($db, $orgId)]);
    } catch (Throwable $e) {
        error_log('[lead-folders] list: ' . $e->getMessage());
        respond(['error' => 'Could not load folders'], 500);
    }
}

if ($orgId === null || $orgId === '') {
    if ($isSuperAdmin) {
        respond(['error' => 'Select an organisation (org_id) to create or change folders'], 422);
    }
    respond(['error' => 'Organization context required'], 403);
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
    if (strcasecmp($name, 'Meta Ads') === 0) {
        leadFoldersEnsureMetaAdsFolder($db, $orgId, $userId);
        $ex = $db->prepare(
            "SELECT id FROM lead_source_folders
             WHERE org_id = ? AND LOWER(TRIM(name)) = 'meta ads'
             LIMIT 1"
        );
        $ex->execute([$orgId]);
        $existingId = (string) ($ex->fetchColumn() ?: '');
        respond([
            'data' => leadFoldersListPayload($db, $orgId),
            'id' => $existingId,
            'message' => 'Meta Ads folder already exists',
        ], 200);
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
    $nameSt = $db->prepare('SELECT name FROM lead_source_folders WHERE id = ? AND org_id = ? LIMIT 1');
    $nameSt->execute([$id, $orgId]);
    $folderName = (string) ($nameSt->fetchColumn() ?: '');
    if ($folderName !== '' && strcasecmp(trim($folderName), 'Meta Ads') === 0) {
        respond(['error' => 'The Meta Ads folder is automatic and cannot be deleted'], 422);
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
