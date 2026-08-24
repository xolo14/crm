<?php
/**
 * Mobile / Android call sync API.
 *
 * GET  /api/calls.php?page=1&limit=50
 * POST /api/calls.php  (multipart/form-data)
 *
 * Uses existing call_logs table; ensures mobile sync columns exist at runtime.
 */
require_once __DIR__ . '/helpers.php';
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
        // Unique (sales_rep_id, device_call_id) for idempotent mobile uploads.
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

/** @return array{0:string,1:string}|null [call_date, call_time] */
function callsParseCalledAt(string $iso): ?array
{
    $iso = trim($iso);
    if ($iso === '') {
        return null;
    }
    try {
        $dt = new DateTimeImmutable($iso);
    } catch (Throwable $e) {
        // Fallback: strip Z and try again
        try {
            $dt = new DateTimeImmutable(str_replace('Z', '+00:00', $iso));
        } catch (Throwable $e2) {
            return null;
        }
    }
    // Store in Asia/Kolkata to match CRM timezone convention.
    try {
        $dt = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'));
    } catch (Throwable $e) {
        // keep original
    }
    return [$dt->format('Y-m-d'), $dt->format('H:i:s')];
}

/**
 * Store optional recording under /uploads/recordings/{org_name}/{username}/{uuid}.{ext}
 * @return string|null relative path or null if no file
 */
function callsStoreRecording(PDO $db, string $orgId, string $userId, array $file): ?string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        respond(['error' => 'Recording upload failed'], 400);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > 25 * 1024 * 1024) {
        respond(['error' => 'Recording must be between 1 byte and 25 MB'], 422);
    }
    $orig = (string) ($file['name'] ?? '');
    $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    $allowed = ['mp3', 'm4a', 'amr', 'wav', '3gp'];
    if (!in_array($ext, $allowed, true)) {
        respond(['error' => 'Recording must be mp3, m4a, amr, wav, or 3gp'], 422);
    }
    $tmp = (string) ($file['tmp_name'] ?? '');
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        respond(['error' => 'Invalid recording upload'], 400);
    }

    $dirRel = callRecordingRelativeDir($db, $orgId, $userId);
    $dirAbs = callRecordingEnsureAbsoluteDir($dirRel);
    $name = generateUUID() . '.' . $ext;
    $dest = rtrim($dirAbs, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name;
    if (!move_uploaded_file($tmp, $dest)) {
        respond(['error' => 'Unable to save recording'], 500);
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

    $org = orgFilter($tokenData, 'cl', $db);
    $where = [$org['where']];
    $params = $org['params'];

    $elevated = in_array($role, ['admin', 'org', 'manager', 'super_admin'], true);
    if (!$elevated) {
        $where[] = 'cl.sales_rep_id = ?';
        $params[] = $userId;
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
    // Multipart from Android — read $_POST / $_FILES (not getInput()).
    $phoneNumber = trim((string) ($_POST['phoneNumber'] ?? $_POST['client_phone'] ?? ''));
    $contactName = trim((string) ($_POST['contactName'] ?? $_POST['client_name'] ?? ''));
    $callType = strtolower(trim((string) ($_POST['callType'] ?? $_POST['call_type'] ?? '')));
    $duration = (int) ($_POST['duration'] ?? $_POST['duration_seconds'] ?? 0);
    $calledAt = trim((string) ($_POST['calledAt'] ?? $_POST['called_at'] ?? ''));
    $deviceCallId = trim((string) ($_POST['deviceCallId'] ?? $_POST['device_call_id'] ?? ''));
    $leadId = trim((string) ($_POST['leadId'] ?? $_POST['lead_id'] ?? ''));
    $latRaw = $_POST['latitude'] ?? null;
    $lngRaw = $_POST['longitude'] ?? null;

    if ($phoneNumber === '' || $deviceCallId === '') {
        respond(['error' => 'phoneNumber and deviceCallId are required'], 422);
    }
    if ($calledAt === '') {
        respond(['error' => 'calledAt is required (ISO-8601)'], 422);
    }
    if (strlen($deviceCallId) > 64) {
        respond(['error' => 'deviceCallId must be at most 64 characters'], 422);
    }

    $allowedTypes = ['incoming', 'outgoing', 'missed', 'rejected'];
    if (!in_array($callType, $allowedTypes, true)) {
        respond([
            'error' => 'Invalid callType',
            'allowed' => $allowedTypes,
        ], 422);
    }

    $parsed = callsParseCalledAt($calledAt);
    if ($parsed === null) {
        respond(['error' => 'calledAt must be a valid ISO-8601 datetime'], 422);
    }
    [$callDate, $callTime] = $parsed;

    if ($duration < 0) {
        $duration = 0;
    }

    $latitude = null;
    $longitude = null;
    if ($latRaw !== null && $latRaw !== '') {
        if (!is_numeric($latRaw)) {
            respond(['error' => 'latitude must be numeric'], 422);
        }
        $latitude = round((float) $latRaw, 7);
        if ($latitude < -90 || $latitude > 90) {
            respond(['error' => 'latitude out of range'], 422);
        }
    }
    if ($lngRaw !== null && $lngRaw !== '') {
        if (!is_numeric($lngRaw)) {
            respond(['error' => 'longitude must be numeric'], 422);
        }
        $longitude = round((float) $lngRaw, 7);
        if ($longitude < -180 || $longitude > 180) {
            respond(['error' => 'longitude out of range'], 422);
        }
    }

    $orgId = resolveWriteOrgId($db, $tokenData);
    if ($orgId === null || trim((string) $orgId) === '') {
        respond(['error' => 'Organization context required'], 403);
    }
    $orgId = (string) $orgId;

    if ($leadId === '') {
        $leadId = null;
    } else {
        // Soft-validate lead belongs to same org when present.
        try {
            $lst = $db->prepare('SELECT id FROM leads WHERE id = ? AND org_id = ? LIMIT 1');
            $lst->execute([$leadId, $orgId]);
            if (!$lst->fetchColumn()) {
                respond(['error' => 'leadId not found in your organization'], 422);
            }
        } catch (Throwable $e) {
            // If leads table missing, skip FK check and let INSERT fail naturally.
        }
    }

    $recordingFile = null;
    if (!empty($_FILES['recording']) && is_array($_FILES['recording'])) {
        $recordingFile = $_FILES['recording'];
    } elseif (!empty($_FILES['file']) && is_array($_FILES['file'])) {
        $recordingFile = $_FILES['file'];
    }
    $attachmentPath = $recordingFile ? callsStoreRecording($db, $orgId, $userId, $recordingFile) : null;

    // Infer a reasonable call_status from type/duration when not provided.
    $callStatus = 'connected';
    if ($callType === 'missed' || $callType === 'rejected') {
        $callStatus = 'never_attended';
    } elseif ($duration === 0 && $callType === 'outgoing') {
        $callStatus = 'not_pickup_by_client';
    }

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
        if ($callId <= 0) {
            $find = $db->prepare(
                'SELECT id FROM call_logs WHERE sales_rep_id = ? AND device_call_id = ? LIMIT 1'
            );
            $find->execute([$userId, $deviceCallId]);
            $callId = (int) $find->fetchColumn();
        }
    } catch (Throwable $e) {
        error_log('[calls] insert failed: ' . $e->getMessage());
        respond(['error' => 'Could not save call log'], 500);
    }

    if ($callId <= 0) {
        respond(['error' => 'Could not resolve call id after save'], 500);
    }

    respond(['success' => true, 'callId' => $callId], 201);
}

respond(['error' => 'Method not allowed'], 405);
