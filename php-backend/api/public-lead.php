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
    $dest = strtolower(trim((string) ($meta['lead_destination'] ?? '')));
    if ($dest === 'hr_leads') {
        $meta['payment_enabled'] = false;
    }
    if (!empty($meta['payment_enabled'])) {
        $meta['collect_email'] = true;
    }
    $cnt = 0;
    try {
        $c = $db->prepare('SELECT COUNT(*) FROM leads WHERE source = ?');
        $c->execute(['form_' . $slug]);
        $cnt = (int) $c->fetchColumn();
    } catch (Throwable $e) {
        $cnt = 0;
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
        'org_logo_url' => $row['org_logo_url'] ?? null,
        'has_resume_field' => publicFormHasResumeField($row),
        'lead_destination' => publicFormLeadDestination($row) ?? 'form_leads',
        'routes_to_hr' => publicLeadShouldRouteToHr($row, (string) ($row['slug'] ?? ''), '', null, []),
        'submission_count' => $cnt,
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

$closeAt = trim((string) ($formMeta['close_at'] ?? ''));
if ($closeAt !== '') {
    $ts = strtotime($closeAt);
    if ($ts !== false && time() > $ts) {
        respond(['error' => 'This form is no longer accepting responses'], 400);
    }
}
$limit = (int) ($formMeta['response_limit'] ?? 0);
if ($limit > 0 && $formSlug !== '') {
    try {
        $c = $db->prepare('SELECT COUNT(*) FROM leads WHERE source = ?');
        $c->execute(['form_' . $formSlug]);
        if ((int) $c->fetchColumn() >= $limit) {
            respond(['error' => 'This form has reached its response limit'], 400);
        }
    } catch (Throwable $e) {
        /* ignore */
    }
}

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
            respond([
                'error' => 'Form API key required',
                'hint' => 'Send X-Form-Api-Key header only (query/body api_key is no longer accepted).',
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
    $user = findUserByReferralCode($db, (string) $ref);
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

// No ?ref= on link → round-robin across form assignees, else form creator.
if (!$assignedTo && is_array($formRow)) {
    $formIdForAssign = trim((string) ($formRow['id'] ?? ''));
    $memberIds = [];
    if ($formIdForAssign !== '') {
        try {
            ensureLeadFormAssignmentsTable($db);
            $mst = $db->prepare(
                'SELECT member_id FROM lead_form_assignments WHERE form_id = ? ORDER BY created_at ASC, member_id ASC'
            );
            $mst->execute([$formIdForAssign]);
            foreach ($mst->fetchAll(PDO::FETCH_ASSOC) as $mr) {
                $mid = trim((string) ($mr['member_id'] ?? ''));
                if ($mid !== '') {
                    $memberIds[] = $mid;
                }
            }
        } catch (Throwable $e) {
            $memberIds = [];
        }
    }
    if ($memberIds !== []) {
        $n = count($memberIds);
        $seq = 0;
        try {
            $cst = $db->prepare(
                "SELECT COUNT(*) FROM leads WHERE source = ? OR (tags IS NOT NULL AND tags LIKE ?)"
            );
            $cst->execute([$source, '%"form_id":"' . $formIdForAssign . '"%']);
            $seq = (int) $cst->fetchColumn();
        } catch (Throwable $e) {
            $seq = (int) (microtime(true) * 1000);
        }
        $assignedTo = $memberIds[$seq % $n];
    } elseif ($formCreatorId !== '') {
        $assignedTo = $formCreatorId;
    }
}
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

$publicLeadSendReceipt = static function () use ($formMeta, $email, $name, $extraAnswers, $formRow, $courseInterest, $phone): void {
    if (empty($formMeta['send_receipt'])) {
        return;
    }
    $to = trim((string) ($email ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    try {
        if (!function_exists('syncpediaSendHtmlEmailViaSmtp')) {
            require_once __DIR__ . '/mail_transport.php';
        }
        if (!function_exists('syncpediaSendHtmlEmailViaSmtp')) {
            return;
        }
        $title = htmlspecialchars((string) ($formRow['name'] ?? 'Form'), ENT_QUOTES, 'UTF-8');
        $pairs = array_merge(
            [
                'Name' => (string) $name,
                'Email' => $to,
                'Phone' => (string) ($phone ?? ''),
                'Course' => (string) ($courseInterest ?? ''),
            ],
            is_array($extraAnswers) ? $extraAnswers : []
        );
        $rows = '';
        foreach ($pairs as $k => $v) {
            $val = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string) $v;
            if ($val === '') {
                continue;
            }
            $rows .= '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>'
                . htmlspecialchars((string) $k, ENT_QUOTES, 'UTF-8')
                . '</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">'
                . nl2br(htmlspecialchars($val, ENT_QUOTES, 'UTF-8'))
                . '</td></tr>';
        }
        $html = '<p>Thanks for submitting <strong>' . $title . '</strong>.</p><table cellpadding="0" cellspacing="0">' . $rows . '</table>';
        syncpediaSendHtmlEmailViaSmtp($to, 'Your response: ' . strip_tags((string) ($formRow['name'] ?? 'Form')), $html);
    } catch (Throwable $e) {
        /* receipt is best-effort */
    }
};

$tags = null;
if ($formSlug !== '') {
    $tags = json_encode(['form_slug' => $formSlug, 'form_id' => $formRow['id'] ?? null]);
}

$publicLeadStartPayment = static function (string $leadId) use (
    $db,
    $formMeta,
    $formRow,
    $formSlug,
    $orgId,
    $assignedTo,
    $formCreatorId,
    $referredBy,
    $name,
    $email,
    $phone,
    $input
): array {
    if (empty($formMeta['payment_enabled'])) {
        return [];
    }
    $dest = strtolower(trim((string) ($formMeta['lead_destination'] ?? '')));
    if ($dest === 'hr_leads') {
        return ['payment_error' => 'Payment is not available on HR forms'];
    }
    $baseAmount = (float) ($formMeta['payment_amount'] ?? 0);
    if ($baseAmount <= 0) {
        return ['payment_error' => 'Payment amount is not configured on this form'];
    }

    $couponEnabled = !empty($formMeta['payment_coupon_enabled']);
    $expectedCoupon = strtoupper(trim((string) ($formMeta['payment_coupon_code'] ?? '')));
    $submittedCoupon = strtoupper(trim((string) ($input['payment_coupon'] ?? '')));
    $couponApplied = $couponEnabled && $expectedCoupon !== '' && $submittedCoupon !== '' && hash_equals($expectedCoupon, $submittedCoupon);
    // Coupon zeros the base only; GST / handling stay on the original amount.
    $chargeBase = $couponApplied ? 0.0 : $baseAmount;

    $gstEnabled = !empty($formMeta['payment_gst_enabled']);
    $handlingEnabled = !empty($formMeta['payment_handling_enabled']);
    $gst = $gstEnabled ? round($baseAmount * 0.18, 2) : 0.0;
    $handling = $handlingEnabled ? round($baseAmount * 0.02, 2) : 0.0;
    $amount = round($chargeBase + $gst + $handling, 2);

    $salespersonId = trim((string) ($assignedTo ?: $formCreatorId ?: ''));
    $refCode = trim((string) ($referredBy ?: ''));
    if ($refCode === '' && $salespersonId !== '' && function_exists('userStaffId')) {
        $refCode = userStaffId($db, $salespersonId);
    }
    if ($salespersonId === '') {
        return ['payment_error' => 'Open this form with a staff ID link so payment can be attributed.'];
    }

    $tagPatch = static function (string $status, float $amt, string $plinkId = '', bool $free = false) use ($db, $leadId, $couponApplied, $submittedCoupon, $gst, $handling, $chargeBase, $baseAmount): void {
        $tagArr = [];
        $st = $db->prepare('SELECT tags FROM leads WHERE id = ? LIMIT 1');
        $st->execute([$leadId]);
        $rawTags = $st->fetchColumn();
        $decoded = json_decode((string) $rawTags, true);
        if (is_array($decoded)) {
            $tagArr = $decoded;
        }
        if ($plinkId !== '') {
            $tagArr['payment_link_id'] = $plinkId;
        }
        $tagArr['payment_status'] = $status;
        $tagArr['payment_amount'] = $amt;
        $tagArr['payment_base'] = $chargeBase;
        $tagArr['payment_original_amount'] = $baseAmount;
        $tagArr['payment_gst'] = $gst;
        $tagArr['payment_handling'] = $handling;
        if ($couponApplied) {
            $tagArr['payment_coupon'] = $submittedCoupon;
            $tagArr['payment_coupon_applied'] = true;
        }
        if ($free) {
            $tagArr['payment_free'] = true;
        }
        try {
            $db->prepare('UPDATE leads SET tags = ? WHERE id = ?')->execute([
                json_encode($tagArr, JSON_UNESCAPED_UNICODE),
                $leadId,
            ]);
        } catch (Throwable $e) {
            error_log('[public-lead] payment tags: ' . $e->getMessage());
        }
    };

    // Coupon (or zero total): mark paid without Razorpay (min charge is ₹1).
    // Only allow free checkout when a valid coupon was applied — never silently skip pay.
    if ($amount < 1) {
        if (!$couponApplied) {
            return ['payment_error' => 'Payment amount must be at least ₹1'];
        }
        $tagPatch('paid', 0.0, '', true);
        return [
            'payment_already_paid' => true,
            'payment_free' => true,
            'payment_amount' => 0,
            'payment_coupon_applied' => true,
        ];
    }

    if (!function_exists('paymentLinkCreateForLeadForm')) {
        require_once __DIR__ . '/payment_link_store.php';
    }
    $pay = paymentLinkCreateForLeadForm([
        'org_id' => $orgId,
        'salesperson_id' => $salespersonId,
        'referral_code' => $refCode !== '' ? $refCode : '',
        'amount' => $amount,
        'customer_name' => $name,
        'customer_email' => $email,
        'customer_phone' => $phone,
        'lead_id' => $leadId,
        'form_slug' => $formSlug,
        'form_name' => is_array($formRow) ? (string) ($formRow['name'] ?? 'Form payment') : 'Form payment',
        'gst' => $gst,
        'handling' => $handling,
        'base_amount' => $chargeBase,
        'coupon' => $couponApplied ? $submittedCoupon : '',
    ]);
    $plinkId = trim((string) ($pay['id'] ?? ''));
    if ($plinkId !== '') {
        $tagPatch(!empty($pay['already_paid']) ? 'paid' : 'created', $amount, $plinkId, false);
    }
    if (!empty($pay['already_paid'])) {
        return ['payment_already_paid' => true, 'payment_amount' => $amount];
    }
    if (!empty($pay['url'])) {
        return [
            'payment_url' => $pay['url'],
            'payment_link_id' => $plinkId,
            'payment_amount' => $amount,
            'payment_breakdown' => [
                'base' => $chargeBase,
                'gst' => $gst,
                'handling' => $handling,
                'total' => $amount,
            ],
        ];
    }
    return ['payment_error' => (string) ($pay['error'] ?? 'Could not start payment')];
};

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
                'duplicate' => true,
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
        $publicLeadSendReceipt();
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
    $publicLeadSendReceipt();
    $payExtra = $publicLeadStartPayment((string) $dup['id']);
    $isPaid = !empty($payExtra['payment_free']) || !empty($payExtra['payment_already_paid']);
    if (!array_key_exists('payment_url', $payExtra) && !array_key_exists('payment_error', $payExtra) && !array_key_exists('payment_free', $payExtra) && !array_key_exists('payment_already_paid', $payExtra)) {
        $isPaid = true;
    }
    if (is_array($formRow)) {
        require_once __DIR__ . '/form_campaigns.php';
        try {
            formCampaignAutoSendForNewLead($db, $formRow, [
                'id' => $dup['id'],
                'name' => $dup['name'] ?? $name,
                'email' => $dup['email'] ?? $email,
                'phone' => $dup['phone'] ?? $phone,
            ]);
        } catch (Throwable $e) {
            error_log('[form campaign auto dup] ' . $e->getMessage());
        }
        try {
            leadFormQueueAutoDocuments($db, $formRow, (string) $dup['id'], $isPaid);
        } catch (Throwable $e) {
            error_log('[leadFormQueueAutoDocuments dup] ' . $e->getMessage());
        }
    }
    respond(array_merge([
        'success' => true,
        'lead_id' => $dup['id'],
        'destination' => 'leads',
        'duplicate' => true,
    ], $payExtra));
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

    if ($assignedTo !== null && trim((string) $assignedTo) !== '') {
        try {
            leadsSetAssignee($db, $id, (string) $assignedTo);
        } catch (Throwable $e) {
            error_log('[public-lead] assignment sync: ' . $e->getMessage());
        }
    }

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

    $publicLeadSendReceipt();
    $payExtra = $publicLeadStartPayment($id);
    $isPaid = !empty($payExtra['payment_free']) || !empty($payExtra['payment_already_paid']);
    if (!array_key_exists('payment_url', $payExtra) && !array_key_exists('payment_error', $payExtra) && !array_key_exists('payment_free', $payExtra) && !array_key_exists('payment_already_paid', $payExtra)) {
        // Payment not enabled on form — treat as no payment gate.
        $isPaid = true;
    }
    if (is_array($formRow)) {
        try {
            leadFormQueueAutoDocuments($db, $formRow, $id, $isPaid);
        } catch (Throwable $e) {
            error_log('[leadFormQueueAutoDocuments] ' . $e->getMessage());
        }
    }
    respond(array_merge(['success' => true, 'lead_id' => $id, 'destination' => 'leads'], $payExtra));
} catch (PDOException $e) {
    respond(['error' => 'Failed to save lead'], 500);
}
