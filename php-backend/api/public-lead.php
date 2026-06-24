<?php
require_once __DIR__ . '/helpers.php';

// Allow CORS from any origin for public form
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$db = (new Database())->getConnection();
ensureGlobalBuiltinLeadForms($db);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $slug = trim((string)($_GET['form'] ?? ''));
    if ($slug === '') {
        respond(['data' => null]);
    }
    $stmt = $db->prepare("SELECT id, name, slug, description, fields_json, meta_json, is_active FROM lead_forms WHERE slug = ? AND is_active = 1 ORDER BY (org_id IS NOT NULL) DESC, updated_at DESC LIMIT 1");
    $stmt->execute([$slug]);
    $row = $stmt->fetch();
    if (!$row) {
        respond(['data' => null]);
    }
    $fields = [];
    $meta = [];
    if (!empty($row['fields_json'])) {
        $tmp = json_decode((string)$row['fields_json'], true);
        if (is_array($tmp)) $fields = $tmp;
    }
    if (!empty($row['meta_json'])) {
        $tmp = json_decode((string)$row['meta_json'], true);
        if (is_array($tmp)) $meta = $tmp;
    }
    respond(['data' => [
        'id' => $row['id'],
        'name' => $row['name'],
        'slug' => $row['slug'],
        'description' => $row['description'],
        'fields_json' => $fields,
        'meta_json' => $meta,
        'is_active' => (int)$row['is_active'],
    ]]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$input = getInput();

// Validate required fields
if (empty($input['name']) || empty($input['email'])) {
    respond(['error' => 'Name and email are required'], 400);
}

// Sanitize inputs
$name = trim($input['name']);
$email = trim((string)($input['email'] ?? ''));
$phone = !empty($input['phone']) ? trim($input['phone']) : null;
$college = !empty($input['college']) ? trim($input['college']) : null;
$yearOfStudy = !empty($input['year_of_study']) ? trim($input['year_of_study']) : null;
$courseInterest = !empty($input['course_interest']) ? trim($input['course_interest']) : null;
$source = !empty($input['source']) ? trim($input['source']) : 'website';
$ref = !empty($input['ref']) ? trim($input['ref']) : null;

// Validate email format
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'Invalid email address'], 400);
}

// If referral code provided, look up the sales rep from users table
$assignedTo = null;
$referredBy = $ref;
$refUserOrgId = null;

if ($ref) {
    $stmt = $db->prepare("SELECT id, org_id FROM users WHERE referral_code = ? LIMIT 1");
    $stmt->execute([$ref]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($user && is_array($user)) {
        $assignedTo = $user['id'];
        $rorg = trim((string) ($user['org_id'] ?? ''));
        if ($rorg !== '') {
            $refUserOrgId = $rorg;
        }
    }
}

// Org: owning org of the lead form (slug) first, else the referred rep's org.
$formSlug = trim((string) ($input['form'] ?? $input['form_slug'] ?? ($_GET['form'] ?? '')));
if ($formSlug === '' && is_string($source) && preg_match('/^form_(.+)$/', $source, $m)) {
    $formSlug = trim($m[1]);
}
$formOrgId = null;
if ($formSlug !== '') {
    $fs = $db->prepare("SELECT org_id FROM lead_forms WHERE slug = ? AND is_active = 1 ORDER BY (org_id IS NOT NULL) DESC, updated_at DESC LIMIT 1");
    $fs->execute([$formSlug]);
    $fr = $fs->fetch(PDO::FETCH_ASSOC);
    if ($fr && is_array($fr)) {
        $fog = trim((string) ($fr['org_id'] ?? ''));
        if ($fog !== '') {
            $formOrgId = $fog;
        }
    }
}
$orgId = $formOrgId ?? $refUserOrgId;

$id = generateUUID();
$notes = $courseInterest ? "Course Interest: $courseInterest" : null;

try {
    $stmt = $db->prepare("INSERT INTO leads (id, name, email, phone, college, year_of_study, course_interest, source, assigned_to, referred_by, status, notes, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, NOW(), NOW())");
    $stmt->execute([
        $id, $name, $email, $phone, $college, $yearOfStudy, $courseInterest, $source, $assignedTo, $referredBy, $notes, $orgId,
    ]);

    respond(['success' => true, 'lead_id' => $id]);
} catch (PDOException $e) {
    respond(['error' => 'Failed to save lead'], 500);
}
