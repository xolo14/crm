<?php
/**
 * LMS Classes (lmsclasses.com) match/diff sync + Access Users proxy.
 *
 * GET  ?action=match&resource=courses|batches
 * POST ?action=apply  { resource, add: [lms_id…], delete: [crm_id…] }
 * GET  ?action=lms_courses
 * GET  ?action=lms_batches
 * GET  ?action=lms_students
 * POST ?action=add_lms_student { name, email, phone, lms_course_id, lms_batch_id }
 * GET  ?action=lms_live_classes
 * GET  ?action=lms_live_class&id=
 * POST ?action=create_lms_live_class { title, courseId/lms_course_id, mentorId/mentor_id, scheduledAt/scheduled_at, … }
 * POST ?action=update_lms_live_class { id/lms_id, title, … }
 *
 * Syncpedia org + super_admin / org / manager only. API key stays server-side.
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));

lmsRequireAccess($db, $tokenData);
lmsEnsureSchema($db);

$orgId = lmsResolveSyncpediaOrgId($db, $tokenData);
if ($orgId === null || $orgId === '') {
    respond(['error' => 'Syncpedia organization not found'], 500);
}

if ($method === 'GET' && $action === 'match') {
    $resource = trim((string) ($_GET['resource'] ?? ''));
    if (!in_array($resource, ['courses', 'batches'], true)) {
        respond(['error' => 'resource must be courses or batches'], 400);
    }
    if ($resource === 'courses') {
        respond(lmsMatchCourses($db, $orgId));
    }
    respond(lmsMatchBatches($db, $orgId));
}

if ($method === 'POST' && $action === 'apply') {
    $input = getInput();
    $resource = trim((string) ($input['resource'] ?? ''));
    if (!in_array($resource, ['courses', 'batches'], true)) {
        respond(['error' => 'resource must be courses or batches'], 400);
    }
    $add = isset($input['add']) && is_array($input['add']) ? $input['add'] : [];
    $delete = isset($input['delete']) && is_array($input['delete']) ? $input['delete'] : [];
    if ($resource === 'courses') {
        respond(lmsApplyCourses($db, $orgId, $add, $delete));
    }
    respond(lmsApplyBatches($db, $orgId, $add, $delete));
}

if ($method === 'GET' && $action === 'lms_courses') {
    $courses = lmsFetchCoursesNormalized();
    respond(['data' => $courses]);
}

if ($method === 'GET' && $action === 'lms_batches') {
    $courseFilter = trim((string) ($_GET['lms_course_id'] ?? ''));
    $batches = lmsFetchBatchesNormalized();
    if ($courseFilter !== '') {
        $batches = array_values(array_filter(
            $batches,
            static fn($b) => (string) ($b['lms_course_id'] ?? '') === $courseFilter
        ));
    }
    respond(['data' => $batches]);
}

if ($method === 'GET' && $action === 'lms_students') {
    respond(['data' => lmsFetchStudentsNormalized()]);
}

if ($method === 'POST' && $action === 'add_lms_student') {
    $input = getInput();
    $name = trim((string) ($input['name'] ?? ''));
    $email = trim((string) ($input['email'] ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    $lmsCourseId = trim((string) ($input['lms_course_id'] ?? ''));
    $lmsBatchId = trim((string) ($input['lms_batch_id'] ?? ''));
    if ($name === '' || $email === '' || $phone === '') {
        respond(['error' => 'name, email, and phone are required'], 400);
    }
    if ($lmsCourseId === '' || $lmsBatchId === '') {
        respond(['error' => 'LMS course and LMS batch are required'], 400);
    }
    respond(lmsAddStudentOnLms($name, $email, $phone, $lmsCourseId, $lmsBatchId));
}

if ($method === 'GET' && $action === 'lms_live_classes') {
    respond(['data' => lmsFetchLiveClassesNormalized()]);
}

if ($method === 'GET' && $action === 'lms_live_class') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id is required'], 400);
    }
    respond(['data' => lmsFetchLiveClassDetail($id)]);
}

if ($method === 'POST' && $action === 'create_lms_live_class') {
    respond(lmsCreateLiveClass(getInput()));
}

if ($method === 'POST' && $action === 'update_lms_live_class') {
    respond(lmsUpdateLiveClass(getInput()));
}

respond(['error' => 'Unknown action'], 400);

// ── Access / schema ──────────────────────────────────────────────────────────

function lmsRequireAccess(PDO $db, array $tokenData): void
{
    requireRole($tokenData, ['super_admin', 'org', 'manager', 'admin']);
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $syncId = syncpediaGetOrCreateOrgId($db, (string) ($tokenData['user_id'] ?? ''));
    if ($syncId === null || $syncId === '') {
        respond(['error' => 'Syncpedia organization not found'], 500);
    }
    if ($role === 'super_admin') {
        $jwtOrg = trim((string) ($tokenData['org_id'] ?? ''));
        // Super admin master panel or Syncpedia context is allowed.
        if ($jwtOrg !== '' && strcasecmp($jwtOrg, $syncId) !== 0) {
            respond(['error' => 'LMS sync is only available for the Syncpedia organization'], 403);
        }
        return;
    }
    $userOrg = trim((string) ($tokenData['org_id'] ?? ''));
    if ($userOrg === '' || strcasecmp($userOrg, $syncId) !== 0) {
        respond(['error' => 'LMS sync is only available for the Syncpedia organization'], 403);
    }
}

function lmsResolveSyncpediaOrgId(PDO $db, array $tokenData): ?string
{
    return syncpediaGetOrCreateOrgId($db, (string) ($tokenData['user_id'] ?? ''));
}

function lmsEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    foreach (['courses', 'batches'] as $table) {
        if (!lmsColumnExists($db, $table, 'lms_id')) {
            try {
                $db->exec("ALTER TABLE `{$table}` ADD COLUMN `lms_id` VARCHAR(64) DEFAULT NULL");
            } catch (Throwable $e) {
                error_log("[lms-sync] {$table}.lms_id: " . $e->getMessage());
            }
        }
        try {
            $db->exec("CREATE INDEX `idx_{$table}_lms_id` ON `{$table}` (`lms_id`)");
        } catch (Throwable $e) {
            /* index may already exist */
        }
    }
    $done = true;
}

function lmsColumnExists(PDO $db, string $table, string $column): bool
{
    try {
        $st = $db->prepare(
            'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
        );
        $st->execute([$table, $column]);
        return (int) $st->fetchColumn() > 0;
    } catch (Throwable $e) {
        try {
            $st = $db->query("SHOW COLUMNS FROM `{$table}` LIKE " . $db->quote($column));
            return (bool) $st->fetch();
        } catch (Throwable $e2) {
            return false;
        }
    }
}

// ── Config / HTTP ────────────────────────────────────────────────────────────

function lmsBaseUrl(): string
{
    $base = defined('LMS_CLASSES_BASE_URL') ? trim((string) LMS_CLASSES_BASE_URL) : '';
    return $base !== '' ? rtrim($base, '/') : 'https://lmsclasses.com';
}

function lmsApiKey(): string
{
    // Must be set in api/config.php only — never hardcode live keys in source.
    return defined('LMS_CLASSES_API_KEY') ? trim((string) LMS_CLASSES_API_KEY) : '';
}

/**
 * @return array{ok:bool,status:int,json:?array,body:string,error:?string}
 */
function lmsHttp(string $method, string $path, ?array $jsonBody = null, bool $requireKey = true): array
{
    $key = lmsApiKey();
    if ($requireKey && $key === '') {
        return [
            'ok' => false,
            'status' => 0,
            'json' => null,
            'body' => '',
            'error' => 'LMS_CLASSES_API_KEY is not configured on the server',
        ];
    }
    $url = lmsBaseUrl() . $path;
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
    ];
    if ($key !== '') {
        $headers[] = 'Authorization: Bearer ' . $key;
    }
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
    return [
        'ok' => $ok,
        'status' => $status,
        'json' => $isJson ? $decoded : null,
        'body' => (string) $body,
        'error' => $ok ? null : lmsExtractErrorMessage($status, $isJson ? $decoded : null, (string) $body),
    ];
}

function lmsExtractErrorMessage(int $status, ?array $json, string $body): string
{
    if (is_array($json)) {
        $msg = trim((string) ($json['message'] ?? $json['error'] ?? ''));
        if ($msg !== '') {
            return $msg;
        }
    }
    if ($status === 403) {
        return 'LMS API key is missing the required permission. Enable get_course_list / get_batch_schedule (and student scopes) on the key.';
    }
    if ($status === 404) {
        return 'LMS endpoint not found for this resource. Enable the student-list / create permission on the LMS API key if available.';
    }
    if ($status === 0) {
        return 'Could not reach lmsclasses.com';
    }
    $snip = trim(preg_replace('/\s+/', ' ', substr($body, 0, 160)) ?? '');
    return $snip !== '' ? $snip : ("LMS HTTP {$status}");
}

function lmsNormalizeKey(string $value): string
{
    return strtolower(trim(preg_replace('/\s+/', ' ', $value) ?? ''));
}

/**
 * Unwrap list payloads: array of rows, or { data: [] }, { courses: [] }, etc.
 * @return list<array>
 */
function lmsUnwrapList(?array $json, array $keys = ['data', 'courses', 'batches', 'students', 'items', 'results']): array
{
    if ($json === null) {
        return [];
    }
    if ($json === []) {
        return [];
    }
    // Numeric list
    if (array_keys($json) === range(0, count($json) - 1)) {
        $out = [];
        foreach ($json as $row) {
            if (is_array($row)) {
                $out[] = $row;
            }
        }
        return $out;
    }
    foreach ($keys as $k) {
        if (isset($json[$k]) && is_array($json[$k])) {
            return lmsUnwrapList($json[$k], $keys);
        }
    }
    return [];
}

function lmsRowId(array $row): string
{
    foreach (['id', 'lms_id', 'courseId', 'course_id', 'batchId', 'batch_id', 'studentId', 'student_id', 'uuid'] as $k) {
        if (isset($row[$k]) && trim((string) $row[$k]) !== '') {
            return trim((string) $row[$k]);
        }
    }
    return '';
}

function lmsRowName(array $row): string
{
    foreach (['title', 'name', 'courseName', 'course_name', 'batchName', 'batch_name', 'fullName', 'full_name'] as $k) {
        if (isset($row[$k]) && trim((string) $row[$k]) !== '') {
            return trim((string) $row[$k]);
        }
    }
    return '';
}

// ── LMS fetchers ─────────────────────────────────────────────────────────────

/**
 * @return list<array{lms_id:string,name:string,description:string,price:float,duration_weeks:?int,raw:array}>
 */
function lmsFetchCoursesNormalized(): array
{
    $rows = [];
    $source = 'pages';
    // Page-scoped key (Students / Live Courses / Batches / Live Classes)
    $pages = lmsHttp('GET', '/api/external/pages/live-courses');
    if ($pages['ok']) {
        $rows = lmsUnwrapList($pages['json'], ['data', 'courses', 'items', 'results']);
    }
    if ($rows === []) {
        $res = lmsHttp('GET', '/api/external/courses');
        if ($res['ok']) {
            $rows = lmsUnwrapList($res['json'], ['data', 'courses', 'items', 'results']);
            $source = 'external';
        } else {
            // Public catalogue fallback (no key required)
            $pub = lmsHttp('GET', '/api/public/courses', null, false);
            if (!$pub['ok']) {
                respond([
                    'error' => $pages['error'] ?: ($res['error'] ?: ($pub['error'] ?: 'Could not load LMS courses')),
                    'hint' => 'Enable Live Courses page access on the LMS API key, or ensure /api/public/courses is reachable.',
                ], 502);
            }
            $rows = lmsUnwrapList($pub['json'], ['data', 'courses', 'items', 'results']);
            $source = 'public';
            if ($rows === [] && is_array($pub['json'])) {
                $rows = lmsUnwrapList($pub['json']);
            }
        }
    }
    $out = [];
    foreach ($rows as $row) {
        $id = lmsRowId($row);
        $name = lmsRowName($row);
        if ($id === '' || $name === '') {
            continue;
        }
        $price = (float) ($row['price'] ?? 0);
        $durationWeeks = null;
        if (isset($row['duration_weeks']) && is_numeric($row['duration_weeks'])) {
            $durationWeeks = (int) $row['duration_weeks'];
        } elseif (!empty($row['duration']) && is_numeric($row['duration'])) {
            $durationWeeks = (int) $row['duration'];
        } elseif (!empty($row['duration']) && preg_match('/(\d+)/', (string) $row['duration'], $m)) {
            $durationWeeks = (int) $m[1];
        }
        $out[] = [
            'lms_id' => $id,
            'name' => $name,
            'description' => trim((string) ($row['description'] ?? '')),
            'price' => $price,
            'duration_weeks' => $durationWeeks,
            'source' => $source,
            'raw' => $row,
        ];
    }
    return $out;
}

/**
 * @return list<array{lms_id:string,name:string,lms_course_id:string,lms_course_name:string,start_date:?string,end_date:?string,seat_limit:int,raw:array}>
 */
function lmsFetchBatchesNormalized(): array
{
    $paths = [
        '/api/external/pages/batches',
        '/api/external/batches',
        '/api/external/batch-schedules',
        '/api/external/batch_schedules',
        '/api/external/schedules',
    ];
    $lastError = 'Could not load LMS batches';
    $rows = [];
    foreach ($paths as $path) {
        $res = lmsHttp('GET', $path);
        if ($res['ok']) {
            $rows = lmsUnwrapList($res['json'], ['data', 'batches', 'schedules', 'items', 'results']);
            if ($rows !== []) {
                break;
            }
            continue;
        }
        $lastError = (string) ($res['error'] ?: $lastError);
        $st = (int) $res['status'];
        // Older /api/external/batches scopes may 403 while pages/batches works — keep trying
        if ($path === '/api/external/pages/batches' && ($st === 401 || $st === 403)) {
            respond([
                'error' => $lastError,
                'hint' => $st === 401
                    ? 'LMS API key is invalid. Update LMS_CLASSES_API_KEY in api/config.php.'
                    : 'In lmsclasses.com → API keys, enable Batches page access on this key.',
            ], 502);
        }
    }
    if ($rows === []) {
        respond([
            'error' => $lastError,
            'hint' => 'Enable Batches page access on the LMS API key (GET /api/external/pages/batches).',
        ], 502);
    }
    $out = [];
    foreach ($rows as $row) {
        $id = lmsRowId($row);
        $name = lmsRowName($row);
        if ($id === '' || $name === '') {
            continue;
        }
        $courseId = '';
        foreach (['courseId', 'course_id', 'lms_course_id', 'courseID'] as $k) {
            if (!empty($row[$k])) {
                $courseId = trim((string) $row[$k]);
                break;
            }
        }
        if ($courseId === '' && isset($row['course']) && is_array($row['course'])) {
            $courseId = lmsRowId($row['course']);
        }
        $courseName = '';
        foreach (['courseTitle', 'courseName', 'course_name', 'course_title'] as $k) {
            if (!empty($row[$k])) {
                $courseName = trim((string) $row[$k]);
                break;
            }
        }
        if ($courseName === '' && isset($row['course']) && is_array($row['course'])) {
            $courseName = lmsRowName($row['course']);
        }
        $start = null;
        $end = null;
        foreach (['start_date', 'startDate', 'starts_at', 'start'] as $k) {
            if (!empty($row[$k])) {
                $start = substr((string) $row[$k], 0, 10);
                break;
            }
        }
        foreach (['end_date', 'endDate', 'ends_at', 'end'] as $k) {
            if (!empty($row[$k])) {
                $end = substr((string) $row[$k], 0, 10);
                break;
            }
        }
        $seat = (int) ($row['seat_limit'] ?? $row['seatLimit'] ?? $row['maxSlots'] ?? $row['capacity'] ?? 30);
        if ($seat <= 0) {
            $seat = 30;
        }
        $out[] = [
            'lms_id' => $id,
            'name' => $name,
            'lms_course_id' => $courseId,
            'lms_course_name' => $courseName,
            'start_date' => $start,
            'end_date' => $end,
            'seat_limit' => $seat,
            'raw' => $row,
        ];
    }
    return $out;
}

/**
 * @return list<array{lms_id:string,name:string,email:string,phone:string,lms_course_id:string,lms_course_name:string,lms_batch_id:string,lms_batch_name:string}>
 */
function lmsFetchStudentsNormalized(): array
{
    $paths = [
        '/api/external/pages/students',
        '/api/external/students',
        '/api/external/student-list',
        '/api/external/students/list',
        '/api/external/get_student_list',
        '/api/external/learners',
        '/api/external/enrollments',
        '/api/external/enrollment-list',
        '/api/external/members',
        '/api/external/users',
    ];
    $lastError = 'LMS student list is not available for this API key';
    $rows = [];
    foreach ($paths as $path) {
        $res = lmsHttp('GET', $path);
        if ($res['ok']) {
            $rows = lmsUnwrapList($res['json'], ['data', 'students', 'enrollments', 'learners', 'users', 'members', 'items', 'results']);
            if ($rows !== []) {
                break;
            }
            continue;
        }
        $lastError = (string) ($res['error'] ?: $lastError);
        $st = (int) $res['status'];
        if ($path === '/api/external/pages/students' && ($st === 401 || $st === 403)) {
            respond([
                'error' => $lastError,
                'hint' => 'Enable Students page access on the LMS API key (GET /api/external/pages/students).',
            ], 502);
        }
    }
    if ($rows === []) {
        respond([
            'error' => $lastError,
            'hint' => 'Enable Students page access on the LMS API key (GET /api/external/pages/students).',
        ], 502);
    }
    $out = [];
    foreach ($rows as $row) {
        $id = lmsRowId($row);
        $name = lmsRowName($row);
        $email = trim((string) ($row['email'] ?? $row['Email'] ?? ''));
        $phone = trim((string) ($row['phone'] ?? $row['Phone'] ?? $row['mobile'] ?? ''));
        if ($id === '' && $email === '') {
            continue;
        }
        if ($id === '') {
            $id = $email;
        }
        if ($name === '') {
            $name = $email !== '' ? $email : $id;
        }
        $courseId = trim((string) ($row['courseId'] ?? $row['course_id'] ?? $row['lms_course_id'] ?? ''));
        $batchId = trim((string) ($row['batchId'] ?? $row['batch_id'] ?? $row['lms_batch_id'] ?? ''));
        $courseName = trim((string) ($row['courseName'] ?? $row['course_name'] ?? $row['courseTitle'] ?? ''));
        $batchName = trim((string) ($row['batchName'] ?? $row['batch_name'] ?? ''));
        if (isset($row['course']) && is_array($row['course'])) {
            if ($courseId === '') {
                $courseId = lmsRowId($row['course']);
            }
            if ($courseName === '') {
                $courseName = lmsRowName($row['course']);
            }
        }
        if (isset($row['batch']) && is_array($row['batch'])) {
            if ($batchId === '') {
                $batchId = lmsRowId($row['batch']);
            }
            if ($batchName === '') {
                $batchName = lmsRowName($row['batch']);
            }
        }
        $out[] = [
            'lms_id' => $id,
            'name' => $name,
            'email' => $email,
            'phone' => $phone,
            'lms_id_code' => trim((string) ($row['lmsId'] ?? $row['lms_id_code'] ?? '')),
            'lms_course_id' => $courseId,
            'lms_course_name' => $courseName,
            'lms_batch_id' => $batchId,
            'lms_batch_name' => $batchName,
        ];
    }
    return $out;
}

function lmsAddStudentOnLms(string $name, string $email, string $phone, string $lmsCourseId, string $lmsBatchId): array
{
    // LMS pages API requires password + confirmPassword (10-digit phone).
    $password = 'Sp' . bin2hex(random_bytes(4)) . '!1';
    $phoneDigits = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($phoneDigits) > 10) {
        $phoneDigits = substr($phoneDigits, -10);
    }
    $payloads = [
        [
            'path' => '/api/external/pages/students',
            'body' => [
                'name' => $name,
                'email' => $email,
                'phone' => $phoneDigits !== '' ? $phoneDigits : $phone,
                'password' => $password,
                'confirmPassword' => $password,
                'courseId' => $lmsCourseId,
                'batchId' => $lmsBatchId,
            ],
        ],
        [
            'path' => '/api/external/students',
            'body' => [
                'name' => $name,
                'fullName' => $name,
                'email' => $email,
                'phone' => $phone,
                'courseId' => $lmsCourseId,
                'course_id' => $lmsCourseId,
                'batchId' => $lmsBatchId,
                'batch_id' => $lmsBatchId,
            ],
        ],
        [
            'path' => '/api/external/enrollments',
            'body' => [
                'name' => $name,
                'fullName' => $name,
                'email' => $email,
                'phone' => $phone,
                'courseId' => $lmsCourseId,
                'batchId' => $lmsBatchId,
            ],
        ],
    ];
    $lastError = 'LMS does not expose a create/enroll student endpoint for this API key yet';
    foreach ($payloads as $attempt) {
        $res = lmsHttp('POST', $attempt['path'], $attempt['body']);
        if ($res['ok']) {
            return [
                'message' => 'Student added on LMS',
                'temporary_password' => $password,
                'data' => $res['json'],
            ];
        }
        // Endpoint exists but validation/business error — surface it
        if (in_array((int) $res['status'], [400, 409, 422], true)) {
            $detail = $res['error'] ?: 'LMS rejected the student';
            if (is_array($res['json']['fields']['fieldErrors'] ?? null)) {
                $bits = [];
                foreach ($res['json']['fields']['fieldErrors'] as $field => $msgs) {
                    if (is_array($msgs)) {
                        $bits[] = $field . ': ' . implode(', ', $msgs);
                    }
                }
                if ($bits !== []) {
                    $detail .= ' — ' . implode('; ', $bits);
                }
            }
            respond(['error' => $detail], (int) $res['status']);
        }
        if ((int) $res['status'] === 403) {
            respond([
                'error' => $res['error'] ?: 'Permission denied',
                'hint' => 'Enable Students page access on the LMS API key.',
            ], 502);
        }
        $lastError = (string) ($res['error'] ?: $lastError);
    }
    respond([
        'error' => $lastError,
        'hint' => 'Tried POST /api/external/pages/students (requires Students page on the key).',
    ], 502);
}

// ── Live classes (pages API) ─────────────────────────────────────────────────

/**
 * @return list<array{
 *   lms_id:string,title:string,lms_course_id:string,lms_course_name:string,
 *   lms_batch_id:string,mentor_id:string,scheduled_at:?string,status:string,
 *   meeting_link:string,duration_minutes:int,raw:array
 * }>
 */
function lmsFetchLiveClassesNormalized(): array
{
    $res = lmsHttp('GET', '/api/external/pages/live-classes');
    if (!$res['ok']) {
        respond([
            'error' => $res['error'] ?: 'Could not load LMS live classes',
            'hint' => 'Enable Live Classes page access on the LMS API key (GET /api/external/pages/live-classes).',
        ], 502);
    }
    $rows = lmsUnwrapList($res['json'], ['data', 'liveClasses', 'live_classes', 'classes', 'items', 'results']);
    $out = [];
    foreach ($rows as $row) {
        $norm = lmsNormalizeLiveClassRow($row);
        if ($norm !== null) {
            $out[] = $norm;
        }
    }
    return $out;
}

function lmsFetchLiveClassDetail(string $id): array
{
    $res = lmsHttp('GET', '/api/external/pages/live-classes/' . rawurlencode($id));
    if (!$res['ok']) {
        respond([
            'error' => $res['error'] ?: 'Could not load live class',
            'hint' => 'Enable Live Classes page access on the LMS API key.',
        ], 502);
    }
    $json = $res['json'];
    $row = null;
    if (is_array($json)) {
        if (isset($json['data']) && is_array($json['data']) && !isset($json['data'][0])) {
            $row = $json['data'];
        } elseif (isset($json['id']) || isset($json['title'])) {
            $row = $json;
        }
    }
    if (!is_array($row)) {
        respond(['error' => 'Unexpected live class payload from LMS'], 502);
    }
    $norm = lmsNormalizeLiveClassRow($row);
    if ($norm === null) {
        respond(['error' => 'Live class missing id/title'], 502);
    }
    return $norm;
}

/**
 * @param array $row
 * @return ?array{
 *   lms_id:string,title:string,lms_course_id:string,lms_course_name:string,
 *   lms_batch_id:string,mentor_id:string,scheduled_at:?string,status:string,
 *   meeting_link:string,duration_minutes:int,raw:array
 * }
 */
function lmsNormalizeLiveClassRow(array $row): ?array
{
    $id = lmsRowId($row);
    $title = trim((string) ($row['title'] ?? $row['name'] ?? ''));
    if ($id === '' || $title === '') {
        return null;
    }
    $courseId = trim((string) ($row['courseId'] ?? $row['course_id'] ?? $row['lms_course_id'] ?? ''));
    $courseName = trim((string) ($row['courseTitle'] ?? $row['courseName'] ?? $row['course_name'] ?? ''));
    $batchId = trim((string) ($row['batchId'] ?? $row['batch_id'] ?? $row['lms_batch_id'] ?? ''));
    $mentorId = trim((string) ($row['mentorId'] ?? $row['mentor_id'] ?? ''));
    $scheduled = null;
    foreach (['scheduledAt', 'scheduled_at', 'startsAt', 'start_date'] as $k) {
        if (!empty($row[$k])) {
            $scheduled = (string) $row[$k];
            break;
        }
    }
    $status = trim((string) ($row['status'] ?? ''));
    $link = trim((string) ($row['meetingLink'] ?? $row['meeting_link'] ?? ''));
    $duration = (int) ($row['duration'] ?? $row['duration_minutes'] ?? $row['durationMinutes'] ?? 0);
    if ($duration < 0) {
        $duration = 0;
    }
    return [
        'lms_id' => $id,
        'title' => $title,
        'lms_course_id' => $courseId,
        'lms_course_name' => $courseName,
        'lms_batch_id' => $batchId,
        'mentor_id' => $mentorId,
        'scheduled_at' => $scheduled,
        'status' => $status,
        'meeting_link' => $link,
        'duration_minutes' => $duration,
        'raw' => $row,
    ];
}

/**
 * @param array $input
 * @return array{title:string,courseId:string,mentorId:string,scheduledAt:string,batchId:?string,meetingLink:?string,duration:?int,status:?string}
 */
function lmsLiveClassPayloadFromInput(array $input, bool $requireCore): array
{
    $title = trim((string) ($input['title'] ?? ''));
    $courseId = trim((string) ($input['lms_course_id'] ?? $input['courseId'] ?? $input['course_id'] ?? ''));
    $mentorId = trim((string) ($input['mentor_id'] ?? $input['mentorId'] ?? ''));
    $scheduledAt = trim((string) ($input['scheduled_at'] ?? $input['scheduledAt'] ?? ''));
    $batchId = trim((string) ($input['lms_batch_id'] ?? $input['batchId'] ?? $input['batch_id'] ?? ''));
    $meetingLink = trim((string) ($input['meeting_link'] ?? $input['meetingLink'] ?? ''));
    $status = trim((string) ($input['status'] ?? ''));
    $durationRaw = $input['duration_minutes'] ?? $input['duration'] ?? null;
    $duration = is_numeric($durationRaw) ? (int) $durationRaw : null;

    if ($requireCore) {
        if ($title === '' || $courseId === '' || $mentorId === '' || $scheduledAt === '') {
            respond(['error' => 'title, LMS course, mentor id, and scheduled time are required'], 400);
        }
    }

    $body = [
        'title' => $title,
        'courseId' => $courseId,
        'mentorId' => $mentorId,
        'scheduledAt' => $scheduledAt,
    ];
    if ($batchId !== '') {
        $body['batchId'] = $batchId;
    } else {
        $body['batchId'] = null;
    }
    if ($meetingLink !== '') {
        $body['meetingLink'] = $meetingLink;
    }
    if ($duration !== null && $duration > 0) {
        $body['duration'] = $duration;
    }
    if ($status !== '') {
        $body['status'] = $status;
    }
    return $body;
}

function lmsCreateLiveClass(array $input): array
{
    $body = lmsLiveClassPayloadFromInput($input, true);
    $res = lmsHttp('POST', '/api/external/pages/live-classes', $body);
    if ($res['ok']) {
        $json = $res['json'];
        $row = is_array($json['data'] ?? null) ? $json['data'] : (is_array($json) ? $json : []);
        $norm = is_array($row) ? lmsNormalizeLiveClassRow($row) : null;
        return [
            'message' => 'Live class created on LMS',
            'data' => $norm ?? $json,
        ];
    }
    if (in_array((int) $res['status'], [400, 409, 422], true)) {
        $detail = $res['error'] ?: 'LMS rejected the live class';
        if (is_array($res['json']['fields']['fieldErrors'] ?? null)) {
            $bits = [];
            foreach ($res['json']['fields']['fieldErrors'] as $field => $msgs) {
                if (is_array($msgs)) {
                    $bits[] = $field . ': ' . implode(', ', $msgs);
                }
            }
            if ($bits !== []) {
                $detail .= ' — ' . implode('; ', $bits);
            }
        }
        respond(['error' => $detail], (int) $res['status']);
    }
    respond([
        'error' => $res['error'] ?: 'Could not create live class',
        'hint' => 'Enable Live Classes page access on the LMS API key.',
    ], 502);
}

function lmsUpdateLiveClass(array $input): array
{
    $id = trim((string) ($input['lms_id'] ?? $input['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'lms_id is required'], 400);
    }
    // Prefer a full payload (LMS PATCH is picky); fill missing required fields from current detail
    $existing = lmsFetchLiveClassDetail($id);
    $merged = [
        'title' => $input['title'] ?? $existing['title'],
        'lms_course_id' => $input['lms_course_id'] ?? $input['courseId'] ?? $existing['lms_course_id'],
        'mentor_id' => $input['mentor_id'] ?? $input['mentorId'] ?? $existing['mentor_id'],
        'scheduled_at' => $input['scheduled_at'] ?? $input['scheduledAt'] ?? $existing['scheduled_at'],
        'lms_batch_id' => array_key_exists('lms_batch_id', $input) || array_key_exists('batchId', $input)
            ? ($input['lms_batch_id'] ?? $input['batchId'] ?? '')
            : $existing['lms_batch_id'],
        'meeting_link' => array_key_exists('meeting_link', $input) || array_key_exists('meetingLink', $input)
            ? ($input['meeting_link'] ?? $input['meetingLink'] ?? '')
            : $existing['meeting_link'],
        'duration_minutes' => $input['duration_minutes'] ?? $input['duration'] ?? $existing['duration_minutes'],
        'status' => $input['status'] ?? $existing['status'],
    ];
    $body = lmsLiveClassPayloadFromInput($merged, true);
    $res = lmsHttp('PATCH', '/api/external/pages/live-classes/' . rawurlencode($id), $body);
    if ($res['ok']) {
        $json = $res['json'];
        $row = is_array($json['data'] ?? null) ? $json['data'] : (is_array($json) ? $json : []);
        $norm = is_array($row) ? lmsNormalizeLiveClassRow($row) : null;
        return [
            'message' => 'Live class updated on LMS',
            'data' => $norm ?? $json,
        ];
    }
    if (in_array((int) $res['status'], [400, 409, 422], true)) {
        $detail = $res['error'] ?: 'LMS rejected the update';
        if (is_array($res['json']['fields']['fieldErrors'] ?? null)) {
            $bits = [];
            foreach ($res['json']['fields']['fieldErrors'] as $field => $msgs) {
                if (is_array($msgs)) {
                    $bits[] = $field . ': ' . implode(', ', $msgs);
                }
            }
            if ($bits !== []) {
                $detail .= ' — ' . implode('; ', $bits);
            }
        }
        respond(['error' => $detail], (int) $res['status']);
    }
    respond([
        'error' => $res['error'] ?: 'Could not update live class',
        'hint' => 'Enable Live Classes page access on the LMS API key.',
    ], 502);
}

// ── Match / apply: courses ───────────────────────────────────────────────────

function lmsMatchCourses(PDO $db, string $orgId): array
{
    $lmsCourses = lmsFetchCoursesNormalized();
    try {
        $st = $db->prepare('SELECT id, name, lms_id, description, price FROM courses WHERE org_id = ? ORDER BY name');
        $st->execute([$orgId]);
        $crmRows = $st->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $st = $db->query('SELECT id, name, lms_id, description, price FROM courses ORDER BY name');
        $crmRows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
    }
    $crmByLms = [];
    $crmByName = [];
    foreach ($crmRows as $c) {
        $lid = trim((string) ($c['lms_id'] ?? ''));
        if ($lid !== '') {
            $crmByLms[$lid] = $c;
        }
        $nk = lmsNormalizeKey((string) ($c['name'] ?? ''));
        if ($nk !== '' && !isset($crmByName[$nk])) {
            $crmByName[$nk] = $c;
        }
    }

    $matched = [];
    $lmsOnly = [];
    $matchedCrmIds = [];

    foreach ($lmsCourses as $lc) {
        $crm = $crmByLms[$lc['lms_id']] ?? null;
        if ($crm === null) {
            $crm = $crmByName[lmsNormalizeKey($lc['name'])] ?? null;
        }
        if ($crm !== null) {
            $matched[] = [
                'lms_id' => $lc['lms_id'],
                'lms_name' => $lc['name'],
                'crm_id' => (string) $crm['id'],
                'crm_name' => (string) $crm['name'],
            ];
            $matchedCrmIds[(string) $crm['id']] = true;
        } else {
            $lmsOnly[] = [
                'lms_id' => $lc['lms_id'],
                'name' => $lc['name'],
                'description' => $lc['description'],
                'price' => $lc['price'],
                'duration_weeks' => $lc['duration_weeks'],
            ];
        }
    }

    $crmOnly = [];
    foreach ($crmRows as $c) {
        $lid = trim((string) ($c['lms_id'] ?? ''));
        if ($lid === '') {
            continue; // manual CRM rows — never auto-delete
        }
        if (isset($matchedCrmIds[(string) $c['id']])) {
            continue;
        }
        // Has lms_id but not in LMS list
        $stillInLms = false;
        foreach ($lmsCourses as $lc) {
            if ($lc['lms_id'] === $lid) {
                $stillInLms = true;
                break;
            }
        }
        if ($stillInLms) {
            continue;
        }
        $crmOnly[] = [
            'crm_id' => (string) $c['id'],
            'name' => (string) $c['name'],
            'lms_id' => $lid,
        ];
    }

    return [
        'resource' => 'courses',
        'matched' => $matched,
        'lmsOnly' => $lmsOnly,
        'crmOnly' => $crmOnly,
    ];
}

function lmsApplyCourses(PDO $db, string $orgId, array $addLmsIds, array $deleteCrmIds): array
{
    $lmsCourses = lmsFetchCoursesNormalized();
    $byId = [];
    foreach ($lmsCourses as $lc) {
        $byId[$lc['lms_id']] = $lc;
    }
    $created = 0;
    $deleted = 0;
    $errors = [];

    foreach ($addLmsIds as $rawId) {
        $lmsId = trim((string) $rawId);
        if ($lmsId === '' || !isset($byId[$lmsId])) {
            $errors[] = "Unknown LMS course id: {$lmsId}";
            continue;
        }
        $lc = $byId[$lmsId];
        // Skip if already present
        $chk = $db->prepare('SELECT id FROM courses WHERE lms_id = ? LIMIT 1');
        $chk->execute([$lmsId]);
        if ($chk->fetch()) {
            continue;
        }
        $id = generateUUID();
        try {
            $stmt = $db->prepare(
                'INSERT INTO courses (id, name, description, price, duration_weeks, modules, is_active, org_id, lms_id)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
            );
            $stmt->execute([
                $id,
                $lc['name'],
                $lc['description'] !== '' ? $lc['description'] : null,
                $lc['price'],
                $lc['duration_weeks'],
                json_encode([]),
                $orgId,
                $lmsId,
            ]);
            $created++;
        } catch (Throwable $e) {
            if (stripos($e->getMessage(), 'Unknown column') !== false) {
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO courses (id, name, description, price, duration_weeks, modules, is_active, org_id)
                         VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
                    );
                    $stmt->execute([
                        $id,
                        $lc['name'],
                        $lc['description'] !== '' ? $lc['description'] : null,
                        $lc['price'],
                        $lc['duration_weeks'],
                        json_encode([]),
                        $orgId,
                    ]);
                    try {
                        $db->prepare('UPDATE courses SET lms_id = ? WHERE id = ?')->execute([$lmsId, $id]);
                    } catch (Throwable $ignored) {
                    }
                    $created++;
                    continue;
                } catch (Throwable $e2) {
                    $errors[] = $lc['name'] . ': ' . $e2->getMessage();
                    continue;
                }
            }
            $errors[] = $lc['name'] . ': ' . $e->getMessage();
        }
    }

    foreach ($deleteCrmIds as $rawId) {
        $crmId = trim((string) $rawId);
        if ($crmId === '') {
            continue;
        }
        $chk = $db->prepare('SELECT id, lms_id FROM courses WHERE id = ? LIMIT 1');
        $chk->execute([$crmId]);
        $row = $chk->fetch(PDO::FETCH_ASSOC);
        if (!$row || trim((string) ($row['lms_id'] ?? '')) === '') {
            $errors[] = "Skip delete {$crmId}: not an LMS-linked course";
            continue;
        }
        try {
            $db->prepare('DELETE FROM courses WHERE id = ?')->execute([$crmId]);
            $deleted++;
        } catch (Throwable $e) {
            $errors[] = "Delete {$crmId}: " . $e->getMessage();
        }
    }

    return [
        'resource' => 'courses',
        'created' => $created,
        'deleted' => $deleted,
        'errors' => $errors,
    ];
}

// ── Match / apply: batches ───────────────────────────────────────────────────

function lmsMatchBatches(PDO $db, string $orgId): array
{
    $lmsBatches = lmsFetchBatchesNormalized();
    try {
        $st = $db->prepare(
            'SELECT b.id, b.name, b.lms_id, b.course_id, c.name AS course_name, c.lms_id AS course_lms_id
             FROM batches b
             LEFT JOIN courses c ON c.id = b.course_id
             WHERE b.org_id = ?
             ORDER BY b.name'
        );
        $st->execute([$orgId]);
        $crmRows = $st->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $st = $db->query(
            'SELECT b.id, b.name, b.lms_id, b.course_id, c.name AS course_name, c.lms_id AS course_lms_id
             FROM batches b
             LEFT JOIN courses c ON c.id = b.course_id
             ORDER BY b.name'
        );
        $crmRows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
    }

    $crmByLms = [];
    $crmByKey = [];
    foreach ($crmRows as $b) {
        $lid = trim((string) ($b['lms_id'] ?? ''));
        if ($lid !== '') {
            $crmByLms[$lid] = $b;
        }
        $ck = lmsNormalizeKey((string) ($b['name'] ?? '')) . '|' . lmsNormalizeKey((string) ($b['course_name'] ?? ''));
        if (!isset($crmByKey[$ck])) {
            $crmByKey[$ck] = $b;
        }
        $ck2 = lmsNormalizeKey((string) ($b['name'] ?? '')) . '|' . trim((string) ($b['course_lms_id'] ?? ''));
        if (!isset($crmByKey[$ck2])) {
            $crmByKey[$ck2] = $b;
        }
    }

    $matched = [];
    $lmsOnly = [];
    $matchedCrmIds = [];

    foreach ($lmsBatches as $lb) {
        $crm = $crmByLms[$lb['lms_id']] ?? null;
        if ($crm === null) {
            $k1 = lmsNormalizeKey($lb['name']) . '|' . lmsNormalizeKey($lb['lms_course_name']);
            $k2 = lmsNormalizeKey($lb['name']) . '|' . $lb['lms_course_id'];
            $crm = $crmByKey[$k1] ?? $crmByKey[$k2] ?? null;
        }
        if ($crm !== null) {
            $matched[] = [
                'lms_id' => $lb['lms_id'],
                'lms_name' => $lb['name'],
                'lms_course_name' => $lb['lms_course_name'],
                'crm_id' => (string) $crm['id'],
                'crm_name' => (string) $crm['name'],
                'crm_course_name' => (string) ($crm['course_name'] ?? ''),
            ];
            $matchedCrmIds[(string) $crm['id']] = true;
        } else {
            $lmsOnly[] = [
                'lms_id' => $lb['lms_id'],
                'name' => $lb['name'],
                'lms_course_id' => $lb['lms_course_id'],
                'lms_course_name' => $lb['lms_course_name'],
                'start_date' => $lb['start_date'],
                'end_date' => $lb['end_date'],
                'seat_limit' => $lb['seat_limit'],
            ];
        }
    }

    $crmOnly = [];
    foreach ($crmRows as $b) {
        $lid = trim((string) ($b['lms_id'] ?? ''));
        if ($lid === '') {
            continue;
        }
        if (isset($matchedCrmIds[(string) $b['id']])) {
            continue;
        }
        $still = false;
        foreach ($lmsBatches as $lb) {
            if ($lb['lms_id'] === $lid) {
                $still = true;
                break;
            }
        }
        if ($still) {
            continue;
        }
        $crmOnly[] = [
            'crm_id' => (string) $b['id'],
            'name' => (string) $b['name'],
            'lms_id' => $lid,
            'course_name' => (string) ($b['course_name'] ?? ''),
        ];
    }

    return [
        'resource' => 'batches',
        'matched' => $matched,
        'lmsOnly' => $lmsOnly,
        'crmOnly' => $crmOnly,
    ];
}

function lmsApplyBatches(PDO $db, string $orgId, array $addLmsIds, array $deleteCrmIds): array
{
    $lmsBatches = lmsFetchBatchesNormalized();
    $byId = [];
    foreach ($lmsBatches as $lb) {
        $byId[$lb['lms_id']] = $lb;
    }
    $created = 0;
    $deleted = 0;
    $errors = [];

    foreach ($addLmsIds as $rawId) {
        $lmsId = trim((string) $rawId);
        if ($lmsId === '' || !isset($byId[$lmsId])) {
            $errors[] = "Unknown LMS batch id: {$lmsId}";
            continue;
        }
        $lb = $byId[$lmsId];
        $chk = $db->prepare('SELECT id FROM batches WHERE lms_id = ? LIMIT 1');
        $chk->execute([$lmsId]);
        if ($chk->fetch()) {
            continue;
        }
        $courseId = null;
        if ($lb['lms_course_id'] !== '') {
            $cst = $db->prepare('SELECT id FROM courses WHERE lms_id = ? LIMIT 1');
            $cst->execute([$lb['lms_course_id']]);
            $courseId = $cst->fetchColumn() ?: null;
        }
        if (($courseId === null || $courseId === '') && $lb['lms_course_name'] !== '') {
            $cst = $db->prepare('SELECT id FROM courses WHERE LOWER(TRIM(name)) = ? AND (org_id = ? OR org_id IS NULL) LIMIT 1');
            try {
                $cst->execute([lmsNormalizeKey($lb['lms_course_name']), $orgId]);
            } catch (Throwable $e) {
                $cst = $db->prepare('SELECT id FROM courses WHERE LOWER(TRIM(name)) = ? LIMIT 1');
                $cst->execute([lmsNormalizeKey($lb['lms_course_name'])]);
            }
            $courseId = $cst->fetchColumn() ?: null;
        }
        if ($courseId === null || $courseId === '') {
            $errors[] = $lb['name'] . ': match the LMS course into CRM first (no CRM course for "' . ($lb['lms_course_name'] ?: $lb['lms_course_id']) . '")';
            continue;
        }
        $id = generateUUID();
        $start = $lb['start_date'];
        $end = $lb['end_date'];
        $status = 'upcoming';
        if (function_exists('batchScheduleStatus')) {
            $status = batchScheduleStatus($start, $end);
        }
        try {
            $stmt = $db->prepare(
                'INSERT INTO batches (id, name, course_id, start_date, end_date, seat_limit, status, org_id, lms_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $id,
                $lb['name'],
                $courseId,
                $start,
                $end,
                $lb['seat_limit'],
                $status,
                $orgId,
                $lmsId,
            ]);
            $created++;
        } catch (Throwable $e) {
            if (stripos($e->getMessage(), 'Unknown column') !== false) {
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO batches (id, name, course_id, start_date, end_date, seat_limit, status, org_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    );
                    $stmt->execute([
                        $id,
                        $lb['name'],
                        $courseId,
                        $start,
                        $end,
                        $lb['seat_limit'],
                        $status,
                        $orgId,
                    ]);
                    try {
                        $db->prepare('UPDATE batches SET lms_id = ? WHERE id = ?')->execute([$lmsId, $id]);
                    } catch (Throwable $ignored) {
                    }
                    $created++;
                    continue;
                } catch (Throwable $e2) {
                    $errors[] = $lb['name'] . ': ' . $e2->getMessage();
                    continue;
                }
            }
            $errors[] = $lb['name'] . ': ' . $e->getMessage();
        }
    }

    foreach ($deleteCrmIds as $rawId) {
        $crmId = trim((string) $rawId);
        if ($crmId === '') {
            continue;
        }
        $chk = $db->prepare('SELECT id, lms_id FROM batches WHERE id = ? LIMIT 1');
        $chk->execute([$crmId]);
        $row = $chk->fetch(PDO::FETCH_ASSOC);
        if (!$row || trim((string) ($row['lms_id'] ?? '')) === '') {
            $errors[] = "Skip delete {$crmId}: not an LMS-linked batch";
            continue;
        }
        try {
            $db->prepare('DELETE FROM batches WHERE id = ?')->execute([$crmId]);
            $deleted++;
        } catch (Throwable $e) {
            $errors[] = "Delete {$crmId}: " . $e->getMessage();
        }
    }

    return [
        'resource' => 'batches',
        'created' => $created,
        'deleted' => $deleted,
        'errors' => $errors,
    ];
}
