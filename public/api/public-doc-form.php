<?php
/**
 * Public document form (offer letter / certificate intake) — no auth.
 * GET  ?slug=...  → form definition for fill UI
 * POST { slug|form_id, answers|values } → submission
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/helpers.php';
syncpediaSecurityHeaders();

$db = (new Database())->getConnection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function publicDocFormFetchBySlug(PDO $db, string $slug): ?array {
    $slug = strtolower(trim($slug));
    if ($slug === '') return null;
    $st = $db->prepare(
        'SELECT * FROM doc_forms WHERE LOWER(TRIM(slug)) = ? AND is_active = 1 LIMIT 1'
    );
    $st->execute([$slug]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function publicDocFormFetchById(PDO $db, string $id): ?array {
    $id = trim($id);
    if ($id === '') return null;
    $st = $db->prepare('SELECT * FROM doc_forms WHERE id = ? AND is_active = 1 LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function publicDocFormDecodeJson(?string $raw): array {
    if ($raw === null || trim($raw) === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

if ($method === 'GET') {
    syncpediaRateLimitConsume('public_doc_form_get', 120, 900);
    $slug = trim((string) ($_GET['slug'] ?? $_GET['form'] ?? ''));
    $row = publicDocFormFetchBySlug($db, $slug);
    if (!$row) {
        respond(['error' => 'Form not found'], 404);
    }
    respond([
        'data' => [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'slug' => (string) $row['slug'],
            'description' => $row['description'] ?? null,
            'form_type' => (string) $row['form_type'],
            'fields_json' => publicDocFormDecodeJson($row['fields_json'] ?? null),
            'meta_json' => publicDocFormDecodeJson($row['meta_json'] ?? null),
        ],
    ]);
}

if ($method === 'POST') {
    syncpediaRateLimitConsume('public_doc_form_post', 40, 900);
    $input = getInput();
    if (!is_array($input)) {
        respond(['error' => 'Invalid JSON body'], 400);
    }
    $slug = trim((string) ($input['slug'] ?? ''));
    $formId = trim((string) ($input['form_id'] ?? ''));
    $row = null;
    if ($formId !== '') {
        $row = publicDocFormFetchById($db, $formId);
    } elseif ($slug !== '') {
        $row = publicDocFormFetchBySlug($db, $slug);
    }
    if (!$row) {
        respond(['error' => 'Form not found or inactive'], 404);
    }

    $answers = $input['answers'] ?? $input['answers_json'] ?? [];
    if (!is_array($answers)) $answers = [];
    $values = $input['values'] ?? $input['values_json'] ?? $answers;
    if (!is_array($values)) $values = [];
    $normalized = [];
    foreach ($values as $k => $v) {
        $key = trim((string) $k);
        if ($key === '') continue;
        $normalized[$key] = is_scalar($v) ? trim((string) $v) : '';
    }
    $fields = publicDocFormDecodeJson($row['fields_json'] ?? null);
    foreach ($fields as $f) {
        if (!is_array($f)) continue;
        $key = trim((string) ($f['key'] ?? ''));
        if ($key === '') continue;
        $required = !empty($f['required']);
        if ($required && (!isset($normalized[$key]) || $normalized[$key] === '')) {
            $label = trim((string) ($f['label'] ?? $key));
            respond(['error' => ($label !== '' ? $label : $key) . ' is required'], 400);
        }
    }

    $name = trim((string) ($input['respondent_name'] ?? $normalized['candidate_name'] ?? $normalized['name'] ?? ''));
    $email = trim((string) ($input['respondent_email'] ?? $normalized['recipient_email'] ?? $normalized['email'] ?? ''));
    $id = generateUUID();
    $st = $db->prepare(
        'INSERT INTO doc_form_submissions
         (id, form_id, org_id, submitted_by, respondent_name, respondent_email, answers_json, values_json, status)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)'
    );
    $st->execute([
        $id,
        (string) $row['id'],
        $row['org_id'] ?? null,
        $name !== '' ? $name : null,
        $email !== '' ? $email : null,
        json_encode($answers ?: $normalized, JSON_UNESCAPED_UNICODE),
        json_encode($normalized, JSON_UNESCAPED_UNICODE),
        'submitted',
    ]);
    respond(['id' => $id, 'message' => 'Submitted', 'success' => true], 201);
}

respond(['error' => 'Method not allowed'], 405);
