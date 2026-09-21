<?php
/**
 * Form-less public lead ingest API (for websites / third parties).
 *
 * POST /api/lead-ingest.php
 * Auth (header only — either one):
 *   Authorization: Bearer <PUBLIC_LEAD_API_KEY>
 *   X-Lead-Api-Key: <PUBLIC_LEAD_API_KEY>
 *
 * Body: any JSON object. All fields are stored as sent (full payload).
 * Common fields (name/email/phone/…) are also mapped to CRM columns when present.
 * Leads appear under a separate "API / Website" source card on the Leads page.
 *
 * (Client org_id is rejected — LEAD_INGEST_ORG_ID is required in config.)
 */
require_once __DIR__ . '/helpers.php';

syncpediaSecurityHeaders();
header('Access-Control-Allow-Origin: ' . syncpediaLeadIngestCorsOrigin());
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Lead-Api-Key');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    respond([
        'ok' => true,
        'endpoint' => 'lead-ingest',
        'usage' => 'POST any JSON lead payload with Authorization: Bearer <PUBLIC_LEAD_API_KEY>. Full body is stored; leads show under the API / Website source card.',
        'auth' => ['Authorization: Bearer <key>', 'X-Lead-Api-Key: <key>'],
        'required' => ['name or full_name (or another identifiable field)'],
        'note' => 'All JSON fields are saved as sent. Client org_id is rejected. LEAD_INGEST_ORG_ID must be set in api/config.php.',
        'source_card' => 'api_ingest',
    ]);
}

if ($method !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$configuredKey = '';
if (defined('PUBLIC_LEAD_API_KEY')) {
    $configuredKey = trim((string) PUBLIC_LEAD_API_KEY);
}
if ($configuredKey === '') {
    respond(['error' => 'Lead ingest API is not configured. Set PUBLIC_LEAD_API_KEY in api/config.php'], 503);
}

$input = getInput();
if (!is_array($input)) {
    $input = [];
}

/** Extract ingest API key from Authorization Bearer and/or X-Lead-Api-Key (header-only). */
if (!function_exists('syncpediaLeadIngestProvidedKey')) {
    function syncpediaLeadIngestProvidedKey(): string
    {
        $fromHeader = trim((string) ($_SERVER['HTTP_X_LEAD_API_KEY'] ?? ''));
        if ($fromHeader !== '') {
            return $fromHeader;
        }

        $auth = '';
        if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
            $auth = (string) $_SERVER['HTTP_AUTHORIZATION'];
        } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $auth = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        } else {
            $headers = function_exists('getallheaders') ? getallheaders() : [];
            if (is_array($headers)) {
                $auth = (string) ($headers['Authorization'] ?? $headers['authorization'] ?? '');
            }
        }
        if (preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $auth, $m)) {
            return trim($m[1]);
        }
        return '';
    }
}

// Header-only — never accept api_key in query/body (avoids access-log leakage).
$providedKey = syncpediaLeadIngestProvidedKey();

if ($providedKey === '' || !hash_equals($configuredKey, $providedKey)) {
    respond(['error' => 'Invalid or missing Authorization Bearer (or X-Lead-Api-Key) header'], 401);
}

syncpediaRateLimitConsume('lead_ingest_post', 60, 3600);

$db = (new Database())->getConnection();
ensureLeadsResumeColumn($db);
ensureLeadsSourceColumnVarchar($db);

$lockedOrgId = defined('LEAD_INGEST_ORG_ID') ? trim((string) LEAD_INGEST_ORG_ID) : '';
if ($lockedOrgId === '') {
    respond([
        'error' => 'Lead ingest is locked until LEAD_INGEST_ORG_ID is set in api/config.php',
        'hint' => 'Set LEAD_INGEST_ORG_ID to your organizations.id UUID so a leaked API key cannot inject leads into other tenants.',
    ], 503);
}

$lockSt = $db->prepare('SELECT id FROM organizations WHERE id = ? AND is_active = 1 LIMIT 1');
$lockSt->execute([$lockedOrgId]);
if (!$lockSt->fetch(PDO::FETCH_ASSOC)) {
    respond(['error' => 'LEAD_INGEST_ORG_ID is invalid in server config'], 503);
}

/** Flatten nested arrays/objects into stringable answers for display. */
if (!function_exists('syncpediaLeadIngestNormalizeValue')) {
    function syncpediaLeadIngestNormalizeValue(mixed $value): mixed
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_int($value) || is_float($value) || is_string($value) || $value === null) {
            return $value;
        }
        if (is_array($value)) {
            $out = [];
            foreach ($value as $k => $v) {
                $out[(string) $k] = syncpediaLeadIngestNormalizeValue($v);
            }
            return $out;
        }
        return (string) $value;
    }
}

// Keep the full payload exactly as received (normalized for JSON storage).
$fullPayload = [];
foreach ($input as $key => $value) {
    $k = trim((string) $key);
    if ($k === '' || strcasecmp($k, 'org_id') === 0 || strcasecmp($k, 'api_key') === 0) {
        continue;
    }
    $fullPayload[$k] = syncpediaLeadIngestNormalizeValue($value);
}

if ($fullPayload === []) {
    respond(['error' => 'JSON body with lead fields is required'], 400);
}

$name = trim((string) ($input['name'] ?? $input['full_name'] ?? $input['fullnameName'] ?? $input['student_name'] ?? ''));
if ($name === '') {
    $first = trim((string) ($input['first_name'] ?? $input['firstName'] ?? ''));
    $last = trim((string) ($input['last_name'] ?? $input['lastName'] ?? ''));
    $name = trim($first . ' ' . $last);
}
if ($name === '') {
    foreach (['email', 'phone', 'mobile', 'contact'] as $fallbackKey) {
        $v = trim((string) ($input[$fallbackKey] ?? ''));
        if ($v !== '') {
            $name = $v;
            break;
        }
    }
}
if ($name === '') {
    $name = 'API Lead ' . date('Y-m-d H:i');
}

$email = trim((string) ($input['email'] ?? $input['Email'] ?? ''));
$phone = trim((string) ($input['phone'] ?? $input['mobile'] ?? $input['Mobile'] ?? $input['contact'] ?? ''));
$college = trim((string) ($input['college'] ?? $input['college_name'] ?? $input['institution'] ?? ''));
$yearOfStudy = trim((string) ($input['year_of_study'] ?? $input['year'] ?? $input['graduation_year'] ?? ''));
$courseInterest = trim((string) ($input['course_interest'] ?? $input['course'] ?? $input['program'] ?? ''));
$company = trim((string) ($input['company'] ?? $input['organization'] ?? ''));
$notesFree = trim((string) ($input['notes'] ?? $input['message'] ?? $input['comment'] ?? $input['comments'] ?? ''));
$ref = trim((string) ($input['ref'] ?? $input['referred_by'] ?? $input['referral_code'] ?? ''));
$assignedTo = trim((string) ($input['assigned_to'] ?? ''));
$orgIdIn = trim((string) ($input['org_id'] ?? ''));

// Always use dedicated source card — ignore client "source" for bucketing (keep it inside payload).
$source = 'api_ingest';

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'Invalid email address'], 400);
}

if ($orgIdIn !== '' && $orgIdIn !== $lockedOrgId) {
    respond(['error' => 'org_id is fixed for this ingest endpoint'], 400);
}

$referredBy = $ref !== '' ? $ref : null;
$orgId = $lockedOrgId;

if ($ref !== '') {
    $urow = findUserByReferralCode($db, (string) $ref, true);
    if ($urow && is_array($urow)) {
        $refOrg = trim((string) ($urow['org_id'] ?? ''));
        if ($refOrg !== '' && $refOrg !== $lockedOrgId) {
            respond(['error' => 'ref code does not belong to the configured ingest organization'], 400);
        }
        if ($assignedTo === '') {
            $assignedTo = (string) ($urow['id'] ?? '');
        }
        $rc = trim((string) ($urow['referral_code'] ?? ''));
        if ($rc !== '') {
            $referredBy = $rc;
        }
    }
}

if ($assignedTo !== '') {
    $ast = $db->prepare('SELECT id, org_id FROM users WHERE id = ? AND is_active = 1 AND org_id = ? LIMIT 1');
    $ast->execute([$assignedTo, $lockedOrgId]);
    $arow = $ast->fetch(PDO::FETCH_ASSOC);
    if (!$arow) {
        respond(['error' => 'assigned_to must be an active user in the configured ingest organization'], 400);
    }
} else {
    $assignedTo = null;
}

$dup = leadsFindDuplicateInOrg($db, $orgId, $email, $phone);
if ($dup) {
    respond([
        'success' => true,
        'duplicate' => true,
        'lead_id' => $dup['id'],
        'org_id' => $orgId,
        'source' => $source,
        'message' => 'Lead already exists — returning existing record',
    ], 200);
}

$id = generateUUID();

// Full payload as Answers: so Leads dialog shows every field the third party sent.
$answersJson = json_encode($fullPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($answersJson === false) {
    $answersJson = '{}';
}
$noteParts = [];
$noteParts[] = 'Form: api_ingest';
$noteParts[] = 'Answers: ' . $answersJson;
if ($notesFree !== '') {
    $noteParts[] = $notesFree;
}
$finalNotes = implode("\n", $noteParts);

$tags = [
    'ingest:api',
    'ingest:lead-ingest',
    'source:api_ingest',
];
$clientSource = trim((string) ($input['source'] ?? ''));
if ($clientSource !== '') {
    $tags[] = 'origin_source:' . substr($clientSource, 0, 80);
}

try {
    $stmt = $db->prepare(
        'INSERT INTO leads (id, name, email, phone, company, college, year_of_study, course_interest, referred_by, source, notes, assigned_to, tags, org_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'new\', NOW(), NOW())',
    );
    $stmt->execute([
        $id,
        $name,
        $email !== '' ? $email : null,
        $phone !== '' ? $phone : null,
        $company !== '' ? $company : null,
        $college !== '' ? $college : null,
        $yearOfStudy !== '' ? $yearOfStudy : null,
        $courseInterest !== '' ? $courseInterest : null,
        $referredBy,
        $source,
        $finalNotes,
        $assignedTo,
        json_encode(array_values($tags)),
        $orgId,
    ]);
} catch (Throwable $e) {
    error_log('[lead-ingest] ' . $e->getMessage());
    respond(['error' => 'Failed to save lead'], 500);
}

respond([
    'success' => true,
    'lead_id' => $id,
    'org_id' => $orgId,
    'source' => $source,
    'source_card' => 'api_ingest',
    'fields_stored' => count($fullPayload),
    'destination' => 'leads',
], 201);
