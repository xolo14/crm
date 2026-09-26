<?php
/**
 * Admin API — candidate video introductions.
 *
 * GET                 list (search, status, org_id)
 * GET ?id=            detail + events + recording meta
 * GET ?action=media&id=  authenticated video stream
 * POST                create
 * POST ?action=revoke|regenerate|delete_recording|send_email|delete
 * GET  ?action=mailboxes
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/gcs_storage.php';
require_once __DIR__ . '/lib/VideoIntros.php';
cors();

$db = (new Database())->getConnection();
videoIntroEnsureSchema($db);
$tokenData = verifyToken();
videoIntroRequireCaller($db, $tokenData);
videoIntroPurgeExpiredRecordings($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));
$id = trim((string) ($_GET['id'] ?? ''));

/**
 * @return array<string,mixed>
 */
function videoIntroLoadScoped(PDO $db, array $tokenData, string $id): array
{
    if ($id === '') {
        respond(['error' => 'ID required'], 400);
    }
    $org = orgFilter($tokenData, '', $db);
    $st = $db->prepare("SELECT * FROM video_intro_invitations WHERE id = ? AND {$org['where']} LIMIT 1");
    $st->execute(array_merge([$id], $org['params']));
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Invitation not found'], 404);
    }
    return $row;
}

if ($method === 'GET' && $action === 'media') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $recSt = $db->prepare('SELECT * FROM video_intro_recordings WHERE invitation_id = ? LIMIT 1');
    $recSt->execute([$row['id']]);
    $rec = $recSt->fetch(PDO::FETCH_ASSOC);
    if (!$rec) {
        respond(['error' => 'No recording'], 404);
    }
    $mime = (string) ($rec['mime_type'] ?? 'video/webm');
    if (!videoIntroMimeAllowed($mime)) {
        $mime = 'video/webm';
    }
    $local = trim((string) ($rec['local_path'] ?? ''));
    if ($local !== '' && is_file($local)) {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        if (!defined('SYNCPIEDIA_API_DONE')) {
            define('SYNCPIEDIA_API_DONE', true);
        }
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string) filesize($local));
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($local);
        exit;
    }
    $gcs = trim((string) ($rec['gcs_object'] ?? ''));
    if ($gcs !== '' && function_exists('syncpediaGcsStreamObjectToClient')) {
        syncpediaGcsStreamObjectToClient($gcs, $mime);
    }
    respond(['error' => 'Recording file missing'], 404);
}

if ($method === 'GET' && $action === 'mailboxes') {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $orgId = '';
    if ($role === 'super_admin') {
        $orgId = trim((string) ($_GET['org_id'] ?? ''));
        if ($orgId === '') {
            respond(['error' => 'Select an organisation'], 400);
        }
        $chk = $db->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
        $chk->execute([$orgId]);
        if (!$chk->fetch(PDO::FETCH_ASSOC)) {
            respond(['error' => 'Organization not found'], 404);
        }
    } else {
        $orgId = trim((string) (resolveWriteOrgId($db, $tokenData) ?? ''));
        if ($orgId === '') {
            respond(['error' => 'No organization on this account'], 400);
        }
    }
    require_once __DIR__ . '/org_email_service.php';
    syncpediaEnsureOrgEmailSchema($db);
    try {
        $st = $db->prepare(
            'SELECT id, slot, label, email, from_name FROM org_smtp_accounts
             WHERE org_id = ? AND is_active = 1 ORDER BY slot ASC'
        );
        $st->execute([$orgId]);
        $rows = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $mbEmail = trim((string) ($row['email'] ?? ''));
            if ($mbEmail === '') {
                continue;
            }
            $rows[] = [
                'id' => (string) ($row['id'] ?? ''),
                'slot' => (int) ($row['slot'] ?? 0),
                'label' => trim((string) ($row['label'] ?? '')),
                'email' => $mbEmail,
                'from_name' => trim((string) ($row['from_name'] ?? '')),
            ];
        }
        respond(['data' => $rows, 'org_id' => $orgId]);
    } catch (Throwable $e) {
        error_log('[video-intro] mailboxes: ' . $e->getMessage());
        respond(['error' => 'Could not load Email Setup accounts'], 500);
    }
}

if ($method === 'GET' && $id !== '') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $dto = videoIntroPublicDto($row, true);
    $dto['status'] = videoIntroEffectiveStatus($row);
    $recSt = $db->prepare(
        'SELECT id, mime_type, byte_size, duration_ms, uploaded_at,
                CASE WHEN gcs_object IS NOT NULL AND gcs_object <> \'\' THEN 1 ELSE 0 END AS stored_gcs,
                CASE WHEN local_path IS NOT NULL AND local_path <> \'\' THEN 1 ELSE 0 END AS stored_local
         FROM video_intro_recordings WHERE invitation_id = ? LIMIT 1'
    );
    $recSt->execute([$row['id']]);
    $rec = $recSt->fetch(PDO::FETCH_ASSOC) ?: null;
    if (is_array($rec)) {
        unset($rec['gcs_object'], $rec['local_path']);
    }
    $ev = $db->prepare(
        'SELECT id, event_type, detail, created_at FROM video_intro_events
         WHERE invitation_id = ? ORDER BY created_at ASC LIMIT 200'
    );
    $ev->execute([$row['id']]);
    $orgName = null;
    try {
        $on = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $on->execute([(string) $row['org_id']]);
        $orgName = $on->fetchColumn() ?: null;
    } catch (Throwable $e) {
        $orgName = null;
    }
    $creator = null;
    if (!empty($row['created_by'])) {
        try {
            $cn = $db->prepare('SELECT full_name FROM users WHERE id = ? LIMIT 1');
            $cn->execute([(string) $row['created_by']]);
            $creator = $cn->fetchColumn() ?: null;
        } catch (Throwable $e) {
            $creator = null;
        }
    }
    $dto['org_name'] = $orgName;
    $dto['created_by_name'] = $creator;
    $dto['has_recording'] = is_array($rec);
    respond([
        'data' => $dto,
        'recording' => $rec,
        'events' => $ev->fetchAll(PDO::FETCH_ASSOC) ?: [],
        'retention_days' => VIDEO_INTRO_RETENTION_DAYS,
    ]);
}

if ($method === 'GET') {
    $org = orgFilter($tokenData, 'v', $db);
    $q = trim((string) ($_GET['q'] ?? ''));
    $status = strtolower(trim((string) ($_GET['status'] ?? '')));
    $sql = "SELECT v.*, r.id AS recording_id, r.duration_ms, r.byte_size, r.uploaded_at AS recording_uploaded_at,
                   o.name AS org_name, u.full_name AS created_by_name
            FROM video_intro_invitations v
            LEFT JOIN video_intro_recordings r ON r.invitation_id = v.id
            LEFT JOIN organizations o ON o.id = v.org_id
            LEFT JOIN users u ON u.id = v.created_by
            WHERE {$org['where']}";
    $params = $org['params'];
    if ($q !== '') {
        $sql .= ' AND (v.candidate_name LIKE ? OR v.email LIKE ? OR v.phone LIKE ? OR v.position LIKE ?)';
        $like = '%' . $q . '%';
        array_push($params, $like, $like, $like, $like);
    }
    $sql .= ' ORDER BY v.created_at DESC LIMIT 500';
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $out = [];
    $counts = [
        'created' => 0, 'opened' => 0, 'recording' => 0,
        'submitted' => 0, 'expired' => 0, 'revoked' => 0, 'all' => 0,
    ];
    foreach ($rows as $row) {
        $eff = videoIntroEffectiveStatus($row);
        $counts['all']++;
        if (isset($counts[$eff])) {
            $counts[$eff]++;
        }
        if ($status !== '' && $status !== 'all' && $eff !== $status) {
            continue;
        }
        $item = videoIntroPublicDto($row, true);
        $item['status'] = $eff;
        $item['org_name'] = $row['org_name'] ?? null;
        $item['created_by_name'] = $row['created_by_name'] ?? null;
        $item['has_recording'] = !empty($row['recording_id']);
        $item['duration_ms'] = isset($row['duration_ms']) ? (int) $row['duration_ms'] : null;
        $item['byte_size'] = isset($row['byte_size']) ? (int) $row['byte_size'] : null;
        $out[] = $item;
    }
    respond(['data' => $out, 'counts' => $counts]);
}

if ($method === 'POST' && $action === 'revoke') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $eff = videoIntroEffectiveStatus($row);
    if ($eff === 'revoked') {
        respond(['message' => 'Already revoked', 'data' => videoIntroPublicDto($row, true)]);
    }
    $db->prepare(
        "UPDATE video_intro_invitations SET status = 'revoked', revoked_at = NOW() WHERE id = ?"
    )->execute([$row['id']]);
    videoIntroAddEvent($db, (string) $row['id'], 'revoked', 'admin');
    $row = videoIntroFindById($db, (string) $row['id']);
    respond(['message' => 'Invitation revoked', 'data' => videoIntroPublicDto($row ?: [], true)]);
}

if ($method === 'POST' && $action === 'regenerate') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $eff = videoIntroEffectiveStatus($row);
    if ($eff === 'submitted') {
        respond(['error' => 'Cannot regenerate a submitted invitation. Revoke it first if needed.'], 409);
    }
    $raw = videoIntroNewToken();
    $hash = videoIntroHashToken($raw);
    $db->prepare(
        "UPDATE video_intro_invitations
         SET token_hash = ?, status = 'created', opened_at = NULL, recording_started_at = NULL,
             retry_count = 0, revoked_at = NULL, consent_at = NULL
         WHERE id = ?"
    )->execute([$hash, $row['id']]);
    videoIntroAddEvent($db, (string) $row['id'], 'regenerated', null);
    $fresh = videoIntroFindById($db, (string) $row['id']);
    $dto = videoIntroPublicDto($fresh ?: $row, true);
    $dto['invite_url'] = videoIntroPublicUrl($raw);
    $dto['invite_path'] = videoIntroPublicPath($raw);
    respond([
        'message' => 'New link generated. The previous link no longer works.',
        'data' => $dto,
    ]);
}

if ($method === 'POST' && $action === 'delete_recording') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $recSt = $db->prepare('SELECT * FROM video_intro_recordings WHERE invitation_id = ? LIMIT 1');
    $recSt->execute([$row['id']]);
    $rec = $recSt->fetch(PDO::FETCH_ASSOC);
    if (!$rec) {
        respond(['error' => 'No recording to delete'], 404);
    }
    videoIntroDeleteFiles($rec['local_path'] ?? null, $rec['gcs_object'] ?? null);
    $db->prepare('DELETE FROM video_intro_recordings WHERE id = ?')->execute([$rec['id']]);
    $newStatus = videoIntroEffectiveStatus($row) === 'revoked' ? 'revoked' : 'opened';
    $db->prepare(
        'UPDATE video_intro_invitations SET status = ?, submitted_at = NULL WHERE id = ?'
    )->execute([$newStatus, $row['id']]);
    videoIntroAddEvent($db, (string) $row['id'], 'recording_deleted', 'admin');
    respond(['message' => 'Recording deleted']);
}

if ($method === 'POST' && $action === 'send_email') {
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    $eff = videoIntroEffectiveStatus($row);
    if (in_array($eff, ['revoked', 'expired'], true)) {
        respond(['error' => 'Cannot email a revoked or expired invitation'], 409);
    }
    $to = strtolower(trim((string) ($row['email'] ?? '')));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'This invitation has no email address'], 400);
    }
    $input = getInput();
    $smtpAccountId = trim((string) ($input['smtp_account_id'] ?? $input['from_account_id'] ?? ''));
    if ($smtpAccountId === '') {
        respond(['error' => 'Select an Email Setup mailbox to send from'], 400);
    }
    $orgId = trim((string) ($row['org_id'] ?? ''));
    $mailbox = videoIntroLoadMailbox($db, $orgId, $smtpAccountId);
    if ($mailbox === null) {
        respond(['error' => 'Choose a mailbox from Email Setup'], 400);
    }
    $raw = videoIntroParseRawToken(
        (string) ($input['invite_url'] ?? $input['invite_path'] ?? ''),
        (string) ($input['token'] ?? '')
    );
    if ($raw === '' || !hash_equals((string) ($row['token_hash'] ?? ''), videoIntroHashToken($raw))) {
        respond(['error' => 'The invitation link is required to send email (copy it from the create screen)'], 400);
    }
    $link = videoIntroAbsoluteInviteUrl($raw, (string) ($input['invite_url'] ?? ''));
    $sendRes = videoIntroSendInviteEmail($db, $row, $mailbox, $link);
    if (empty($sendRes['ok'])) {
        respond([
            'error' => (string) ($sendRes['error'] ?? 'Could not send email'),
            'email_sent' => false,
        ], 502);
    }
    videoIntroAddEvent($db, (string) $row['id'], 'email_sent', (string) ($mailbox['email'] ?? ''));
    respond(['message' => 'Email sent', 'email_sent' => true]);
}

if ($method === 'POST' && $action === 'delete') {
    if (!videoIntroCanDeleteInvitation($tokenData)) {
        respond(['error' => 'Only Super Admin or Admin can delete invitations'], 403);
    }
    $row = videoIntroLoadScoped($db, $tokenData, $id);
    try {
        videoIntroPurgeInvitation($db, (string) $row['id']);
    } catch (Throwable $e) {
        error_log('[video-intro] delete: ' . $e->getMessage());
        respond(['error' => 'Could not delete invitation'], 500);
    }
    respond(['message' => 'Invitation deleted']);
}

if ($method === 'POST' && $action === '') {
    $input = getInput();
    $name = trim((string) ($input['candidate_name'] ?? ''));
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $phone = trim((string) ($input['phone'] ?? ''));
    $position = trim((string) ($input['position'] ?? ''));
    $expires = trim((string) ($input['expires_at'] ?? ''));
    $duration = (int) ($input['max_duration_sec'] ?? VIDEO_INTRO_DEFAULT_DURATION);
    $retries = (int) ($input['max_retries'] ?? VIDEO_INTRO_DEFAULT_RETRIES);

    if ($name === '') {
        respond(['error' => 'Candidate name is required'], 400);
    }
    if ($email === '' && $phone === '') {
        respond(['error' => 'Email or phone is required'], 400);
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'Enter a valid email address'], 400);
    }
    if ($duration < VIDEO_INTRO_MIN_DURATION || $duration > VIDEO_INTRO_MAX_DURATION) {
        respond(['error' => 'Recording limit must be between 30 and 180 seconds'], 400);
    }
    if ($retries < 1 || $retries > VIDEO_INTRO_MAX_RETRIES) {
        respond(['error' => 'Retries must be between 1 and 5'], 400);
    }
    $expTs = strtotime($expires);
    if ($expires === '' || $expTs === false) {
        respond(['error' => 'Expiration date is required'], 400);
    }
    if ($expTs < time() + 60) {
        respond(['error' => 'Expiration must be in the future'], 400);
    }

    $orgId = resolveWriteOrgId($db, $tokenData);
    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        $fromBody = trim((string) ($input['org_id'] ?? ''));
        if ($fromBody !== '') {
            $orgId = $fromBody;
        }
        if (empty($_GET['org_id']) && $fromBody !== '') {
            $orgId = $fromBody;
        }
    }
    if (!$orgId) {
        respond(['error' => 'Select an organisation'], 400);
    }

    $inviteId = generateUUID();
    $raw = videoIntroNewToken();
    $hash = videoIntroHashToken($raw);
    $expSql = date('Y-m-d H:i:s', $expTs);

    $db->prepare(
        'INSERT INTO video_intro_invitations
         (id, org_id, created_by, candidate_name, email, phone, position, token_hash, status,
          max_duration_sec, max_retries, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'created\', ?, ?, ?)'
    )->execute([
        $inviteId,
        $orgId,
        (string) ($tokenData['user_id'] ?? ''),
        $name,
        $email !== '' ? $email : null,
        $phone !== '' ? $phone : null,
        $position !== '' ? $position : null,
        $hash,
        $duration,
        $retries,
        $expSql,
    ]);
    videoIntroAddEvent($db, $inviteId, 'created', null);
    $fresh = videoIntroFindById($db, $inviteId);
    $dto = videoIntroPublicDto($fresh ?: [], true);
    $dto['invite_url'] = videoIntroPublicUrl($raw);
    $dto['invite_path'] = videoIntroPublicPath($raw);
    respond(['message' => 'Invitation created', 'data' => $dto], 201);
}

respond(['error' => 'Method not allowed'], 405);
