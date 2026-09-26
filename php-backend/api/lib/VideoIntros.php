<?php
/**
 * Candidate video introductions — schema, tokens, state machine, storage.
 * Invitation tokens are hashed (SHA-256). Never log the raw token.
 */

const VIDEO_INTRO_MAX_BYTES = 83886080; // 80 MiB
const VIDEO_INTRO_CHUNK_MAX = 5242880; // 5 MiB
const VIDEO_INTRO_DEFAULT_DURATION = 90;
const VIDEO_INTRO_MIN_DURATION = 30;
const VIDEO_INTRO_MAX_DURATION = 180;
const VIDEO_INTRO_DEFAULT_RETRIES = 3;
const VIDEO_INTRO_MAX_RETRIES = 5;
const VIDEO_INTRO_RETENTION_DAYS = 90;

function videoIntroEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS video_intro_invitations (
            id CHAR(36) NOT NULL PRIMARY KEY,
            org_id CHAR(36) NOT NULL,
            created_by CHAR(36) DEFAULT NULL,
            candidate_name VARCHAR(200) NOT NULL,
            email VARCHAR(255) DEFAULT NULL,
            phone VARCHAR(40) DEFAULT NULL,
            position VARCHAR(200) DEFAULT NULL,
            token_hash CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'created',
            max_duration_sec INT NOT NULL DEFAULT 90,
            max_retries INT NOT NULL DEFAULT 3,
            retry_count INT NOT NULL DEFAULT 0,
            expires_at DATETIME NOT NULL,
            opened_at DATETIME DEFAULT NULL,
            recording_started_at DATETIME DEFAULT NULL,
            submitted_at DATETIME DEFAULT NULL,
            revoked_at DATETIME DEFAULT NULL,
            consent_at DATETIME DEFAULT NULL,
            consent_ip VARCHAR(64) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_video_intro_token (token_hash),
            INDEX idx_video_intro_org (org_id),
            INDEX idx_video_intro_status (status),
            INDEX idx_video_intro_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS video_intro_recordings (
            id CHAR(36) NOT NULL PRIMARY KEY,
            invitation_id CHAR(36) NOT NULL,
            org_id CHAR(36) NOT NULL,
            gcs_object TEXT DEFAULT NULL,
            local_path VARCHAR(500) DEFAULT NULL,
            mime_type VARCHAR(80) NOT NULL DEFAULT 'video/webm',
            byte_size INT UNSIGNED NOT NULL DEFAULT 0,
            duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
            uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_video_intro_recording_invite (invitation_id),
            INDEX idx_video_intro_rec_org (org_id),
            INDEX idx_video_intro_rec_uploaded (uploaded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    if (function_exists('syncpediaEnsureIndex')) {
        syncpediaEnsureIndex($db, 'idx_video_intro_rec_uploaded', 'video_intro_recordings', 'uploaded_at');
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS video_intro_events (
            id CHAR(36) NOT NULL PRIMARY KEY,
            invitation_id CHAR(36) NOT NULL,
            event_type VARCHAR(40) NOT NULL,
            detail VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_video_intro_ev_invite (invitation_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS video_intro_upload_sessions (
            id CHAR(36) NOT NULL PRIMARY KEY,
            invitation_id CHAR(36) NOT NULL,
            mime_type VARCHAR(80) NOT NULL DEFAULT 'video/webm',
            bytes_received INT UNSIGNED NOT NULL DEFAULT 0,
            temp_name VARCHAR(80) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            INDEX idx_video_intro_up_invite (invitation_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $done = true;
}

function videoIntroNewToken(): string
{
    $raw = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    return $raw;
}

function videoIntroHashToken(string $raw): string
{
    return hash('sha256', $raw);
}

function videoIntroTempDir(): string
{
    $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'video_intro_tmp';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    return $dir;
}

function videoIntroLocalDir(): string
{
    $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'video_intros';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    return $dir;
}

function videoIntroPublicPath(string $rawToken): string
{
    return '/intro/' . $rawToken;
}

function videoIntroPublicUrl(string $rawToken): string
{
    $base = '';
    if (defined('FRONTEND_URL')) {
        $base = rtrim((string) FRONTEND_URL, '/');
    }
    if ($base === '' || $base === '*') {
        $base = '';
    }
    return $base . videoIntroPublicPath($rawToken);
}

function videoIntroAddEvent(PDO $db, string $invitationId, string $type, ?string $detail = null): void
{
    try {
        $st = $db->prepare(
            'INSERT INTO video_intro_events (id, invitation_id, event_type, detail) VALUES (?, ?, ?, ?)'
        );
        $st->execute([generateUUID(), $invitationId, $type, $detail]);
    } catch (Throwable $e) {
        error_log('[video-intro] event: ' . $e->getMessage());
    }
}

/** @param array<string,mixed> $row */
function videoIntroEffectiveStatus(array $row): string
{
    $status = strtolower(trim((string) ($row['status'] ?? 'created')));
    if (in_array($status, ['submitted', 'revoked'], true)) {
        return $status;
    }
    $exp = trim((string) ($row['expires_at'] ?? ''));
    if ($exp !== '') {
        $ts = strtotime($exp);
        if ($ts !== false && $ts < time()) {
            return 'expired';
        }
    }
    $allowed = ['created', 'opened', 'recording', 'submitted', 'expired', 'revoked'];
    return in_array($status, $allowed, true) ? $status : 'created';
}

function videoIntroCanCandidateAct(string $effective): bool
{
    return in_array($effective, ['created', 'opened', 'recording'], true);
}

/** @param array<string,mixed> $row */
function videoIntroPublicDto(array $row, bool $includeContact = false): array
{
    $status = videoIntroEffectiveStatus($row);
    $dto = [
        'id' => (string) ($row['id'] ?? ''),
        'candidate_name' => (string) ($row['candidate_name'] ?? ''),
        'position' => (string) ($row['position'] ?? ''),
        'status' => $status,
        'max_duration_sec' => (int) ($row['max_duration_sec'] ?? VIDEO_INTRO_DEFAULT_DURATION),
        'max_retries' => (int) ($row['max_retries'] ?? VIDEO_INTRO_DEFAULT_RETRIES),
        'retry_count' => (int) ($row['retry_count'] ?? 0),
        'expires_at' => (string) ($row['expires_at'] ?? ''),
        'submitted_at' => $row['submitted_at'] ?? null,
        'retention_days' => VIDEO_INTRO_RETENTION_DAYS,
        'retries_remaining' => max(0, (int) ($row['max_retries'] ?? 3) - (int) ($row['retry_count'] ?? 0)),
    ];
    if ($includeContact) {
        $dto['email'] = $row['email'] ?? null;
        $dto['phone'] = $row['phone'] ?? null;
        $dto['org_id'] = $row['org_id'] ?? null;
        $dto['created_at'] = $row['created_at'] ?? null;
        $dto['opened_at'] = $row['opened_at'] ?? null;
        $dto['recording_started_at'] = $row['recording_started_at'] ?? null;
        $dto['revoked_at'] = $row['revoked_at'] ?? null;
        $dto['consent_at'] = $row['consent_at'] ?? null;
        $dto['created_by'] = $row['created_by'] ?? null;
    }
    return $dto;
}

/** Public candidate payload plus org display name (logo is streamed separately). */
function videoIntroPublicCandidateDto(PDO $db, array $row): array
{
    $dto = videoIntroPublicDto($row);
    $dto['org_name'] = '';
    $orgId = trim((string) ($row['org_id'] ?? ''));
    if ($orgId === '') {
        return $dto;
    }
    try {
        $st = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $dto['org_name'] = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $e) {
        $dto['org_name'] = '';
    }
    return $dto;
}

function videoIntroOrgLogoAbsPath(string $logoUrl): ?string
{
    $raw = trim($logoUrl);
    if ($raw === '') {
        return null;
    }
    if (preg_match('#^https?://#i', $raw)) {
        $path = (string) (parse_url($raw, PHP_URL_PATH) ?: '');
        $idx = strpos($path, '/uploads/org_logos/');
        $raw = $idx !== false ? substr($path, $idx) : '';
    }
    if ($raw !== '' && $raw[0] !== '/') {
        $raw = '/' . $raw;
    }
    if ($raw === '' || strpos($raw, '..') !== false || strpos($raw, '/uploads/org_logos/') !== 0) {
        return null;
    }
    $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $raw);
    $candidates = [
        dirname(__DIR__, 2) . $relUploads,
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($raw, strlen('/uploads'))),
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
    ];
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        $norm = str_replace('\\', '/', $resolved);
        if (strpos($norm, '/uploads/org_logos/') === false) {
            continue;
        }
        return $resolved;
    }
    return null;
}

/** Stream the inviting org logo for a public invitation (no JWT). Invitation id is not the secret token. */
function videoIntroStreamOrgLogo(PDO $db, string $invitationId): void
{
    $invitationId = trim($invitationId);
    if ($invitationId === '' || !preg_match('/^[0-9a-f-]{36}$/i', $invitationId)) {
        http_response_code(404);
        exit;
    }
    try {
        $st = $db->prepare(
            'SELECT o.logo_url
             FROM video_intro_invitations v
             INNER JOIN organizations o ON o.id = v.org_id
             WHERE v.id = ?
             LIMIT 1'
        );
        $st->execute([$invitationId]);
        $logo = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $e) {
        http_response_code(404);
        exit;
    }
    if ($logo === '') {
        http_response_code(404);
        exit;
    }
    if (preg_match('#^https?://#i', $logo) && strpos($logo, '/uploads/org_logos/') === false) {
        header('Location: ' . $logo, true, 302);
        exit;
    }
    $abs = videoIntroOrgLogoAbsPath($logo);
    if ($abs === null) {
        http_response_code(404);
        exit;
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
    $mime = match ($ext) {
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
        default => 'image/png',
    };
    header('Content-Type: ' . $mime);
    header('Cache-Control: public, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    readfile($abs);
    exit;
}

function videoIntroFindByToken(PDO $db, string $rawToken): ?array
{
    $rawToken = trim($rawToken);
    if ($rawToken === '' || strlen($rawToken) < 20) {
        return null;
    }
    $hash = videoIntroHashToken($rawToken);
    $st = $db->prepare('SELECT * FROM video_intro_invitations WHERE token_hash = ? LIMIT 1');
    $st->execute([$hash]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function videoIntroFindById(PDO $db, string $id): ?array
{
    $st = $db->prepare('SELECT * FROM video_intro_invitations WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function videoIntroMimeAllowed(string $mime): bool
{
    $mime = strtolower(trim($mime));
    return $mime === 'video/webm'
        || $mime === 'video/mp4'
        || str_starts_with($mime, 'video/webm')
        || str_starts_with($mime, 'video/mp4');
}

function videoIntroExtForMime(string $mime): string
{
    $mime = strtolower($mime);
    if (str_contains($mime, 'mp4')) {
        return 'mp4';
    }
    return 'webm';
}

function videoIntroLooksLikeVideo(string $absPath, string $mime): bool
{
    $fh = @fopen($absPath, 'rb');
    if ($fh === false) {
        return false;
    }
    $head = fread($fh, 12) ?: '';
    fclose($fh);
    if (strlen($head) < 4) {
        return false;
    }
    if (str_contains(strtolower($mime), 'webm') || str_contains(strtolower($mime), 'matroska')) {
        return substr($head, 0, 4) === "\x1A\x45\xDF\xA3";
    }
    if (str_contains(strtolower($mime), 'mp4')) {
        return strlen($head) >= 8 && substr($head, 4, 4) === 'ftyp';
    }
    return substr($head, 0, 4) === "\x1A\x45\xDF\xA3" || (strlen($head) >= 8 && substr($head, 4, 4) === 'ftyp');
}

/**
 * Delete recording files older than VIDEO_INTRO_RETENTION_DAYS and drop their DB rows.
 * Invitation rows are kept. Returns how many recordings were removed.
 */
function videoIntroPurgeExpiredRecordings(PDO $db): int
{
    static $ran = false;
    if ($ran) {
        return 0;
    }
    $ran = true;
    $days = (int) VIDEO_INTRO_RETENTION_DAYS;
    if ($days < 1) {
        $days = 7;
    }
    try {
        $st = $db->query(
            "SELECT id, invitation_id, local_path, gcs_object FROM video_intro_recordings
             WHERE uploaded_at < DATE_SUB(NOW(), INTERVAL {$days} DAY)"
        );
        $rows = $st ? ($st->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    } catch (Throwable $e) {
        error_log('[video-intro] purge list: ' . $e->getMessage());
        return 0;
    }
    $n = 0;
    foreach ($rows as $rec) {
        videoIntroDeleteFiles($rec['local_path'] ?? null, $rec['gcs_object'] ?? null);
        try {
            $db->prepare('DELETE FROM video_intro_recordings WHERE id = ?')->execute([(string) $rec['id']]);
            videoIntroAddEvent($db, (string) $rec['invitation_id'], 'recording_expired', (string) $days . 'd');
            $n++;
        } catch (Throwable $e) {
            error_log('[video-intro] purge row: ' . $e->getMessage());
        }
    }
    return $n;
}

function videoIntroDeleteFiles(?string $localPath, ?string $gcsObject): void
{
    $localPath = trim((string) $localPath);
    if ($localPath !== '') {
        $abs = $localPath;
        if ($localPath[0] === '/' || (strlen($localPath) > 1 && $localPath[1] === ':')) {
            $abs = $localPath;
        }
        if (is_file($abs)) {
            @unlink($abs);
        }
    }
    $gcs = trim((string) $gcsObject);
    if ($gcs !== '' && function_exists('syncpediaGcsDeleteObject')) {
        syncpediaGcsDeleteObject($gcs);
    }
}

function videoIntroRequireCaller(PDO $db, array $tokenData): void
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $row = null;
    try {
        $st = $db->prepare('SELECT role, page_access_json FROM users WHERE id = ? LIMIT 1');
        $st->execute([(string) ($tokenData['user_id'] ?? '')]);
        $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        $row = ['role' => $role, 'page_access_json' => null];
    }
    if (!userCanAccessVideoIntrosPage($tokenData, is_array($row) ? $row : null)) {
        respond(['error' => 'Forbidden — Video introductions access is disabled for this account'], 403);
    }
}

function videoIntroCanDeleteInvitation(array $tokenData): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    return in_array($role, ['super_admin', 'org', 'admin'], true);
}

function videoIntroParseRawToken(?string $inviteUrl, ?string $token): string
{
    $token = trim((string) $token);
    if ($token !== '') {
        return $token;
    }
    $url = trim((string) $inviteUrl);
    if ($url === '') {
        return '';
    }
    $path = parse_url($url, PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        $path = $url;
    }
    if (preg_match('#/intro/([A-Za-z0-9_-]+)#', $path, $m)) {
        return $m[1];
    }
    return '';
}

/** Prefer an absolute https URL for outbound mail. */
function videoIntroAbsoluteInviteUrl(string $rawToken, string $clientUrl = ''): string
{
    $clientUrl = trim($clientUrl);
    if (preg_match('#^https?://#i', $clientUrl)) {
        return $clientUrl;
    }
    $built = videoIntroPublicUrl($rawToken);
    if (preg_match('#^https?://#i', $built)) {
        return $built;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($host !== '') {
        return ($https ? 'https://' : 'http://') . $host . videoIntroPublicPath($rawToken);
    }
    return $built !== '' ? $built : videoIntroPublicPath($rawToken);
}

function videoIntroLoadMailbox(PDO $db, string $orgId, string $accountId): ?array
{
    if ($orgId === '' || $accountId === '') {
        return null;
    }
    require_once __DIR__ . '/../org_email_service.php';
    if (function_exists('syncpediaEnsureOrgEmailSchema')) {
        syncpediaEnsureOrgEmailSchema($db);
    }
    $st = $db->prepare(
        'SELECT id, slot, label, email, from_name FROM org_smtp_accounts
         WHERE org_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    );
    $st->execute([$orgId, $accountId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }
    $email = strtolower(trim((string) ($row['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    return [
        'id' => (string) ($row['id'] ?? ''),
        'email' => $email,
        'from_name' => trim((string) ($row['from_name'] ?? '')),
        'label' => trim((string) ($row['label'] ?? '')),
        'slot' => (int) ($row['slot'] ?? 0),
    ];
}

/**
 * @param array<string,mixed> $invitation
 * @param array<string,mixed> $mailbox
 * @return array{ok:bool,error?:string}
 */
function videoIntroSendInviteEmail(PDO $db, array $invitation, array $mailbox, string $inviteUrl): array
{
    require_once __DIR__ . '/../mail_transport.php';
    require_once __DIR__ . '/../org_email_service.php';
    $orgId = trim((string) ($invitation['org_id'] ?? ''));
    $to = strtolower(trim((string) ($invitation['email'] ?? '')));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invitation has no valid email'];
    }
    if (function_exists('syncpediaSetMailContext')) {
        syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'video_intros');
    }
    if (function_exists('syncpediaSetPreferredSmtpAccountId')) {
        syncpediaSetPreferredSmtpAccountId((string) ($mailbox['id'] ?? ''));
    }
    $orgName = '';
    try {
        $st = $db->prepare('SELECT name FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $orgName = trim((string) ($st->fetchColumn() ?: ''));
    } catch (Throwable $e) {
        $orgName = '';
    }
    $orgSafe = htmlspecialchars($orgName !== '' ? $orgName : 'SYNCPedia', ENT_QUOTES, 'UTF-8');
    $name = htmlspecialchars((string) ($invitation['candidate_name'] ?? ''), ENT_QUOTES, 'UTF-8');
    $position = htmlspecialchars(trim((string) ($invitation['position'] ?? '')), ENT_QUOTES, 'UTF-8');
    $expiresRaw = trim((string) ($invitation['expires_at'] ?? ''));
    $expiresLabel = $expiresRaw;
    $ts = $expiresRaw !== '' ? strtotime($expiresRaw) : false;
    if ($ts !== false) {
        $expiresLabel = date('d M Y, g:i A', $ts);
    }
    $expires = htmlspecialchars($expiresLabel, ENT_QUOTES, 'UTF-8');
    $link = htmlspecialchars($inviteUrl, ENT_QUOTES, 'UTF-8');
    $seconds = (int) ($invitation['max_duration_sec'] ?? 90);
    $subject = 'Video introduction invitation from ' . ($orgName !== '' ? $orgName : 'SYNCPedia');
    $roleLine = $position !== ''
        ? '<p>This recording is for the <strong>' . $position . '</strong> role.</p>'
        : '';
    $html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        . '<p>Hi ' . $name . ',</p>'
        . '<p><strong>' . $orgSafe . '</strong> invited you to record a short video introduction.</p>'
        . $roleLine
        . '<p>Please use this private link (it expires <strong>' . $expires . '</strong>). Record up to '
        . (int) $seconds . ' seconds. Keep the tab open until upload finishes.</p>'
        . '<p style="margin:20px 0"><a href="' . $link . '" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Record your introduction</a></p>'
        . '<p style="font-size:13px;color:#555;word-break:break-all">' . $link . '</p>'
        . '</div>';
    $fromName = trim((string) ($mailbox['from_name'] ?? ''));
    if ($fromName === '') {
        $fromName = $orgName !== '' ? $orgName : 'SYNCPedia';
    }
    if (!function_exists('syncpediaSendHtmlEmailViaSmtp')) {
        return ['ok' => false, 'error' => 'Mail transport unavailable'];
    }
    return syncpediaSendHtmlEmailViaSmtp(
        $to,
        $subject,
        $html,
        (string) ($mailbox['email'] ?? ''),
        $fromName
    );
}

function videoIntroPurgeInvitation(PDO $db, string $id): void
{
    $recSt = $db->prepare('SELECT local_path, gcs_object FROM video_intro_recordings WHERE invitation_id = ?');
    $recSt->execute([$id]);
    foreach ($recSt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $rec) {
        videoIntroDeleteFiles($rec['local_path'] ?? null, $rec['gcs_object'] ?? null);
    }
    try {
        $up = $db->prepare('SELECT temp_name FROM video_intro_upload_sessions WHERE invitation_id = ?');
        $up->execute([$id]);
        foreach ($up->fetchAll(PDO::FETCH_ASSOC) ?: [] as $os) {
            $p = videoIntroTempDir() . DIRECTORY_SEPARATOR . (string) ($os['temp_name'] ?? '');
            if ($p !== '' && is_file($p)) {
                @unlink($p);
            }
        }
        $db->prepare('DELETE FROM video_intro_upload_sessions WHERE invitation_id = ?')->execute([$id]);
    } catch (Throwable $e) {
        error_log('[video-intro] purge sessions: ' . $e->getMessage());
    }
    $db->prepare('DELETE FROM video_intro_recordings WHERE invitation_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM video_intro_events WHERE invitation_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM video_intro_invitations WHERE id = ?')->execute([$id]);
}

function videoIntroClientIp(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return substr($ip, 0, 64);
}
