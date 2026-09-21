<?php
/**
 * Mobile / Android call sync API.
 *
 * GET  /api/calls.php?page=1&limit=50
 * POST /api/calls.php  (multipart/form-data or JSON)
 *
 * Uses existing call_logs table; ensures mobile sync columns exist at runtime.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/CallLogDailyReportSync.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

/** Ensure call_logs has mobile sync columns + unique device key. */
function callsEnsureMobileColumns(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'call_logs', 'device_call_id')) {
            $db->exec('ALTER TABLE call_logs ADD COLUMN device_call_id VARCHAR(64) DEFAULT NULL');
        }
        if (!syncpediaColumnExists($db, 'call_logs', 'latitude')) {
            $db->exec('ALTER TABLE call_logs ADD COLUMN latitude DECIMAL(10,7) DEFAULT NULL');
        }
        if (!syncpediaColumnExists($db, 'call_logs', 'longitude')) {
            $db->exec('ALTER TABLE call_logs ADD COLUMN longitude DECIMAL(10,7) DEFAULT NULL');
        }
        if (!syncpediaColumnExists($db, 'call_logs', 'synced_at')) {
            $db->exec('ALTER TABLE call_logs ADD COLUMN synced_at TIMESTAMP NULL DEFAULT NULL');
        }
        try {
            $db->exec('ALTER TABLE call_logs MODIFY COLUMN client_phone VARCHAR(40) DEFAULT NULL');
        } catch (Throwable $e) {
        }
        try {
            $idx = $db->query("SHOW INDEX FROM call_logs WHERE Key_name = 'uq_calllog_rep_device'");
            $exists = $idx && $idx->fetch(PDO::FETCH_ASSOC);
            if (!$exists) {
                $db->exec(
                    'ALTER TABLE call_logs ADD UNIQUE KEY uq_calllog_rep_device (sales_rep_id, device_call_id)'
                );
            }
        } catch (Throwable $e) {
            // Index may already exist under another name, or NULLs conflict — ignore.
        }
    } catch (Throwable $e) {
        error_log('[calls] ensure mobile columns: ' . $e->getMessage());
    }
    $done = true;
}

function callsPickField(array $post, array $json, array $keys, $default = '')
{
    foreach ($keys as $k) {
        if (array_key_exists($k, $post) && $post[$k] !== null && $post[$k] !== '') {
            return $post[$k];
        }
        if (array_key_exists($k, $json) && $json[$k] !== null && $json[$k] !== '') {
            return $json[$k];
        }
    }
    return $default;
}

function callsNormalizeCallType($raw): string
{
    $v = strtolower(trim((string) $raw));
    $map = [
        '1' => 'incoming',
        'incoming' => 'incoming',
        'in' => 'incoming',
        '2' => 'outgoing',
        'outgoing' => 'outgoing',
        'out' => 'outgoing',
        '3' => 'missed',
        'missed' => 'missed',
        'miss' => 'missed',
        '4' => 'missed',
        'voicemail' => 'missed',
        '5' => 'rejected',
        'rejected' => 'rejected',
        'reject' => 'rejected',
        'declined' => 'rejected',
        '6' => 'rejected',
        'blocked' => 'rejected',
        '7' => 'incoming',
        'answered_externally' => 'incoming',
    ];
    return $map[$v] ?? $v;
}

/** @return array{0:string,1:string}|null [call_date, call_time] */
function callsParseCalledAt($raw): ?array
{
    if ($raw === null || $raw === '') {
        return null;
    }
    if (is_numeric($raw)) {
        $sec = (int) $raw;
        if ($sec > 20000000000) {
            $sec = (int) floor($sec / 1000);
        }
        if ($sec > 0) {
            try {
                $dt = (new DateTimeImmutable('@' . $sec))->setTimezone(new DateTimeZone('Asia/Kolkata'));
                return [$dt->format('Y-m-d'), $dt->format('H:i:s')];
            } catch (Throwable $e) {
                return null;
            }
        }
    }
    $iso = trim((string) $raw);
    if ($iso === '') {
        return null;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $iso)) {
        return [$iso, '00:00:00'];
    }
    try {
        $dt = new DateTimeImmutable($iso);
    } catch (Throwable $e) {
        try {
            $dt = new DateTimeImmutable(str_replace('Z', '+00:00', $iso));
        } catch (Throwable $e2) {
            return null;
        }
    }
    try {
        $dt = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'));
    } catch (Throwable $e) {
    }
    return [$dt->format('Y-m-d'), $dt->format('H:i:s')];
}

function callsNormalizeDeviceCallId(string $id, string $phone, string $calledAt, string $type, int $duration): string
{
    $id = trim($id);
    if ($id === '' || $id === '0' || $id === '-1' || strtolower($id) === 'null') {
        $id = substr(hash('sha256', $phone . '|' . $calledAt . '|' . $type . '|' . $duration), 0, 40);
    }
    if (strlen($id) > 64) {
        $id = substr(hash('sha256', $id), 0, 64);
    }
    return $id;
}

function callsSanitizePhone(string $phone): string
{
    $phone = trim($phone);
    $phone = preg_replace('/[^\d+]/', '', $phone) ?? $phone;
    if (strlen($phone) > 40) {
        $phone = substr($phone, 0, 40);
    }
    return $phone;
}

/**
 * Store optional recording. Returns null on missing/invalid file (does not abort the call insert).
 */
function callsStoreRecording(PDO $db, string $orgId, string $userId, array $file): ?string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        error_log('[calls] recording upload error code ' . (string) ($file['error'] ?? ''));
        return null;
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > 25 * 1024 * 1024) {
        return null;
    }
    $orig = (string) ($file['name'] ?? '');
    $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    $allowedExt = ['mp3', 'm4a', 'aac', 'amr', 'wav', '3gp', 'ogg', 'webm'];
    $allowedMime = [
        'audio/mpeg',
        'audio/mp3',
        'audio/mp4',
        'audio/x-m4a',
        'audio/aac',
        'audio/aacp',
        'audio/wav',
        'audio/x-wav',
        'audio/amr',
        'audio/3gpp',
        'audio/3gpp2',
        'audio/ogg',
        'audio/webm',
        'video/3gpp',
        'video/3gpp2',
        'video/mp4',
        'application/octet-stream',
    ];
    $tmp = (string) ($file['tmp_name'] ?? '');
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        return null;
    }
    $detectedMime = '';
    if (function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        if ($fi) {
            $detectedMime = strtolower(trim((string) finfo_file($fi, $tmp)));
            finfo_close($fi);
        }
    }
    if ($detectedMime === '' && !empty($file['type'])) {
        $detectedMime = strtolower(trim((string) $file['type']));
    }
    if ($ext === '' || !in_array($ext, $allowedExt, true)) {
        if (in_array($detectedMime, ['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/aacp', 'video/mp4'], true)) {
            $ext = 'm4a';
        } elseif (in_array($detectedMime, ['audio/mpeg', 'audio/mp3'], true)) {
            $ext = 'mp3';
        } elseif (in_array($detectedMime, ['audio/wav', 'audio/x-wav'], true)) {
            $ext = 'wav';
        } elseif ($detectedMime === 'audio/amr') {
            $ext = 'amr';
        } elseif (in_array($detectedMime, ['audio/3gpp', 'audio/3gpp2', 'video/3gpp', 'video/3gpp2'], true)) {
            $ext = '3gp';
        } elseif ($detectedMime === 'audio/ogg') {
            $ext = 'ogg';
        } elseif ($detectedMime === 'audio/webm') {
            $ext = 'webm';
        } else {
            $ext = 'm4a';
        }
    }
    if (!in_array($ext, $allowedExt, true)) {
        $ext = 'm4a';
    }
    if (
        $detectedMime !== ''
        && !in_array($detectedMime, $allowedMime, true)
        && strpos($detectedMime, 'audio/') !== 0
        && strpos($detectedMime, 'video/') !== 0
    ) {
        error_log('[calls] skip recording mime ' . $detectedMime);
        return null;
    }

    try {
        $dirRel = callRecordingRelativeDir($db, $orgId, $userId);
        $dirAbs = callRecordingEnsureAbsoluteDir($dirRel);
    } catch (Throwable $e) {
        error_log('[calls] recording dir: ' . $e->getMessage());
        return null;
    }
    $name = generateUUID() . '.' . $ext;
    $dest = rtrim($dirAbs, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name;
    if (!@move_uploaded_file($tmp, $dest)) {
        error_log('[calls] move_uploaded_file failed');
        return null;
    }
    return rtrim($dirRel, '/') . '/' . $name;
}

callsEnsureMobileColumns($db);

if ($method === 'GET') {
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $limit = (int) ($_GET['limit'] ?? 50);
    if ($limit < 1) {
        $limit = 50;
    }
    if ($limit > 200) {
        $limit = 200;
    }
    $offset = ($page - 1) * $limit;

    $elevated = in_array($role, ['admin', 'org', 'manager', 'super_admin', 'operational_manager'], true);
    if ($elevated) {
        $org = orgFilter($tokenData, 'cl', $db);
        $where = [$org['where']];
        $params = $org['params'];
    } else {
        // App sync: always return this user's rows even if JWT org is missing/stale.
        $where = ['cl.sales_rep_id = ?'];
        $params = [$userId];
    }

    $whereSql = implode(' AND ', $where);

    $countStmt = $db->prepare("SELECT COUNT(*) FROM call_logs cl WHERE {$whereSql}");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $sql = "SELECT cl.*
            FROM call_logs cl
            WHERE {$whereSql}
            ORDER BY cl.call_date DESC, cl.call_time DESC
            LIMIT {$limit} OFFSET {$offset}";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    respond([
        'data' => $rows,
        'page' => $page,
        'limit' => $limit,
        'total' => $total,
    ]);
}

if ($method === 'POST') {
    $json = getInput();
    if (!is_array($json)) {
        $json = [];
    }
    $post = $_POST;

    $phoneNumber = callsSanitizePhone((string) callsPickField($post, $json, ['phoneNumber', 'client_phone', 'phone', 'number']));
    $contactName = trim((string) callsPickField($post, $json, ['contactName', 'client_name', 'name']));
    $callType = callsNormalizeCallType(callsPickField($post, $json, ['callType', 'call_type', 'type']));
    $duration = (int) callsPickField($post, $json, ['duration', 'duration_seconds', 'durationSeconds'], 0);
    $calledAtRaw = callsPickField($post, $json, ['calledAt', 'called_at', 'timestamp', 'call_time_iso', 'dateTime']);
    $deviceCallId = trim((string) callsPickField($post, $json, ['deviceCallId', 'device_call_id', 'callId', 'android_id']));
    $leadId = trim((string) callsPickField($post, $json, ['leadId', 'lead_id']));
    $latRaw = callsPickField($post, $json, ['latitude', 'lat'], null);
    $lngRaw = callsPickField($post, $json, ['longitude', 'lng', 'lon'], null);
    $callDateIn = trim((string) callsPickField($post, $json, ['call_date', 'callDate']));
    $callTimeIn = trim((string) callsPickField($post, $json, ['call_time', 'callTime']));

    if ($phoneNumber === '') {
        $phoneNumber = 'unknown';
    }

    $allowedTypes = ['incoming', 'outgoing', 'missed', 'rejected'];
    if (!in_array($callType, $allowedTypes, true)) {
        $callType = $duration > 0 ? 'outgoing' : 'missed';
    }

    $parsed = callsParseCalledAt($calledAtRaw);
    if ($parsed === null && $callDateIn !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $callDateIn)) {
        $t = $callTimeIn !== '' ? $callTimeIn : '00:00:00';
        if (preg_match('/^\d{1,2}:\d{2}$/', $t)) {
            $t .= ':00';
        }
        $parsed = [$callDateIn, $t];
    }
    if ($parsed === null) {
        $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata'));
        $parsed = [$now->format('Y-m-d'), $now->format('H:i:s')];
    }
    [$callDate, $callTime] = $parsed;

    $deviceCallId = callsNormalizeDeviceCallId(
        $deviceCallId,
        $phoneNumber,
        $callDate . ' ' . $callTime,
        $callType,
        $duration
    );

    if ($duration < 0) {
        $duration = 0;
    }

    $latitude = null;
    $longitude = null;
    if ($latRaw !== null && $latRaw !== '') {
        if (is_numeric($latRaw)) {
            $latitude = round((float) $latRaw, 7);
            if ($latitude < -90 || $latitude > 90) {
                $latitude = null;
            }
        }
    }
    if ($lngRaw !== null && $lngRaw !== '') {
        if (is_numeric($lngRaw)) {
            $longitude = round((float) $lngRaw, 7);
            if ($longitude < -180 || $longitude > 180) {
                $longitude = null;
            }
        }
    }

    $orgId = resolveWriteOrgId($db, $tokenData);
    if ($orgId === null || trim((string) $orgId) === '') {
        try {
            $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
            $st->execute([$userId]);
            $orgId = $st->fetchColumn() ?: null;
        } catch (Throwable $e) {
            $orgId = null;
        }
    }
    if ($orgId === null || trim((string) $orgId) === '') {
        respond(['error' => 'Organization context required'], 403);
    }
    $orgId = (string) $orgId;

    if ($leadId === '') {
        $leadId = null;
    } else {
        try {
            $lst = $db->prepare('SELECT id FROM leads WHERE id = ? AND org_id = ? LIMIT 1');
            $lst->execute([$leadId, $orgId]);
            if (!$lst->fetchColumn()) {
                $leadId = null;
            }
        } catch (Throwable $e) {
            $leadId = null;
        }
    }

    $recordingFile = null;
    foreach (['recording', 'file', 'call_recording', 'audio'] as $fk) {
        if (!empty($_FILES[$fk]) && is_array($_FILES[$fk])) {
            $recordingFile = $_FILES[$fk];
            break;
        }
    }
    $attachmentPath = $recordingFile ? callsStoreRecording($db, $orgId, $userId, $recordingFile) : null;

    $callStatus = strtolower(trim((string) callsPickField($post, $json, ['callStatus', 'call_status'])));
    if (!in_array($callStatus, ['connected', 'never_attended', 'not_pickup_by_client'], true)) {
        $callStatus = 'connected';
        if ($callType === 'missed' || $callType === 'rejected') {
            $callStatus = 'never_attended';
        } elseif ($duration === 0 && $callType === 'outgoing') {
            $callStatus = 'not_pickup_by_client';
        }
    }

    $callId = 0;
    $insertError = '';
    try {
        $sql = 'INSERT INTO call_logs (
                    sales_rep_id, org_id, lead_id, call_type, call_status, duration_seconds,
                    client_phone, client_name, notes, attachment_path, call_date, call_time,
                    device_call_id, latitude, longitude, synced_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, NULL, ?, ?, ?,
                    ?, ?, ?, CURRENT_TIMESTAMP
                )
                ON DUPLICATE KEY UPDATE
                    synced_at = CURRENT_TIMESTAMP,
                    duration_seconds = VALUES(duration_seconds),
                    call_type = VALUES(call_type),
                    call_status = VALUES(call_status),
                    client_phone = VALUES(client_phone),
                    client_name = COALESCE(VALUES(client_name), client_name),
                    attachment_path = COALESCE(VALUES(attachment_path), attachment_path),
                    id = LAST_INSERT_ID(id)';
        $stmt = $db->prepare($sql);
        $stmt->execute([
            $userId,
            $orgId,
            $leadId,
            $callType,
            $callStatus,
            $duration,
            $phoneNumber,
            $contactName !== '' ? $contactName : null,
            $attachmentPath,
            $callDate,
            $callTime,
            $deviceCallId,
            $latitude,
            $longitude,
        ]);
        $callId = (int) $db->lastInsertId();
    } catch (Throwable $e) {
        $insertError = $e->getMessage();
        error_log('[calls] insert failed: ' . $insertError);
        try {
            $stmt2 = $db->prepare(
                'INSERT INTO call_logs (
                    sales_rep_id, org_id, lead_id, call_type, call_status, duration_seconds,
                    client_phone, client_name, notes, attachment_path, call_date, call_time
                ) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)'
            );
            $stmt2->execute([
                $userId,
                $orgId,
                $leadId,
                $callType,
                $callStatus,
                $duration,
                $phoneNumber,
                $contactName !== '' ? $contactName : null,
                $attachmentPath,
                $callDate,
                $callTime,
            ]);
            $callId = (int) $db->lastInsertId();
        } catch (Throwable $e2) {
            $insertError = $e2->getMessage();
            error_log('[calls] fallback insert failed: ' . $insertError);
        }
    }

    if ($callId <= 0 && $deviceCallId !== '') {
        try {
            $find = $db->prepare(
                'SELECT id FROM call_logs WHERE sales_rep_id = ? AND device_call_id = ? LIMIT 1'
            );
            $find->execute([$userId, $deviceCallId]);
            $callId = (int) $find->fetchColumn();
        } catch (Throwable $e) {
        }
    }

    if ($callId <= 0) {
        respond([
            'error' => 'Could not save call log',
            'detail' => $insertError !== '' ? $insertError : 'insert returned no id',
        ], 500);
    }

    try {
        syncpediaSyncDailyReportFromCallLogs($db, $userId, $callDate, $orgId);
    } catch (Throwable $ignored) {
    }

    respond(['success' => true, 'callId' => $callId], 201);
}

respond(['error' => 'Method not allowed'], 405);
