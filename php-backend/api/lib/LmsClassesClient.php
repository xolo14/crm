<?php
// Direct HTTP access blocked (nginx may ignore .htaccess)
if (PHP_SAPI !== 'cli' && isset($_SERVER['SCRIPT_FILENAME']) && @realpath((string)$_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) { http_response_code(403); header('Content-Type: text/plain; charset=UTF-8'); echo 'Forbidden'; exit; }
/**
 * Thin LMS Classes (lmsclasses.com) HTTP client for CRM → LMS pushes.
 * Used by batches.php (and can be shared with lms-sync.php later).
 */

function lmsClassesBaseUrl(): string
{
    $base = defined('LMS_CLASSES_BASE_URL') ? trim((string) LMS_CLASSES_BASE_URL) : '';
    return $base !== '' ? rtrim($base, '/') : 'https://lmsclasses.com';
}

function lmsClassesApiKey(): string
{
    // Must be set in api/config.php only — never hardcode live keys in source.
    return defined('LMS_CLASSES_API_KEY') ? trim((string) LMS_CLASSES_API_KEY) : '';
}

/**
 * @return array{ok:bool,status:int,json:?array,body:string,error:?string}
 */
function lmsClassesHttp(string $method, string $path, ?array $jsonBody = null): array
{
    $key = lmsClassesApiKey();
    if ($key === '') {
        return [
            'ok' => false,
            'status' => 0,
            'json' => null,
            'body' => '',
            'error' => 'LMS_CLASSES_API_KEY is not configured',
        ];
    }
    $url = lmsClassesBaseUrl() . $path;
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
    ];
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'status' => 0, 'json' => null, 'body' => '', 'error' => 'curl_init failed'];
    }
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
    ];
    if ($jsonBody !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($jsonBody);
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        return ['ok' => false, 'status' => $status, 'json' => null, 'body' => '', 'error' => $cerr ?: 'LMS request failed'];
    }
    $decoded = json_decode((string) $body, true);
    $isJson = is_array($decoded);
    $ok = $status >= 200 && $status < 300 && $isJson;
    $err = null;
    if (!$ok) {
        if ($isJson) {
            $err = trim((string) ($decoded['message'] ?? $decoded['error'] ?? ''));
        }
        if ($err === null || $err === '') {
            $err = $status > 0 ? "LMS HTTP {$status}" : 'Could not reach LMS';
        }
    }
    return [
        'ok' => $ok,
        'status' => $status,
        'json' => $isJson ? $decoded : null,
        'body' => (string) $body,
        'error' => $err,
    ];
}

function lmsClassesOrgIsSyncpedia(PDO $db, ?string $orgId): bool
{
    $orgId = trim((string) $orgId);
    if ($orgId === '') {
        return false;
    }
    try {
        $st = $db->prepare('SELECT slug FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $slug = strtolower(trim((string) ($st->fetchColumn() ?: '')));
        return $slug === 'syncpedia' || (function_exists('syncpediaPlatformOrgSlug') && $slug === syncpediaPlatformOrgSlug());
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Whether this caller may push CRM batch changes to LMS (Syncpedia org or super_admin on Syncpedia batches).
 */
function lmsClassesCallerCanPushBatches(PDO $db, array $tokenData, ?string $batchOrgId): bool
{
    $role = function_exists('syncpediaNormalizeRoleKey')
        ? syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''))
        : strtolower(trim((string) ($tokenData['role'] ?? '')));
    if ($role === 'super_admin' || $role === 'superadmin') {
        return lmsClassesOrgIsSyncpedia($db, $batchOrgId);
    }
    if (!in_array($role, ['org', 'admin', 'manager', 'operational_manager'], true)) {
        return false;
    }
    $callerOrg = trim((string) ($tokenData['org_id'] ?? ''));
    return lmsClassesOrgIsSyncpedia($db, $callerOrg) && lmsClassesOrgIsSyncpedia($db, $batchOrgId ?: $callerOrg);
}

function lmsClassesEnsureBatchLmsIdColumn(PDO $db): bool
{
    try {
        $st = $db->query("SHOW COLUMNS FROM `batches` LIKE 'lms_id'");
        if ($st && $st->fetch()) {
            return true;
        }
    } catch (Throwable $e) {
        /* fall through */
    }
    try {
        $db->exec('ALTER TABLE `batches` ADD COLUMN `lms_id` VARCHAR(64) DEFAULT NULL');
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * After a CRM batch create, POST a matching LMS batch and store lms_id.
 *
 * @return array{pushed:bool,skipped:?string,error:?string,lms_id:?string}
 */
function lmsClassesPushBatchCreate(PDO $db, string $crmBatchId): array
{
    $crmBatchId = trim($crmBatchId);
    if ($crmBatchId === '') {
        return ['pushed' => false, 'skipped' => 'missing_id', 'error' => null, 'lms_id' => null];
    }
    if (!lmsClassesEnsureBatchLmsIdColumn($db)) {
        return ['pushed' => false, 'skipped' => 'no_lms_id_column', 'error' => null, 'lms_id' => null];
    }

    try {
        $st = $db->prepare(
            'SELECT b.id, b.name, b.lms_id, b.org_id, b.start_date, b.end_date, b.seat_limit, b.course_id,
                    c.lms_id AS course_lms_id, c.name AS course_name
             FROM batches b
             LEFT JOIN courses c ON c.id = b.course_id
             WHERE b.id = ?
             LIMIT 1'
        );
        $st->execute([$crmBatchId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return ['pushed' => false, 'skipped' => null, 'error' => 'Could not load batch for LMS create', 'lms_id' => null];
    }

    if (!$row) {
        return ['pushed' => false, 'skipped' => 'not_found', 'error' => null, 'lms_id' => null];
    }

    $existingLms = trim((string) ($row['lms_id'] ?? ''));
    if ($existingLms !== '') {
        return ['pushed' => false, 'skipped' => 'already_linked', 'error' => null, 'lms_id' => $existingLms];
    }

    $courseLmsId = trim((string) ($row['course_lms_id'] ?? ''));
    if ($courseLmsId === '') {
        return [
            'pushed' => false,
            'skipped' => 'course_not_linked',
            'error' => 'Course is not linked to LMS (missing course lms_id). Use Match LMS on Courses first, or pick an LMS-linked course.',
            'lms_id' => null,
        ];
    }

    $name = trim((string) ($row['name'] ?? ''));
    if ($name === '') {
        return ['pushed' => false, 'skipped' => null, 'error' => 'Batch name is required for LMS', 'lms_id' => null];
    }

    $startRaw = $row['start_date'] ?? null;
    if ($startRaw === null || trim((string) $startRaw) === '') {
        return [
            'pushed' => false,
            'skipped' => 'missing_start_date',
            'error' => 'Start date is required to create the batch on LMS.',
            'lms_id' => null,
        ];
    }

    $start = substr((string) $startRaw, 0, 10) . 'T00:00:00.000Z';
    $end = !empty($row['end_date']) ? (substr((string) $row['end_date'], 0, 10) . 'T00:00:00.000Z') : null;
    $maxSlots = (int) ($row['seat_limit'] ?? 30);
    if ($maxSlots <= 0) {
        $maxSlots = 30;
    }

    $body = [
        'name' => $name,
        'courseId' => $courseLmsId,
        'startDate' => $start,
        'endDate' => $end,
        'maxSlots' => $maxSlots,
    ];

    $res = lmsClassesHttp('POST', '/api/external/pages/batches', $body);
    if (!$res['ok']) {
        return [
            'pushed' => false,
            'skipped' => null,
            'error' => $res['error'] ?: 'LMS batch create failed',
            'lms_id' => null,
        ];
    }

    $lmsId = '';
    if (is_array($res['json']['data'] ?? null)) {
        $lmsId = trim((string) ($res['json']['data']['id'] ?? ''));
    } elseif (is_array($res['json'])) {
        $lmsId = trim((string) ($res['json']['id'] ?? ''));
    }
    if ($lmsId === '') {
        return [
            'pushed' => false,
            'skipped' => null,
            'error' => 'LMS created the batch but returned no id',
            'lms_id' => null,
        ];
    }

    try {
        $db->prepare('UPDATE batches SET lms_id = ? WHERE id = ?')->execute([$lmsId, $crmBatchId]);
    } catch (Throwable $e) {
        return [
            'pushed' => true,
            'skipped' => null,
            'error' => 'Created on LMS but failed to save lms_id on CRM: ' . $e->getMessage(),
            'lms_id' => $lmsId,
        ];
    }

    return ['pushed' => true, 'skipped' => null, 'error' => null, 'lms_id' => $lmsId];
}

/**
 * After a CRM batch update, PATCH the linked LMS batch when applicable.
 *
 * @return array{pushed:bool,skipped:?string,error:?string}
 */
function lmsClassesPushBatchUpdate(PDO $db, string $crmBatchId): array
{
    $crmBatchId = trim($crmBatchId);
    if ($crmBatchId === '') {
        return ['pushed' => false, 'skipped' => 'missing_id', 'error' => null];
    }

    if (!lmsClassesEnsureBatchLmsIdColumn($db)) {
        return ['pushed' => false, 'skipped' => 'no_lms_id_column', 'error' => null];
    }

    try {
        $st = $db->prepare(
            'SELECT b.id, b.name, b.lms_id, b.org_id, b.start_date, b.end_date, b.seat_limit, b.course_id,
                    c.lms_id AS course_lms_id
             FROM batches b
             LEFT JOIN courses c ON c.id = b.course_id
             WHERE b.id = ?
             LIMIT 1'
        );
        $st->execute([$crmBatchId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return ['pushed' => false, 'skipped' => null, 'error' => 'Could not load batch for LMS push'];
    }

    if (!$row) {
        return ['pushed' => false, 'skipped' => 'not_found', 'error' => null];
    }

    $lmsId = trim((string) ($row['lms_id'] ?? ''));
    if ($lmsId === '') {
        return ['pushed' => false, 'skipped' => 'not_linked', 'error' => null];
    }

    $courseLmsId = trim((string) ($row['course_lms_id'] ?? ''));
    if ($courseLmsId === '') {
        // Keep existing LMS courseId from current LMS record
        $detail = lmsClassesHttp('GET', '/api/external/pages/batches/' . rawurlencode($lmsId));
        if ($detail['ok'] && is_array($detail['json']['data'] ?? null)) {
            $courseLmsId = trim((string) ($detail['json']['data']['courseId'] ?? ''));
        } elseif ($detail['ok'] && is_array($detail['json'])) {
            $courseLmsId = trim((string) ($detail['json']['courseId'] ?? ''));
        }
    }
    if ($courseLmsId === '') {
        return ['pushed' => false, 'skipped' => null, 'error' => 'Linked LMS batch has no course id to update'];
    }

    $start = $row['start_date'] ? (substr((string) $row['start_date'], 0, 10) . 'T00:00:00.000Z') : null;
    $end = $row['end_date'] ? (substr((string) $row['end_date'], 0, 10) . 'T00:00:00.000Z') : null;
    $maxSlots = (int) ($row['seat_limit'] ?? 30);
    if ($maxSlots <= 0) {
        $maxSlots = 30;
    }

    $body = [
        'name' => (string) ($row['name'] ?? ''),
        'courseId' => $courseLmsId,
        'startDate' => $start,
        'endDate' => $end,
        'maxSlots' => $maxSlots,
    ];

    $res = lmsClassesHttp('PATCH', '/api/external/pages/batches/' . rawurlencode($lmsId), $body);
    if (!$res['ok']) {
        return [
            'pushed' => false,
            'skipped' => null,
            'error' => $res['error'] ?: 'LMS batch update failed',
        ];
    }
    return ['pushed' => true, 'skipped' => null, 'error' => null];
}
