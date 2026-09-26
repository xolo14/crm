<?php
/**
 * Public candidate video-intro API (no JWT).
 * Token is sent in JSON body or X-Intro-Token header — not in query strings.
 *
 * POST { action: preview|consent|start|complete, token, ... }
 * POST ?action=chunk  binary body + X-Intro-Token + X-Upload-Session + X-Chunk-Offset
 * GET  ?action=org_logo&id={invitation uuid}  public org mark for the candidate page
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/gcs_storage.php';
require_once __DIR__ . '/lib/VideoIntros.php';
cors();

$db = (new Database())->getConnection();
videoIntroEnsureSchema($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$qsAction = strtolower(trim((string) ($_GET['action'] ?? '')));

if ($method === 'GET' && $qsAction === 'org_logo') {
    syncpediaRateLimitConsume('video-intro-logo', 80, 900);
    videoIntroStreamOrgLogo($db, trim((string) ($_GET['id'] ?? '')));
}

if ($method !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

if ($qsAction === 'chunk') {
    syncpediaRateLimitConsume('video-intro-chunk', 80, 900);
    $token = trim((string) ($_SERVER['HTTP_X_INTRO_TOKEN'] ?? ''));
    $sessionId = trim((string) ($_SERVER['HTTP_X_UPLOAD_SESSION'] ?? ''));
    $offset = (int) ($_SERVER['HTTP_X_CHUNK_OFFSET'] ?? -1);
    if ($token === '' || $sessionId === '' || $offset < 0) {
        respond(['error' => 'Missing upload headers'], 400);
    }
    $row = videoIntroFindByToken($db, $token);
    if (!$row) {
        respond(['error' => 'Invitation not found'], 404);
    }
    $eff = videoIntroEffectiveStatus($row);
    if ($eff === 'expired') {
        respond(['error' => 'This invitation has expired'], 410);
    }
    if ($eff === 'revoked') {
        respond(['error' => 'This invitation has been revoked'], 410);
    }
    if ($eff === 'submitted') {
        respond(['error' => 'A recording was already submitted'], 409);
    }
    if (!videoIntroCanCandidateAct($eff)) {
        respond(['error' => 'This invitation cannot accept a recording'], 409);
    }
    $sess = $db->prepare(
        'SELECT * FROM video_intro_upload_sessions WHERE id = ? AND invitation_id = ? LIMIT 1'
    );
    $sess->execute([$sessionId, $row['id']]);
    $session = $sess->fetch(PDO::FETCH_ASSOC);
    if (!$session) {
        respond(['error' => 'Upload session not found. Start recording again.'], 404);
    }
    if (strtotime((string) $session['expires_at']) < time()) {
        respond(['error' => 'Upload session expired. Please retry.'], 410);
    }
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > VIDEO_INTRO_CHUNK_MAX) {
        respond(['error' => 'Chunk too large'], 413);
    }
    $chunk = file_get_contents('php://input');
    if (!is_string($chunk) || $chunk === '') {
        respond(['error' => 'Empty chunk'], 400);
    }
    $chunkLen = strlen($chunk);
    if ($offset !== (int) $session['bytes_received']) {
        respond([
            'error' => 'Chunk offset mismatch',
            'expected_offset' => (int) $session['bytes_received'],
        ], 409);
    }
    $next = $offset + $chunkLen;
    if ($next > VIDEO_INTRO_MAX_BYTES) {
        respond(['error' => 'Recording exceeds the maximum file size (80 MB)'], 413);
    }
    $temp = videoIntroTempDir() . DIRECTORY_SEPARATOR . (string) $session['temp_name'];
    $fh = fopen($temp, 'ab');
    if ($fh === false) {
        respond(['error' => 'Could not store upload'], 500);
    }
    fwrite($fh, $chunk);
    fclose($fh);
    $db->prepare(
        'UPDATE video_intro_upload_sessions SET bytes_received = ? WHERE id = ?'
    )->execute([$next, $sessionId]);
    respond(['ok' => true, 'bytes_received' => $next]);
}

syncpediaRateLimitConsume('video-intro-public', 40, 900);
$input = getInput();
if (!is_array($input)) {
    $input = [];
}
$action = strtolower(trim((string) ($input['action'] ?? '')));
$token = trim((string) ($input['token'] ?? ''));
if ($token === '') {
    $token = trim((string) ($_SERVER['HTTP_X_INTRO_TOKEN'] ?? ''));
}

$row = videoIntroFindByToken($db, $token);
if (!$row) {
    respond(['error' => 'This link is invalid'], 404);
}
$eff = videoIntroEffectiveStatus($row);

if ($action === 'preview') {
    respond([
        'data' => videoIntroPublicCandidateDto($db, $row),
        'consent' => [
            'reviewers' => 'It is not a public video URL.',
            'storage' => 'The file is stored privately on this organisation’s server for '
                . VIDEO_INTRO_RETENTION_DAYS
                . ' days, then it is deleted.',
            'camera' => 'Camera and microphone are required. You can retry before you submit, within the limit shown.',
        ],
    ]);
}

if ($action === 'consent') {
    if ($eff === 'expired') {
        respond(['error' => 'This invitation has expired'], 410);
    }
    if ($eff === 'revoked') {
        respond(['error' => 'This invitation has been revoked'], 410);
    }
    if ($eff === 'submitted') {
        respond(['error' => 'A recording was already submitted'], 409);
    }
    $agreed = !empty($input['agreed']);
    if (!$agreed) {
        respond(['error' => 'Consent is required before continuing'], 400);
    }
    if ($eff === 'created') {
        $db->prepare(
            "UPDATE video_intro_invitations
             SET status = 'opened', opened_at = COALESCE(opened_at, NOW()),
                 consent_at = NOW(), consent_ip = ?
             WHERE id = ?"
        )->execute([videoIntroClientIp(), $row['id']]);
        videoIntroAddEvent($db, (string) $row['id'], 'consent', null);
        videoIntroAddEvent($db, (string) $row['id'], 'opened', 'intentional');
    } elseif (empty($row['consent_at'])) {
        $db->prepare(
            'UPDATE video_intro_invitations SET consent_at = NOW(), consent_ip = ? WHERE id = ?'
        )->execute([videoIntroClientIp(), $row['id']]);
        videoIntroAddEvent($db, (string) $row['id'], 'consent', null);
    }
    $fresh = videoIntroFindById($db, (string) $row['id']);
    respond(['data' => videoIntroPublicCandidateDto($db, $fresh ?: $row)]);
}

if ($action === 'start') {
    if ($eff === 'expired') {
        respond(['error' => 'This invitation has expired'], 410);
    }
    if ($eff === 'revoked') {
        respond(['error' => 'This invitation has been revoked'], 410);
    }
    if ($eff === 'submitted') {
        respond(['error' => 'A recording was already submitted'], 409);
    }
    if (empty($row['consent_at']) && $eff === 'created') {
        respond(['error' => 'Consent is required before recording'], 409);
    }
    $retriesUsed = (int) ($row['retry_count'] ?? 0);
    $maxRetries = (int) ($row['max_retries'] ?? VIDEO_INTRO_DEFAULT_RETRIES);
    if (!empty($row['recording_started_at']) && $retriesUsed >= $maxRetries) {
        respond(['error' => 'No retries remaining. Submit the take you already recorded, or ask for a new link.'], 409);
    }
    $mime = strtolower(trim((string) ($input['mime_type'] ?? 'video/webm')));
    if (!videoIntroMimeAllowed($mime)) {
        $mime = 'video/webm';
    }
    if (!empty($row['recording_started_at'])) {
        $db->prepare(
            'UPDATE video_intro_invitations SET retry_count = retry_count + 1, status = \'recording\' WHERE id = ?'
        )->execute([$row['id']]);
        videoIntroAddEvent($db, (string) $row['id'], 'retry', null);
    } else {
        $db->prepare(
            "UPDATE video_intro_invitations
             SET status = 'recording', recording_started_at = NOW()
             WHERE id = ?"
        )->execute([$row['id']]);
        videoIntroAddEvent($db, (string) $row['id'], 'recording_started', null);
    }

    $old = $db->prepare('SELECT id, temp_name FROM video_intro_upload_sessions WHERE invitation_id = ?');
    $old->execute([$row['id']]);
    foreach ($old->fetchAll(PDO::FETCH_ASSOC) ?: [] as $os) {
        $p = videoIntroTempDir() . DIRECTORY_SEPARATOR . (string) $os['temp_name'];
        if (is_file($p)) {
            @unlink($p);
        }
        $db->prepare('DELETE FROM video_intro_upload_sessions WHERE id = ?')->execute([$os['id']]);
    }

    $sessionId = generateUUID();
    $tempName = preg_replace('/[^a-f0-9\-]/i', '', $sessionId) . '.part';
    $db->prepare(
        'INSERT INTO video_intro_upload_sessions (id, invitation_id, mime_type, bytes_received, temp_name, expires_at)
         VALUES (?, ?, ?, 0, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR))'
    )->execute([$sessionId, $row['id'], $mime, $tempName]);
    $fresh = videoIntroFindById($db, (string) $row['id']);
    respond([
        'data' => videoIntroPublicCandidateDto($db, $fresh ?: $row),
        'upload_session_id' => $sessionId,
        'max_bytes' => VIDEO_INTRO_MAX_BYTES,
        'chunk_max' => VIDEO_INTRO_CHUNK_MAX,
    ]);
}

if ($action === 'complete') {
    if ($eff === 'expired') {
        respond(['error' => 'This invitation has expired'], 410);
    }
    if ($eff === 'revoked') {
        respond(['error' => 'This invitation has been revoked'], 410);
    }
    if ($eff === 'submitted') {
        respond(['error' => 'A recording was already submitted'], 409);
    }
    $sessionId = trim((string) ($input['upload_session_id'] ?? ''));
    $durationMs = (int) ($input['duration_ms'] ?? 0);
    $sess = $db->prepare(
        'SELECT * FROM video_intro_upload_sessions WHERE id = ? AND invitation_id = ? LIMIT 1'
    );
    $sess->execute([$sessionId, $row['id']]);
    $session = $sess->fetch(PDO::FETCH_ASSOC);
    if (!$session) {
        respond(['error' => 'Upload session not found'], 404);
    }
    $temp = videoIntroTempDir() . DIRECTORY_SEPARATOR . (string) $session['temp_name'];
    if (!is_file($temp)) {
        respond(['error' => 'Uploaded file missing. Please retry.'], 400);
    }
    $size = (int) filesize($temp);
    if ($size < 1024) {
        respond(['error' => 'Recording is too small. Please record again.'], 400);
    }
    if ($size > VIDEO_INTRO_MAX_BYTES) {
        @unlink($temp);
        respond(['error' => 'Recording exceeds the maximum file size'], 413);
    }
    $mime = (string) ($session['mime_type'] ?? 'video/webm');
    if (!videoIntroLooksLikeVideo($temp, $mime)) {
        @unlink($temp);
        respond(['error' => 'That file does not look like a camera recording. Please retry in a supported browser.'], 400);
    }
    $maxMs = ((int) $row['max_duration_sec'] * 1000) + 8000;
    if ($durationMs > $maxMs) {
        @unlink($temp);
        respond(['error' => 'Recording is longer than the allowed time. Please record again.'], 400);
    }
    if ($durationMs < 1000) {
        $durationMs = 1000;
    }

    $exists = $db->prepare('SELECT id FROM video_intro_recordings WHERE invitation_id = ? LIMIT 1');
    $exists->execute([$row['id']]);
    if ($exists->fetchColumn()) {
        @unlink($temp);
        respond(['error' => 'A recording was already submitted'], 409);
    }

    $recordingId = generateUUID();
    $ext = videoIntroExtForMime($mime);
    $localAbs = videoIntroLocalDir() . DIRECTORY_SEPARATOR . $recordingId . '.' . $ext;
    if (!@rename($temp, $localAbs)) {
        if (!@copy($temp, $localAbs)) {
            respond(['error' => 'Could not store the recording'], 500);
        }
        @unlink($temp);
    }

    try {
        $db->beginTransaction();
        $db->prepare(
            'INSERT INTO video_intro_recordings
             (id, invitation_id, org_id, gcs_object, local_path, mime_type, byte_size, duration_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $recordingId,
            $row['id'],
            $row['org_id'],
            null,
            $localAbs,
            $mime,
            $size,
            $durationMs,
        ]);
        $db->prepare(
            "UPDATE video_intro_invitations SET status = 'submitted', submitted_at = NOW() WHERE id = ? AND status <> 'submitted'"
        )->execute([$row['id']]);
        $db->prepare('DELETE FROM video_intro_upload_sessions WHERE invitation_id = ?')->execute([$row['id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('[video-intro] complete: ' . $e->getMessage());
        respond(['error' => 'Could not finish submission. Please retry.'], 500);
    }
    videoIntroAddEvent($db, (string) $row['id'], 'submit_ok', null);
    $fresh = videoIntroFindById($db, (string) $row['id']);
    respond([
        'ok' => true,
        'message' => 'Recording submitted',
        'data' => videoIntroPublicCandidateDto($db, $fresh ?: $row),
    ]);
}

respond(['error' => 'Unknown action'], 400);
