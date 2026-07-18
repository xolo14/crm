<?php
// CORS first — before bootstrap/config can fail
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Form-Api-Key');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/helpers.php';

syncpediaSecurityHeaders();

$db = (new Database())->getConnection();
retireGlobalBuiltinLeadForms($db);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    syncpediaRateLimitConsume('public_lead_get', 120, 900);
    $slug = trim((string) ($_GET['form'] ?? ''));
    if ($slug === '') {
        respond(['data' => null]);
    }
    $row = publicLeadFetchFormBySlug($db, $slug);
    if (!$row) {
        respond(['data' => null]);
    }
    $fields = [];
    $meta = [];
    if (!empty($row['fields_json'])) {
        $tmp = json_decode((string) $row['fields_json'], true);
        if (is_array($tmp)) {
            $fields = $tmp;
        }
    }
    if (!empty($row['meta_json'])) {
        $tmp = json_decode((string) $row['meta_json'], true);
        if (is_array($tmp)) {
            $meta = $tmp;
        }
    }
    respond(['data' => [
        'id' => $row['id'],
        'name' => $row['name'],
        'slug' => $row['slug'],
        'description' => $row['description'],
        'fields_json' => $fields,
        'meta_json' => $meta,
        'is_active' => (int) $row['is_active'],
        'org_name' => $row['org_name'] ?? null,
        'has_resume_field' => publicFormHasResumeField($row),
        'lead_destination' => publicFormLeadDestination($row) ?? 'form_leads',
        'routes_to_hr' => publicLeadShouldRouteToHr($row, (string) ($row['slug'] ?? ''), '', null, []),
    ]]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

syncpediaRateLimitConsume('public_lead_post', 20, 3600);

ensureLeadsResumeColumn($db);
ensureLeadsSourceColumnVarchar($db);
ensureUploadDirectoriesExist();

$isMultipart = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false;
$input = $isMultipart ? $_POST : getInput();
if (!is_array($input)) {
    $input = [];
}

$name = trim((string) ($input['name'] ?? ''));
$email = trim((string) ($input['email'] ?? ''));

$extraAnswers = [];
if (!empty($input['form_answers'])) {
    $decoded = json_decode((string) $input['form_answers'], true);
    if (is_array($decoded)) {
        $extraAnswers = $decoded;
    }
} elseif (!empty($input['notes']) && is_string($input['notes'])) {
    $decoded = json_decode($input['notes'], true);
    if (is_array($decoded)) {
        $extraAnswers = $decoded;
    }
}

if ($name === '' && $extraAnswers !== []) {
    $name = trim((string) ($extraAnswers['name'] ?? $extraAnswers['full_name'] ?? ''));
    if ($name === '') {
        foreach ($extraAnswers as $key => $val) {
            if (!is_scalar($val)) {
                continue;
            }
            $k = strtolower((string) $key);
            if (preg_match('/full.?name|^name$/i', $k)) {
                $name = trim((string) $val);
                break;
            }
        }
    }
}
if ($email === '' && $extraAnswers !== []) {
    $email = trim((string) ($extraAnswers['email'] ?? ''));
    if ($email === '') {
        foreach ($extraAnswers as $key => $val) {
            if (!is_scalar($val)) {
                continue;
            }
            $k = strtolower((string) $key);
            if (preg_match('/e[\s-]*mail|email_address/i', $k)) {
                $email = trim((string) $val);
                break;
            }
        }
    }
}

$source = !empty($input['source']) ? trim((string) $input['source']) : 'website';
$ref = !empty($input['ref']) ? trim((string) $input['ref']) : null;

$formSlug = trim((string) ($input['form'] ?? $input['form_slug'] ?? ($_GET['form'] ?? '')));
if ($formSlug === '' && is_string($source) && preg_match('/^form_(.+)$/', $source, $m)) {
    $formSlug = trim($m[1]);
}

$formRow = $formSlug !== '' ? publicLeadFetchFormBySlug($db, $formSlug) : null;
if ($formSlug !== '' && !is_array($formRow)) {
    respond(['error' => 'Form not found or inactive'], 404);
}

// Public form submissions always use form_{slug} as source (ignore client override).
if ($formSlug !== '') {
    $source = 'form_' . $formSlug;
}

$formMeta = [];
if (is_array($formRow) && !empty($formRow['meta_json'])) {
    $tmp = is_array($formRow['meta_json']) ? $formRow['meta_json'] : json_decode((string) $formRow['meta_json'], true);
    if (is_array($tmp)) {
        $formMeta = $tmp;
    }
}
$collectEmail = ($formMeta['collect_email'] ?? true) !== false;

if ($name === '') {
    respond(['error' => 'Name is required'], 400);
}
if ($collectEmail) {
    if ($email === '') {
        respond(['error' => 'Email is required'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'Invalid email address'], 400);
    }
} elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'Invalid email address'], 400);
}
if (!$collectEmail && $email === '') {
    $email = null;
}

$phone = !empty($input['phone']) ? trim((string) $input['phone']) : null;
$phone = publicFormResolvePhone($phone, $extraAnswers);
if ($phone === '' || $phone === '0000000000') {
    $phone = null;
}
$college = !empty($input['college']) ? trim((string) $input['college']) : null;
$yearOfStudy = !empty($input['year_of_study']) ? trim((string) $input['year_of_study']) : null;
$courseInterest = !empty($input['course_interest']) ? trim((string) $input['course_interest']) : null;

$formCreatorId = is_array($formRow) ? trim((string) ($formRow['created_by'] ?? '')) : '';
$formOrgId = is_array($formRow) ? trim((string) ($formRow['org_id'] ?? '')) : '';
$formCreatorRef = '';

if (is_array($formRow)) {
    $meta = $formMeta;
    $requiresKey = !empty($meta['external_api_enabled']);
    $storedHash = trim((string) ($meta['external_api_key_hash'] ?? ''));
    if ($requiresKey && $storedHash !== '') {
        $providedApiKey = trim((string) ($_SERVER['HTTP_X_FORM_API_KEY'] ?? ''));
        if ($providedApiKey === '') {
            // Backward-compat for old shared links while we migrate callers off URL/body secrets.
            $providedApiKey = trim((string) ($input['api_key'] ?? ($_GET['api_key'] ?? '')));
        }
        if ($providedApiKey === '') {
            respond([
                'error' => 'Form API key required',
                'hint' => 'Send X-Form-Api-Key header (preferred) or rotate/update older integration links.',
            ], 401);
        }
        if (!formExternalApiKeyVerify($providedApiKey, $storedHash)) {
            respond(['error' => 'Invalid form API key'], 401);
        }
    }
}

$assignedTo = null;
$referredBy = $ref !== '' && $ref !== null ? $ref : null;
$refUserOrgId = null;

if ($ref) {
    $stmt = $db->prepare('SELECT id, org_id, referral_code FROM users WHERE referral_code = ? LIMIT 1');
    $stmt->execute([$ref]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($user && is_array($user)) {
        $assignedTo = $user['id'];
        $rorg = trim((string) ($user['org_id'] ?? ''));
        if ($rorg !== '') {
            $refUserOrgId = $rorg;
        }
        $rc = trim((string) ($user['referral_code'] ?? ''));
        if ($rc !== '') {
            $referredBy = $rc;
        }
    }
}

if ($formCreatorId !== '') {
    $ust = $db->prepare('SELECT referral_code FROM users WHERE id = ? LIMIT 1');
    $ust->execute([$formCreatorId]);
    $urow = $ust->fetch(PDO::FETCH_ASSOC);
    if ($urow && is_array($urow)) {
        $formCreatorRef = trim((string) ($urow['referral_code'] ?? ''));
    }
}

// No ?ref= on link → assign to form creator so it appears in their Form Leads / My Leads.
if (!$assignedTo && $formCreatorId !== '') {
    $assignedTo = $formCreatorId;
}
if (($referredBy === null || $referredBy === '') && $formCreatorRef !== '') {
    $referredBy = $formCreatorRef;
}

$orgId = $formOrgId !== '' ? $formOrgId : $refUserOrgId;
$createdBy = $formCreatorId !== '' ? $formCreatorId : $assignedTo;

$attachmentPaths = [];
$resumePath = null;

if ($isMultipart && !empty($_FILES) && is_array($_FILES)) {
    foreach ($_FILES as $fieldKey => $file) {
        if (!is_array($file) || !isset($file['error'])) {
            continue;
        }
        $key = preg_replace('/^file_/', '', (string) $fieldKey);
        $saved = saveFormLeadAttachmentUpload($file);
        if ($saved === null) {
            continue;
        }
        $attachmentPaths[$key] = $saved;
        if ($resumePath === null && preg_match('/resume|cv/i', $key)) {
            $resumePath = $saved;
        }
    }
}

if ($resumePath === null && !empty($attachmentPaths)) {
    $resumePath = reset($attachmentPaths) ?: null;
}

$notesParts = [];
if ($courseInterest) {
    $notesParts[] = "Course Interest: $courseInterest";
}
if ($formSlug !== '') {
    $notesParts[] = 'Form: ' . $formSlug;
}
if ($ref !== null && $ref !== '') {
    $notesParts[] = 'Referral: ' . $ref;
}
if ($extraAnswers !== []) {
    $notesParts[] = 'Answers: ' . json_encode($extraAnswers, JSON_UNESCAPED_UNICODE);
}
if ($attachmentPaths !== []) {
    $notesParts[] = 'Attachments: ' . json_encode($attachmentPaths, JSON_UNESCAPED_UNICODE);
}
$notes = $notesParts !== [] ? implode("\n", $notesParts) : null;

$tags = null;
if ($formSlug !== '') {
    $tags = json_encode(['form_slug' => $formSlug, 'form_id' => $formRow['id'] ?? null]);
}

$routesToHr = publicLeadShouldRouteToHr($formRow, $formSlug, $source, $resumePath, $attachmentPaths);

if ($routesToHr) {
    $leadOrgId = $formOrgId !== '' ? $formOrgId : ($orgId !== '' ? $orgId : $refUserOrgId);
    $hrUserId = resolveHrUserIdForPublicForm(
        $db,
        $leadOrgId !== '' ? $leadOrgId : null,
        $formCreatorId !== '' ? $formCreatorId : null,
    );
    if ($hrUserId === null) {
        respond(['error' => 'No active user available to receive HR leads. Add an HR user in Users, then try again.'], 503);
    }
    ensureHrLeadsTableExists($db);
    $hrPhone = publicFormResolvePhone($phone, $extraAnswers);
    $hrSource = $formSlug !== '' ? 'form_' . $formSlug : ($source !== '' ? $source : 'website');
    $assignedBy = ($formCreatorId !== '' && $formCreatorId !== $hrUserId) ? $formCreatorId : null;
    $hrLeadOrgId = $leadOrgId !== '' ? $leadOrgId : null;
    if ($hrLeadOrgId === null && $formCreatorId !== '') {
        $creatorOrgStmt = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $creatorOrgStmt->execute([$formCreatorId]);
        $creatorOrgRow = $creatorOrgStmt->fetch(PDO::FETCH_ASSOC);
        $creatorOrg = is_array($creatorOrgRow) ? trim((string) ($creatorOrgRow['org_id'] ?? '')) : '';
        if ($creatorOrg !== '') {
            $hrLeadOrgId = $creatorOrg;
        }
    }
    $dupEmail = strtolower(trim((string) ($email ?? '')));
    $dupPhoneDigits = preg_replace('/\D+/', '', (string) $hrPhone) ?? '';
    if (strlen($dupPhoneDigits) > 10) {
        $dupPhoneDigits = substr($dupPhoneDigits, -10);
    }
    if ($dupPhoneDigits === '0000000000') {
        $dupPhoneDigits = '';
    }
    $dupWhere = [];
    $dupParams = [];
    if ($dupEmail !== '') {
        $dupWhere[] = '(email IS NOT NULL AND LOWER(TRIM(email)) = ?)';
        $dupParams[] = $dupEmail;
    }
    if (strlen($dupPhoneDigits) >= 10) {
        $dupWhere[] = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(',''),')','') LIKE ?";
        $dupParams[] = '%' . $dupPhoneDigits;
    }
    if ($dupWhere !== []) {
        $dupSql = 'SELECT id FROM hr_leads WHERE deleted_at IS NULL AND (' . implode(' OR ', $dupWhere) . ')';
        if ($hrLeadOrgId !== null) {
            $dupSql .= ' AND org_id = ?';
            $dupParams[] = $hrLeadOrgId;
        }
        $dupSql .= ' LIMIT 1';
        $dupSt = $db->prepare($dupSql);
        $dupSt->execute($dupParams);
        $dupRow = $dupSt->fetch(PDO::FETCH_ASSOC);
        if (is_array($dupRow)) {
            respond([
                'success' => true,
                'hr_lead_id' => (int) $dupRow['id'],
                'destination' => 'hr_leads',
            ]);
        }
    }
    try {
        $stmt = $db->prepare(
            'INSERT INTO hr_leads (hr_id, assigned_by, full_name, phone, email, source, status, priority, notes, resume_path, is_assigned, org_id)
             VALUES (?, ?, ?, ?, ?, ?, \'new\', \'medium\', ?, ?, 0, ?)',
        );
        $stmt->execute([
            $hrUserId,
            $assignedBy,
            $name,
            $hrPhone,
            $email,
            $hrSource,
            $notes,
            $resumePath,
            $hrLeadOrgId,
        ]);
        $hrLeadId = (int) $db->lastInsertId();
        if (is_array($formRow)) {
            require_once __DIR__ . '/form_campaigns.php';
            try {
                formCampaignAutoSendForNewLead($db, $formRow, [
                    'id' => $hrLeadId,
                    'name' => $name,
                    'email' => $email,
                    'phone' => $hrPhone,
                ]);
            } catch (Throwable $e) {
                error_log('[form campaign auto hr] ' . $e->getMessage());
            }
        }
        respond([
            'success' => true,
            'hr_lead_id' => $hrLeadId,
            'destination' => 'hr_leads',
        ]);
    } catch (PDOException $e) {
        respond(['error' => 'Failed to save HR lead'], 500);
    }
}

$dupOrgId = ($orgId !== null && $orgId !== '') ? $orgId : null;
$dup = leadsFindDuplicateInOrg($db, $dupOrgId, (string) ($email ?? ''), (string) ($phone ?? ''));
if (is_array($dup)) {
    respond(['success' => true, 'lead_id' => $dup['id'], 'destination' => 'leads']);
}

$id = generateUUID();

try {
    $stmt = $db->prepare(
        'INSERT INTO leads (id, name, email, phone, college, year_of_study, course_interest, source, assigned_to, referred_by, status, notes, resume_path, tags, org_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'new\', ?, ?, ?, ?, ?, NOW(), NOW())',
    );
    $stmt->execute([
        $id,
        $name,
        $email,
        $phone,
        $college,
        $yearOfStudy,
        $courseInterest,
        $source,
        $assignedTo,
        $referredBy,
        $notes,
        $resumePath,
        $tags,
        $orgId !== '' ? $orgId : null,
        $createdBy !== '' ? $createdBy : null,
    ]);

    if (is_array($formRow)) {
        require_once __DIR__ . '/form_campaigns.php';
        try {
            formCampaignAutoSendForNewLead($db, $formRow, [
                'id' => $id,
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
            ]);
        } catch (Throwable $e) {
            error_log('[form campaign auto] ' . $e->getMessage());
        }
    }

    respond(['success' => true, 'lead_id' => $id, 'destination' => 'leads']);
} catch (PDOException $e) {
    respond(['error' => 'Failed to save lead'], 500);
}
