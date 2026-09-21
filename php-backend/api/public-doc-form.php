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
    $cnt = $db->prepare('SELECT COUNT(*) FROM doc_form_submissions WHERE form_id = ?');
    $cnt->execute([(string) $row['id']]);
    respond([
        'data' => [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'slug' => (string) $row['slug'],
            'description' => $row['description'] ?? null,
            'form_type' => (string) $row['form_type'],
            'fields_json' => publicDocFormDecodeJson($row['fields_json'] ?? null),
            'meta_json' => publicDocFormDecodeJson($row['meta_json'] ?? null),
            'submission_count' => (int) $cnt->fetchColumn(),
        ],
    ]);
}

if ($method === 'POST') {
    syncpediaRateLimitConsume('public_doc_form_post', 40, 900);
    $isMultipart = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false;
    $input = $isMultipart ? $_POST : getInput();
    if (!is_array($input)) {
        respond(['error' => 'Invalid JSON body'], 400);
    }
    if ($isMultipart) {
        foreach (['answers', 'values'] as $jsonKey) {
            if (isset($input[$jsonKey]) && is_string($input[$jsonKey])) {
                $decoded = json_decode($input[$jsonKey], true);
                $input[$jsonKey] = is_array($decoded) ? $decoded : [];
            }
        }
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

    $meta = publicDocFormDecodeJson($row['meta_json'] ?? null);
    $closeAt = trim((string) ($meta['close_at'] ?? ''));
    if ($closeAt !== '') {
        $ts = strtotime($closeAt);
        if ($ts !== false && time() > $ts) {
            respond(['error' => 'This form is no longer accepting responses'], 400);
        }
    }
    $limit = (int) ($meta['response_limit'] ?? 0);
    if ($limit > 0) {
        $cnt = $db->prepare('SELECT COUNT(*) FROM doc_form_submissions WHERE form_id = ?');
        $cnt->execute([(string) $row['id']]);
        if ((int) $cnt->fetchColumn() >= $limit) {
            respond(['error' => 'This form has reached its response limit'], 400);
        }
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
    if ($isMultipart && !empty($_FILES) && is_array($_FILES) && function_exists('saveFormLeadAttachmentUpload')) {
        foreach ($_FILES as $fieldKey => $file) {
            if (!is_array($file)) continue;
            $key = preg_replace('/^file_/', '', (string) $fieldKey);
            $saved = saveFormLeadAttachmentUpload($file);
            if ($saved !== null && $key !== '') {
                $normalized[$key] = $saved;
            }
        }
    }
    $fields = publicDocFormDecodeJson($row['fields_json'] ?? null);
    foreach ($fields as $f) {
        if (!is_array($f)) continue;
        $ftype = strtolower(trim((string) ($f['type'] ?? 'text')));
        if (in_array($ftype, ['section_break', 'image', 'video'], true)) continue;
        $key = trim((string) ($f['key'] ?? ''));
        if ($key === '') continue;
        $required = !empty($f['required']);
        $answer = isset($normalized[$key]) ? (string) $normalized[$key] : '';
        // Checkboxes / grids post JSON; an empty list or object means nothing was picked.
        if (in_array($ftype, ['checkboxes', 'mc_grid', 'checkbox_grid'], true)) {
            $decoded = json_decode($answer, true);
            if (is_array($decoded)) {
                $filled = false;
                foreach ($decoded as $cell) {
                    if (is_array($cell) ? count($cell) > 0 : trim((string) $cell) !== '') {
                        $filled = true;
                        break;
                    }
                }
                if (!$filled) $answer = '';
            }
        }
        if ($required && $answer === '') {
            $label = trim((string) ($f['label'] ?? $key));
            respond(['error' => ($label !== '' ? $label : $key) . ' is required'], 400);
        }
    }

    $name = trim((string) ($input['respondent_name'] ?? $normalized['candidate_name'] ?? $normalized['name'] ?? ''));
    $email = trim((string) ($input['respondent_email'] ?? $normalized['recipient_email'] ?? $normalized['email'] ?? ''));
    $referredBy = trim((string) ($input['referred_by'] ?? $input['ref'] ?? $_GET['ref'] ?? ''));
    if ($referredBy !== '' && function_exists('attributionStaffId')) {
        $referredBy = attributionStaffId($db, $referredBy, '', false);
    }
    if ($referredBy !== '' && function_exists('findUserByReferralCode')) {
        $owner = findUserByReferralCode($db, $referredBy, true);
        if ($owner && !empty($owner['referral_code'])) {
            $referredBy = (string) $owner['referral_code'];
        }
    }
    $allowMulti = !array_key_exists('allow_multiple_responses', $meta) || !empty($meta['allow_multiple_responses']);
    if (!$allowMulti && $email !== '') {
        $dup = $db->prepare('SELECT id FROM doc_form_submissions WHERE form_id = ? AND LOWER(respondent_email) = LOWER(?) LIMIT 1');
        $dup->execute([(string) $row['id'], $email]);
        if ($dup->fetchColumn()) {
            respond(['error' => 'You have already submitted a response to this form'], 409);
        }
    }
    $id = generateUUID();
    try {
        $st = $db->prepare(
            'INSERT INTO doc_form_submissions
             (id, form_id, org_id, submitted_by, respondent_name, respondent_email, answers_json, values_json, status, referred_by)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $id,
            (string) $row['id'],
            $row['org_id'] ?? null,
            $name !== '' ? $name : null,
            $email !== '' ? $email : null,
            json_encode(array_merge(is_array($answers) ? $answers : [], $normalized), JSON_UNESCAPED_UNICODE),
            json_encode($normalized, JSON_UNESCAPED_UNICODE),
            'submitted',
            $referredBy !== '' ? $referredBy : null,
        ]);
    } catch (Throwable $e) {
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
            json_encode(array_merge(is_array($answers) ? $answers : [], $normalized), JSON_UNESCAPED_UNICODE),
            json_encode($normalized, JSON_UNESCAPED_UNICODE),
            'submitted',
        ]);
    }
    if (!empty($meta['send_receipt']) && $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) && function_exists('syncpediaSendHtmlEmailViaSmtp')) {
        try {
            $title = htmlspecialchars((string) ($row['name'] ?? 'Form'), ENT_QUOTES, 'UTF-8');
            $rows = '';
            foreach ($normalized as $k => $v) {
                if ($v === '') continue;
                $rows .= '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>'
                    . htmlspecialchars((string) $k, ENT_QUOTES, 'UTF-8')
                    . '</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">'
                    . nl2br(htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'))
                    . '</td></tr>';
            }
            $html = '<p>Thanks for submitting <strong>' . $title . '</strong>.</p><table cellpadding="0" cellspacing="0">' . $rows . '</table>';
            syncpediaSendHtmlEmailViaSmtp($email, 'Your response: ' . strip_tags($title), $html);
        } catch (Throwable $e) {
            /* receipt is best-effort */
        }
    }
    respond(['id' => $id, 'message' => 'Submitted', 'success' => true], 201);
}

respond(['error' => 'Method not allowed'], 405);
