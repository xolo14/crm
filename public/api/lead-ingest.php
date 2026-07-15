<?php
/**
 * Form-less public lead ingest API (for websites like syncpedia.in).
 *
 * POST /api/lead-ingest.php
 * Header: X-Lead-Api-Key: <PUBLIC_LEAD_API_KEY>
 * Body JSON: name, email?, phone?, source?, college?, course_interest?, notes?, org_id?, assigned_to?, ref?
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Lead-Api-Key');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/helpers.php';

syncpediaSecurityHeaders();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    respond([
        'ok' => true,
        'endpoint' => 'lead-ingest',
        'usage' => 'POST JSON with X-Lead-Api-Key header only. No CRM form required.',
        'required' => ['name'],
        'optional' => ['email', 'phone', 'source', 'college', 'year_of_study', 'course_interest', 'notes', 'company', 'org_id', 'assigned_to', 'ref'],
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

// Header-only — never accept api_key in query/body (avoids access-log leakage).
$providedKey = trim((string) ($_SERVER['HTTP_X_LEAD_API_KEY'] ?? ''));

if ($providedKey === '' || !hash_equals($configuredKey, $providedKey)) {
    respond(['error' => 'Invalid or missing X-Lead-Api-Key header'], 401);
}

syncpediaRateLimitConsume('lead_ingest_post', 60, 3600);

$db = (new Database())->getConnection();
ensureLeadsResumeColumn($db);
ensureLeadsSourceColumnVarchar($db);

$name = trim((string) ($input['name'] ?? $input['full_name'] ?? ''));
$email = trim((string) ($input['email'] ?? ''));
$phone = trim((string) ($input['phone'] ?? ''));
$source = trim((string) ($input['source'] ?? 'website'));
$college = trim((string) ($input['college'] ?? ''));
$yearOfStudy = trim((string) ($input['year_of_study'] ?? ''));
$courseInterest = trim((string) ($input['course_interest'] ?? ''));
$company = trim((string) ($input['company'] ?? ''));
$notes = trim((string) ($input['notes'] ?? ''));
$ref = trim((string) ($input['ref'] ?? $input['referred_by'] ?? ''));
$assignedTo = trim((string) ($input['assigned_to'] ?? ''));
$orgIdIn = trim((string) ($input['org_id'] ?? ''));

if ($name === '') {
    respond(['error' => 'name is required'], 400);
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'Invalid email address'], 400);
}
if ($source === '') {
    $source = 'website';
}

$referredBy = $ref !== '' ? $ref : null;
$orgId = null;

if ($orgIdIn !== '') {
    $ost = $db->prepare('SELECT id FROM organizations WHERE id = ? AND is_active = 1 LIMIT 1');
    $ost->execute([$orgIdIn]);
    $orow = $ost->fetch(PDO::FETCH_ASSOC);
    if (!$orow) {
        respond(['error' => 'org_id not found'], 400);
    }
    $orgId = $orgIdIn;
}

if ($ref !== '') {
    $ust = $db->prepare('SELECT id, org_id, referral_code FROM users WHERE referral_code = ? AND is_active = 1 LIMIT 1');
    $ust->execute([$ref]);
    $urow = $ust->fetch(PDO::FETCH_ASSOC);
    if ($urow && is_array($urow)) {
        if ($assignedTo === '') {
            $assignedTo = (string) ($urow['id'] ?? '');
        }
        $rc = trim((string) ($urow['referral_code'] ?? ''));
        if ($rc !== '') {
            $referredBy = $rc;
        }
        if ($orgId === null) {
            $ro = trim((string) ($urow['org_id'] ?? ''));
            if ($ro !== '') {
                $orgId = $ro;
            }
        }
    }
}

if ($assignedTo !== '') {
    $ast = $db->prepare('SELECT id, org_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
    $ast->execute([$assignedTo]);
    $arow = $ast->fetch(PDO::FETCH_ASSOC);
    if (!$arow) {
        respond(['error' => 'assigned_to user not found'], 400);
    }
    if ($orgId === null) {
        $ao = trim((string) ($arow['org_id'] ?? ''));
        if ($ao !== '') {
            $orgId = $ao;
        }
    }
} else {
    $assignedTo = null;
}

// Default org = Syncpedia when none provided (website ingest into main tenant).
if ($orgId === null) {
    $acting = $assignedTo ?: '';
    if ($acting === '') {
        $sa = $db->query("SELECT id FROM users WHERE LOWER(TRIM(role)) IN ('super_admin','superadmin') AND is_active = 1 ORDER BY created_at ASC LIMIT 1");
        $saRow = $sa ? $sa->fetch(PDO::FETCH_ASSOC) : false;
        $acting = is_array($saRow) ? (string) ($saRow['id'] ?? '') : '';
    }
    if ($acting !== '') {
        $orgId = syncpediaGetOrCreateOrgId($db, $acting);
    } else {
        $sid = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' AND is_active = 1 LIMIT 1");
        $srow = $sid ? $sid->fetch(PDO::FETCH_ASSOC) : false;
        if (is_array($srow) && !empty($srow['id'])) {
            $orgId = (string) $srow['id'];
        }
    }
}

$id = generateUUID();
$noteParts = [];
if ($notes !== '') {
    $noteParts[] = $notes;
}
if ($courseInterest !== '') {
    $noteParts[] = 'Course Interest: ' . $courseInterest;
}
$noteParts[] = 'Ingested via lead-ingest API';
$finalNotes = implode("\n", $noteParts);

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
        json_encode(['ingest' => 'lead-ingest', 'source' => $source]),
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
    'destination' => 'leads',
], 201);
