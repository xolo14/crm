<?php
/**
 * Auto-generate & email offer letters / certificates for lead-form submissions.
 * Called from public-lead / payment sync (no HTTP auth).
 */
require_once __DIR__ . '/../document_storage.php';
require_once __DIR__ . '/../cert_ids.php';
require_once __DIR__ . '/LeadFormCertRender.php';
require_once __DIR__ . '/FormTemplatePlaceholders.php';

/**
 * @param array<string, string> $vars
 */
function leadFormAutoDocsApplyPlaceholders(string $html, array $vars): string
{
    $out = $html;
    foreach ($vars as $key => $value) {
        $k = trim((string) $key);
        if ($k === '') {
            continue;
        }
        $v = htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
        $out = str_ireplace('{{' . $k . '}}', $v, $out);
        $out = str_ireplace('{{ ' . $k . ' }}', $v, $out);
        $out = str_ireplace('<<' . $k . '>>', $v, $out);
    }
    // Soft-clear leftover simple tokens so Dompdf does not show braces.
    $out = preg_replace('/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/', '', $out) ?? $out;
    return $out;
}

/** @return array<string, mixed> */
function leadFormAutoDocsParseTags($raw): array
{
    if (is_array($raw)) {
        return $raw;
    }
    if (is_string($raw) && trim($raw) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    return [];
}

function leadFormAutoDocsParseDateTime(string $raw): ?DateTimeImmutable
{
    $raw = trim($raw);
    if ($raw === '' || $raw === '0000-00-00' || $raw === '0000-00-00 00:00:00') {
        return null;
    }
    try {
        return new DateTimeImmutable($raw);
    } catch (Throwable $e) {
        $ts = strtotime($raw);
        if ($ts === false) {
            return null;
        }
        return (new DateTimeImmutable())->setTimestamp($ts);
    }
}

function leadFormAutoDocsCertDelayMonths(array $meta): int
{
    $months = $meta['certificate_issue_delay_months'] ?? $meta['certificate_date_duration_days'] ?? 0;
    $n = (int) $months;
    return $n > 0 ? $n : 0;
}

function leadFormAutoDocsCertScheduledIssueAt(array $lead, int $delayMonths): DateTimeImmutable
{
    $created = leadFormAutoDocsParseDateTime((string) ($lead['created_at'] ?? ''));
    if (!$created instanceof DateTimeImmutable) {
        $created = new DateTimeImmutable('now');
    }
    if ($delayMonths <= 0) {
        return $created;
    }
    $next = $created->modify('+' . $delayMonths . ' months');
    return $next instanceof DateTimeImmutable ? $next : $created;
}

function leadFormAutoDocsDompdfAutoload(): ?string
{
    // Prefer shared composer loader when helpers/mail already registered paths.
    if (function_exists('syncpediaLoadComposerAutoload')) {
        syncpediaLoadComposerAutoload();
        if (class_exists(\Dompdf\Dompdf::class, false)) {
            return '__loaded__';
        }
    }
    $candidates = [
        __DIR__ . '/../../vendor/autoload.php',              // public/vendor (Hostinger)
        __DIR__ . '/../../../vendor/autoload.php',
        dirname(__DIR__, 2) . '/vendor/autoload.php',
        __DIR__ . '/../../php-backend/vendor/autoload.php',
        __DIR__ . '/../../../php-backend/vendor/autoload.php',
        dirname(__DIR__, 3) . '/php-backend/vendor/autoload.php',
        dirname(__DIR__, 2) . '/../php-backend/vendor/autoload.php',
    ];
    foreach ($candidates as $path) {
        if ($path !== '' && is_file($path)) {
            return $path;
        }
    }
    return null;
}

/**
 * Escape text for PDF literal strings (Helvetica / WinAnsi-safe subset).
 */
function leadFormAutoDocsPdfEscape(string $text): string
{
    // Drop characters Helvetica can't show; keep basic Latin.
    $text = preg_replace('/[^\x20-\x7E]/', '?', $text) ?? $text;
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
}

/**
 * Write a one-page PDF (Helvetica) from positioned lines.
 * Each line: [text, fontSize, yFromTop, center?]
 *
 * @param list<array{0:string,1:int|float,2:int|float,3?:bool}> $lines
 */
function leadFormAutoDocsBuildSimplePdf(int $w, int $h, array $lines): string
{
    $content = "0.11 0.62 0.46 RG\n6 w\n24 24 " . ($w - 48) . " " . ($h - 48) . " re S\n";
    $content .= "0.05 0.08 0.12 rg\n";
    foreach ($lines as $row) {
        $text = (string) ($row[0] ?? '');
        $size = (float) ($row[1] ?? 12);
        $yFromTop = (float) ($row[2] ?? 72);
        $center = !empty($row[3]);
        if ($text === '') {
            continue;
        }
        $y = $h - $yFromTop;
        $esc = leadFormAutoDocsPdfEscape($text);
        $approxWidth = strlen($text) * $size * 0.5;
        $x = $center ? max(36, ($w - $approxWidth) / 2) : 48;
        $content .= "BT /F1 {$size} Tf {$x} {$y} Td ({$esc}) Tj ET\n";
    }

    $len = strlen($content);
    $objects = [
        "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {$w} {$h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
        "4 0 obj<< /Length {$len} >>stream\n{$content}endstream endobj\n",
        "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ];

    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $obj) {
        $offsets[] = strlen($pdf);
        $pdf .= $obj;
    }
    $xrefPos = strlen($pdf);
    $count = count($objects) + 1;
    $pdf .= "xref\n0 {$count}\n0000000000 65535 f \n";
    for ($i = 1; $i < $count; $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }
    $pdf .= "trailer<< /Size {$count} /Root 1 0 R >>\nstartxref\n{$xrefPos}\n%%EOF";
    return $pdf;
}

/**
 * Pure-PHP landscape certificate PDF when Dompdf is not installed on the host.
 */
function leadFormAutoDocsBuildSimpleCertificatePdf(
    string $title,
    string $recipient,
    string $course,
    string $syncId,
    string $issueDateLabel,
    string $company = ''
): string {
    $lines = [
        ['CERTIFICATE OF COMPLETION', 16, 72, true],
        [$title !== '' ? $title : 'Certificate', 20, 120, true],
        ['This is to certify that', 12, 175, true],
        [$recipient !== '' ? $recipient : 'Participant', 26, 220, true],
        ['has successfully completed', 12, 270, true],
        [$course !== '' ? $course : 'Program', 16, 310, true],
        ['Certificate ID: ' . $syncId, 11, 380, true],
        ['Date: ' . $issueDateLabel, 11, 405, true],
    ];
    if (trim($company) !== '') {
        $lines[] = [$company, 11, 450, true];
    }
    return leadFormAutoDocsBuildSimplePdf(842, 595, $lines);
}

function leadFormAutoDocsHtmlToPlainText(string $html): string
{
    $t = preg_replace('/<(script|style)[^>]*>.*?<\/\1>/is', ' ', $html) ?? $html;
    $t = preg_replace('/<br\s*\/?>/i', "\n", $t) ?? $t;
    $t = preg_replace('/<\/(p|div|h[1-6]|tr|li|table)>/i', "\n", $t) ?? $t;
    $t = html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = preg_replace("/[ \t]+/", ' ', $t) ?? $t;
    $t = preg_replace("/\n{3,}/", "\n\n", $t) ?? $t;
    return trim($t);
}

/**
 * Portrait A4 PDF from offer-letter HTML (text only) when Dompdf is missing.
 */
function leadFormAutoDocsBuildSimpleOfferPdf(string $title, string $html): string
{
    $plain = leadFormAutoDocsHtmlToPlainText($html);
    if ($plain === '') {
        $plain = 'Offer letter';
    }
    $wrapped = [];
    foreach (preg_split("/\r\n|\n|\r/", $plain) ?: [] as $para) {
        $para = trim((string) $para);
        if ($para === '') {
            $wrapped[] = '';
            continue;
        }
        while (strlen($para) > 92) {
            $cut = strrpos(substr($para, 0, 92), ' ');
            if ($cut === false || $cut < 40) {
                $cut = 92;
            }
            $wrapped[] = substr($para, 0, $cut);
            $para = ltrim(substr($para, $cut));
        }
        if ($para !== '') {
            $wrapped[] = $para;
        }
    }
    $wrapped = array_slice($wrapped, 0, 42);
    $lines = [
        ['OFFER LETTER', 16, 56, true],
        [$title !== '' ? $title : 'Offer Letter', 14, 82, true],
    ];
    $y = 120;
    foreach ($wrapped as $line) {
        $lines[] = [$line, 10, $y, false];
        $y += 14;
        if ($y > 760) {
            break;
        }
    }
    return leadFormAutoDocsBuildSimplePdf(595, 842, $lines);
}

/**
 * @return array{ok:bool,error?:string}
 */
function leadFormAutoDocsRenderHtmlPdf(string $html, string $destAbsPath, string $orientation = 'portrait'): array
{
    $dir = dirname($destAbsPath);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Cannot create PDF storage folder'];
    }
    $autoload = leadFormAutoDocsDompdfAutoload();
    if ($autoload !== null && $autoload !== '__loaded__') {
        require_once $autoload;
    }
    if (class_exists(\Dompdf\Dompdf::class)) {
        try {
            $options = new \Dompdf\Options();
            $options->set('isRemoteEnabled', false);
            $options->set('isHtml5ParserEnabled', true);
            $dompdf = new \Dompdf\Dompdf($options);
            $wrapped = $html;
            if (stripos($wrapped, '<html') === false) {
                $wrapped = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
                    . '<style>body{font-family: DejaVu Sans, sans-serif; font-size: 12px;}</style>'
                    . '</head><body>' . $wrapped . '</body></html>';
            }
            $dompdf->loadHtml($wrapped, 'UTF-8');
            $dompdf->setPaper('A4', $orientation === 'landscape' ? 'landscape' : 'portrait');
            $dompdf->render();
            $out = $dompdf->output();
            if ($out === false || $out === '') {
                return ['ok' => false, 'error' => 'Empty PDF'];
            }
            if (@file_put_contents($destAbsPath, $out) === false) {
                return ['ok' => false, 'error' => 'Could not write PDF'];
            }
            return ['ok' => true];
        } catch (Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    return ['ok' => false, 'error' => 'Dompdf not installed'];
}

/**
 * @param array<string, mixed> $formRow
 * @param array<string, mixed> $lead
 * @param array<string, mixed> $meta
 * @return array{ok:bool,error?:string,id?:string}
 */
function leadFormAutoDocsSendOffer(PDO $db, array $formRow, array $lead, array $meta): array
{
    $templateId = trim((string) ($meta['offer_letter_template_id'] ?? ''));
    if ($templateId === '') {
        return ['ok' => false, 'error' => 'No offer letter template selected'];
    }
    $email = trim((string) ($lead['email'] ?? ''));
    $name = trim((string) ($lead['name'] ?? 'Candidate'));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Lead email required for offer letter'];
    }

    $orgId = trim((string) ($formRow['org_id'] ?? $lead['org_id'] ?? ''));
    $st = $db->prepare('SELECT * FROM offer_letter_templates WHERE id = ? LIMIT 1');
    $st->execute([$templateId]);
    $tpl = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($tpl)) {
        return ['ok' => false, 'error' => 'Offer letter template not found'];
    }
    $tplOrg = trim((string) ($tpl['org_id'] ?? ''));
    if ($orgId !== '' && $tplOrg !== '' && $tplOrg !== $orgId) {
        return ['ok' => false, 'error' => 'Offer letter template org mismatch'];
    }

    $roleTitle = trim((string) ($tpl['role_title'] ?? ''));
    if ($roleTitle === '') {
        $roleTitle = trim((string) ($lead['course_interest'] ?? $formRow['name'] ?? 'Participant'));
    }
    $mailRaw = $tpl['mail_json'] ?? null;
    $mail = [];
    if (is_string($mailRaw) && $mailRaw !== '') {
        $decoded = json_decode($mailRaw, true);
        $mail = is_array($decoded) ? $decoded : [];
    } elseif (is_array($mailRaw)) {
        $mail = $mailRaw;
    }

    $vars = [
        'candidate_name' => $name,
        'recipient_name' => $name,
        'recipient_email' => $email,
        'email' => $email,
        'phone' => trim((string) ($lead['phone'] ?? '')),
        'role_title' => $roleTitle,
        'course_interest' => trim((string) ($lead['course_interest'] ?? '')),
        'college' => trim((string) ($lead['college'] ?? '')),
        'date' => date('d M Y'),
        'company_name' => trim((string) ($mail['company_name'] ?? '')),
        'form_name' => trim((string) ($formRow['name'] ?? '')),
    ];
    $placeholders = formTplExtractOfferPlaceholders($tpl);
    $vars = formTplFillDocumentVars(
        $lead,
        $formRow,
        $placeholders,
        formTplParseSavedMap($meta['offer_letter_placeholder_map'] ?? null),
        $vars,
        [
            'course' => trim((string) ($lead['course_interest'] ?? $formRow['name'] ?? '')),
            'company' => trim((string) ($mail['company_name'] ?? '')),
        ]
    );
    if (trim((string) ($vars['role_title'] ?? '')) === '') {
        $vars['role_title'] = $roleTitle;
    }
    $html = leadFormAutoDocsApplyPlaceholders((string) ($tpl['html_content'] ?? ''), $vars);
    $subject = leadFormAutoDocsApplyPlaceholders(
        (string) ($mail['mail_subject'] ?? ('Offer Letter — ' . $roleTitle)),
        $vars
    );
    $emailHtml = leadFormAutoDocsApplyPlaceholders(
        (string) ($mail['mail_body'] ?? ('<p>Dear {{candidate_name}},</p><p>Please find your offer letter attached.</p>')),
        $vars
    );
    if (trim(strip_tags($emailHtml)) === '') {
        $emailHtml = '<p>Dear ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8')
            . ',</p><p>Please find your offer letter attached as a PDF.</p>';
    }

    $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
    $storageRoot = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'offer_letters';
    if (!is_dir($storageRoot)) {
        @mkdir($storageRoot, 0775, true);
    }
    $pdfPath = $storageRoot . DIRECTORY_SEPARATOR . $id . '.pdf';
    $rendered = leadFormAutoDocsRenderHtmlPdf($html, $pdfPath, 'portrait');
    if (empty($rendered['ok'])) {
        $fallback = leadFormAutoDocsBuildSimpleOfferPdf($roleTitle !== '' ? $roleTitle : 'Offer Letter', $html);
        if ($fallback === '' || @file_put_contents($pdfPath, $fallback) === false) {
            return ['ok' => false, 'error' => $rendered['error'] ?? 'Offer letter PDF failed'];
        }
        error_log('[leadFormAutoDocsSendOffer] Dompdf unavailable (' . ($rendered['error'] ?? 'n/a') . '); used simple PDF fallback');
    }
    if (!is_file($pdfPath)) {
        return ['ok' => false, 'error' => 'Offer letter PDF path missing after save'];
    }

    $attachName = trim((string) ($mail['pdf_filename_pattern'] ?? ''));
    if ($attachName === '') {
        $attachName = 'Offer_Letter_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $name) . '.pdf';
    } else {
        $attachName = leadFormAutoDocsApplyPlaceholders($attachName, $vars);
        if (!preg_match('/\.pdf$/i', $attachName)) {
            $attachName .= '.pdf';
        }
    }

    $pdfUrl = '/api/offer-letters.php?action=pdf&id=' . rawurlencode($id);
    $sentBy = trim((string) ($formRow['created_by'] ?? ''));
    try {
        $db->prepare(
            'INSERT INTO offer_letters_sent
             (id, template_id, recipient_name, recipient_email, role_title, html_content, pdf_url, status, sent_by, org_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $id,
            $templateId,
            $name,
            $email,
            $roleTitle,
            $html,
            $pdfUrl,
            'sent',
            $sentBy !== '' ? $sentBy : null,
            $orgId !== '' ? $orgId : null,
        ]);
    } catch (Throwable $e) {
        error_log('[leadFormAutoDocsSendOffer] record: ' . $e->getMessage());
        // Non-fatal — still try to email.
    }

    try {
        if (function_exists('syncpediaDocumentEnsureColumn')) {
            syncpediaDocumentEnsureColumn($db, 'offer_letters_sent', 'pdf_path', 'TEXT DEFAULT NULL');
        }
        $rel = function_exists('syncpediaDocumentStorageRelativePath')
            ? syncpediaDocumentStorageRelativePath($pdfPath)
            : ('offer_letters/' . $id . '.pdf');
        if (is_string($rel) && $rel !== '') {
            $db->prepare('UPDATE offer_letters_sent SET pdf_path = ? WHERE id = ?')->execute([$rel, $id]);
        }
    } catch (Throwable $e) {
        /* ignore */
    }

    $attachments = is_file($pdfPath) ? [['path' => $pdfPath, 'name' => $attachName]] : [];
    syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'offer_letters');
    $mailResult = syncpediaSendHrHtmlEmail(
        $email,
        $subject !== '' ? $subject : 'Offer Letter',
        $emailHtml,
        $attachments,
        '',
        '',
        ''
    );
    if (empty($mailResult['ok'])) {
        error_log('[leadFormAutoDocsSendOffer] email: ' . ($mailResult['error'] ?? 'failed'));
        return [
            'ok' => true,
            'id' => $id,
            'warning' => 'Offer letter saved but email failed: ' . ($mailResult['error'] ?? 'send failed'),
        ];
    }

    return ['ok' => true, 'id' => $id];
}

/**
 * @param array<string, mixed> $formRow
 * @param array<string, mixed> $lead
 * @param array<string, mixed> $meta
 * @return array{ok:bool,error?:string,id?:string}
 */
function leadFormAutoDocsSendCertificate(PDO $db, array $formRow, array $lead, array $meta): array
{
    $templateId = trim((string) ($meta['certificate_template_id'] ?? ''));
    if ($templateId === '') {
        return ['ok' => false, 'error' => 'No certificate template selected'];
    }
    $email = trim((string) ($lead['email'] ?? ''));
    $name = trim((string) ($lead['name'] ?? 'Participant'));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Lead email required for certificate'];
    }

    $orgId = trim((string) ($formRow['org_id'] ?? $lead['org_id'] ?? ''));
    $st = $db->prepare('SELECT * FROM certificate_templates WHERE id = ? LIMIT 1');
    $st->execute([$templateId]);
    $tpl = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($tpl)) {
        return ['ok' => false, 'error' => 'Certificate template not found'];
    }
    $tplOrg = trim((string) ($tpl['org_id'] ?? ''));
    if ($orgId !== '' && $tplOrg !== '' && $tplOrg !== $orgId) {
        return ['ok' => false, 'error' => 'Certificate template org mismatch'];
    }

    $course = trim((string) ($meta['certificate_course_name'] ?? ''));
    if ($course === '') {
        $course = trim((string) ($lead['course_interest'] ?? $formRow['name'] ?? 'Program'));
    }
    $tplName = trim((string) ($tpl['name'] ?? 'Certificate'));
    $certType = function_exists('certNormalizeType')
        ? certNormalizeType($tpl['cert_type'] ?? 'CC')
        : 'CC';
    $prefix = $orgId !== '' && function_exists('certGetOrgPrefix') ? certGetOrgPrefix($db, $orgId) : null;
    if (($prefix === null || $prefix === '') && $orgId !== '' && function_exists('certClaimOrgPrefix') && function_exists('certSuggestPrefix')) {
        $wanted = certSuggestPrefix($db, $orgId);
        $claimed = certClaimOrgPrefix($db, $orgId, $wanted);
        if (!empty($claimed['ok'])) {
            $prefix = (string) ($claimed['prefix'] ?? '');
        }
    }
    if ($prefix === null || $prefix === '') {
        $prefix = 'SP';
    }
    $syncId = function_exists('certGenerateIssuedId')
        ? certGenerateIssuedId($db, $prefix, $certType)
        : (strtoupper($prefix) . '-' . strtoupper($certType) . '-' . (string) random_int(100000, 999999));
    $verifyToken = bin2hex(random_bytes(24));

    $style = leadFormCertDecodeJson($tpl['style_json'] ?? null);
    $fields = leadFormCertDecodeJson($tpl['fields_json'] ?? null);
    $company = trim((string) ($fields['companyName'] ?? $style['company_name'] ?? $style['mail_from_name'] ?? ''));
    $delayMonths = leadFormAutoDocsCertDelayMonths($meta);
    $issueAt = leadFormAutoDocsCertScheduledIssueAt($lead, $delayMonths);
    $issueDate = $issueAt->format('Y-m-d');
    $issueDateLabel = $issueAt->format('d M Y');

    $tokenVars = [
        'recipient_name' => $name,
        'name' => $name,
        'candidate_name' => $name,
        'domain_name' => $course,
        'domain' => $course,
        'course' => $course,
        'course_name' => $course,
        'company_name' => $company,
        'company' => $company,
        'issue_date' => $issueDateLabel,
        'date' => $issueDateLabel,
        'cert_id' => $syncId,
        'certID' => $syncId,
        'CertID' => $syncId,
        'sync_id' => $syncId,
        'email' => $email,
        'recipient_email' => $email,
    ];
    $placeholders = formTplExtractCertificatePlaceholders($tpl);
    $tokenVars = formTplFillDocumentVars(
        $lead,
        $formRow,
        $placeholders,
        formTplParseSavedMap($meta['certificate_placeholder_map'] ?? null),
        $tokenVars,
        [
            'course' => $course,
            'company' => $company,
        ]
    );
    $course = trim((string) ($tokenVars['domain_name'] ?? $tokenVars['course'] ?? $course));
    $company = trim((string) ($tokenVars['company_name'] ?? $tokenVars['company'] ?? $company));
    $name = trim((string) ($tokenVars['recipient_name'] ?? $tokenVars['name'] ?? $name));

    $pdfName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $name) . '_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';
    $tmpDir = sys_get_temp_dir();
    $tmpPdf = $tmpDir . DIRECTORY_SEPARATOR . 'lead_cert_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';

    $pageFormat = strtolower(trim((string) ($style['pageFormat'] ?? 'a4-landscape')));
    $orientation = str_contains($pageFormat, 'portrait') ? 'portrait' : 'landscape';

    $renderedTemplate = leadFormCertRenderTemplatePdf($tpl, $tokenVars);
    if (!empty($renderedTemplate['ok']) && !empty($renderedTemplate['pdf'])) {
        if (@file_put_contents($tmpPdf, $renderedTemplate['pdf']) === false) {
            return ['ok' => false, 'error' => 'Could not write certificate PDF'];
        }
    } else {
        error_log('[leadFormAutoDocsSendCertificate] template render: ' . ($renderedTemplate['error'] ?? 'failed'));
        $html = '<div style="width:100%;min-height:520px;border:10px solid #1D9E75;padding:48px 40px;text-align:center;box-sizing:border-box;">'
            . '<p style="letter-spacing:4px;text-transform:uppercase;color:#64748b;font-size:12px;margin:0 0 12px;">Certificate of Completion</p>'
            . '<h1 style="font-size:28px;margin:0 0 28px;color:#0f172a;">' . htmlspecialchars($tplName, ENT_QUOTES, 'UTF-8') . '</h1>'
            . '<p style="font-size:14px;color:#475569;margin:0 0 8px;">This is to certify that</p>'
            . '<h2 style="font-size:32px;margin:8px 0 20px;color:#1D9E75;">' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</h2>'
            . '<p style="font-size:14px;color:#475569;margin:0 0 8px;">has successfully completed</p>'
            . '<h3 style="font-size:20px;margin:8px 0 28px;color:#0f172a;">' . htmlspecialchars($course, ENT_QUOTES, 'UTF-8') . '</h3>'
            . '<p style="font-size:12px;color:#64748b;margin:24px 0 4px;">Certificate ID: <strong>' . htmlspecialchars($syncId, ENT_QUOTES, 'UTF-8') . '</strong></p>'
            . '<p style="font-size:12px;color:#64748b;margin:0;">Date: ' . htmlspecialchars($issueDateLabel, ENT_QUOTES, 'UTF-8') . '</p>'
            . ($company !== '' ? '<p style="font-size:12px;color:#94a3b8;margin-top:28px;">' . htmlspecialchars($company, ENT_QUOTES, 'UTF-8') . '</p>' : '')
            . '</div>';
        $rendered = leadFormAutoDocsRenderHtmlPdf($html, $tmpPdf, $orientation);
        if (empty($rendered['ok'])) {
            $fallback = leadFormAutoDocsBuildSimpleCertificatePdf(
                $tplName,
                $name,
                $course,
                $syncId,
                $issueDateLabel,
                $company
            );
            if ($fallback === '' || @file_put_contents($tmpPdf, $fallback) === false) {
                return ['ok' => false, 'error' => $renderedTemplate['error'] ?? $rendered['error'] ?? 'Certificate PDF failed'];
            }
        }
    }
    $pdfBytes = @file_get_contents($tmpPdf);
    @unlink($tmpPdf);
    if (!is_string($pdfBytes) || $pdfBytes === '') {
        return ['ok' => false, 'error' => 'Could not read certificate PDF'];
    }

    $gcsKey = function_exists('syncpediaGcsObjectKey')
        ? syncpediaGcsObjectKey($orgId !== '' ? $orgId : null, 'certificates', $syncId, $name)
        : '';
    $saved = syncpediaDocumentStorageSaveAndUpload('certificates', $pdfName, $pdfBytes, $gcsKey);
    if (empty($saved['ok'])) {
        return ['ok' => false, 'error' => $saved['error'] ?? 'Could not store certificate PDF'];
    }
    $pdfPathRel = (string) ($saved['local_path'] ?? '');
    $pdfPathAbs = isset($saved['local_abs']) && is_string($saved['local_abs'])
        ? $saved['local_abs']
        : (function_exists('syncpediaDocumentStorageResolvePath')
            ? (string) (syncpediaDocumentStorageResolvePath($pdfPathRel) ?: '')
            : '');
    $gcsObject = isset($saved['gcs_object']) && is_string($saved['gcs_object']) ? $saved['gcs_object'] : null;

    $artifactId = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
    $leadUuid = trim((string) ($lead['id'] ?? ''));
    $recipientId = strlen($leadUuid) === 36 ? $leadUuid : substr(bin2hex(random_bytes(16)), 0, 36);
    $issuedBy = trim((string) ($formRow['created_by'] ?? ''));

    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS certificate_issue_artifacts (
              id CHAR(36) NOT NULL,
              recipient_id CHAR(36) DEFAULT NULL,
              template_id CHAR(36) DEFAULT NULL,
              sync_id VARCHAR(80) NOT NULL,
              student_name VARCHAR(255) DEFAULT NULL,
              student_email VARCHAR(255) DEFAULT NULL,
              course_name VARCHAR(255) DEFAULT NULL,
              issue_date DATE DEFAULT NULL,
              verify_token TEXT DEFAULT NULL,
              pdf_path TEXT DEFAULT NULL,
              gcs_object TEXT DEFAULT NULL,
              org_id CHAR(36) DEFAULT NULL,
              issued_by CHAR(36) DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE (sync_id)
            )
        ");
    } catch (Throwable $e) {
        /* ignore */
    }

    try {
        $db->prepare(
            'INSERT INTO certificate_issue_artifacts
             (id, recipient_id, template_id, sync_id, student_name, student_email, course_name, issue_date, verify_token, pdf_path, gcs_object, org_id, issued_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               student_name = VALUES(student_name),
               student_email = VALUES(student_email),
               course_name = VALUES(course_name),
               pdf_path = VALUES(pdf_path),
               gcs_object = VALUES(gcs_object),
               verify_token = VALUES(verify_token)'
        )->execute([
            $artifactId,
            $recipientId,
            $templateId,
            $syncId,
            $name,
            $email,
            $course,
            $issueDate,
            $verifyToken,
            $pdfPathRel,
            $gcsObject,
            $orgId !== '' ? $orgId : null,
            $issuedBy !== '' ? $issuedBy : null,
        ]);
    } catch (Throwable $e) {
        error_log('[leadFormAutoDocsSendCertificate] artifact: ' . $e->getMessage());
        return ['ok' => false, 'error' => 'Could not save certificate record: ' . $e->getMessage()];
    }

    // Also register in Certificates → Issued (same registry the UI reads).
    try {
        $hasVerify = function_exists('syncpediaColumnExists')
            && syncpediaColumnExists($db, 'issued_certificates', 'verify_token');
        if ($hasVerify) {
            $db->prepare(
                'INSERT INTO issued_certificates
                 (id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, issued_by, org_id, verify_token)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   recipient_name = VALUES(recipient_name),
                   course_name = VALUES(course_name),
                   status = VALUES(status),
                   verify_token = VALUES(verify_token)'
            )->execute([
                $syncId,
                $templateId,
                $tplName,
                $name,
                $course,
                $certType,
                $issueDate,
                'issued',
                $issuedBy !== '' ? $issuedBy : null,
                $orgId !== '' ? $orgId : null,
                $verifyToken,
            ]);
        } else {
            $db->prepare(
                'INSERT INTO issued_certificates
                 (id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, issued_by, org_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   recipient_name = VALUES(recipient_name),
                   course_name = VALUES(course_name),
                   status = VALUES(status)'
            )->execute([
                $syncId,
                $templateId,
                $tplName,
                $name,
                $course,
                $certType,
                $issueDate,
                'issued',
                $issuedBy !== '' ? $issuedBy : null,
                $orgId !== '' ? $orgId : null,
            ]);
        }
    } catch (Throwable $e) {
        error_log('[leadFormAutoDocsSendCertificate] issued_certificates: ' . $e->getMessage());
        // Non-fatal — artifact + email still matter.
    }

    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS doc_issued_documents (
              id CHAR(36) NOT NULL PRIMARY KEY,
              org_id CHAR(36) DEFAULT NULL,
              doc_kind VARCHAR(32) NOT NULL,
              form_id CHAR(36) DEFAULT NULL,
              submission_id CHAR(36) DEFAULT NULL,
              template_id CHAR(36) DEFAULT NULL,
              recipient_name VARCHAR(255) DEFAULT NULL,
              recipient_email VARCHAR(255) DEFAULT NULL,
              subject VARCHAR(500) DEFAULT NULL,
              pdf_path VARCHAR(500) DEFAULT NULL,
              pdf_url VARCHAR(500) DEFAULT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'issued',
              issued_by CHAR(36) DEFAULT NULL,
              issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              meta_json JSON DEFAULT NULL,
              INDEX idx_did_kind (doc_kind),
              INDEX idx_did_org (org_id),
              INDEX idx_did_form (form_id)
            )
        ");
        $pdfUrl = '/api/certificates.php?action=pdf&certificate_id=' . rawurlencode($syncId);
        $db->prepare(
            'INSERT INTO doc_issued_documents
             (id, org_id, doc_kind, form_id, submission_id, template_id, recipient_name, recipient_email, subject, pdf_path, pdf_url, status, issued_by, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16)),
            $orgId !== '' ? $orgId : null,
            'certificate',
            trim((string) ($formRow['id'] ?? '')) !== '' ? trim((string) $formRow['id']) : null,
            $leadUuid !== '' ? $leadUuid : null,
            $templateId,
            $name,
            $email,
            'Certificate — ' . $course,
            $pdfPathRel !== '' ? $pdfPathRel : null,
            $pdfUrl,
            'issued',
            $issuedBy !== '' ? $issuedBy : null,
            json_encode([
                'source' => 'lead_form_auto',
                'cert_id' => $syncId,
                'template_name' => $tplName,
            ], JSON_UNESCAPED_UNICODE),
        ]);
    } catch (Throwable $e) {
        error_log('[leadFormAutoDocsSendCertificate] doc_issued: ' . $e->getMessage());
    }

    $mailSubject = trim((string) ($style['mail_subject'] ?? 'Your Certificate'));
    $mailBody = trim((string) ($style['mail_body'] ?? ''));
    if ($mailBody === '') {
        $mailBody = '<p>Dear ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8')
            . ',</p><p>Please find your certificate for <strong>'
            . htmlspecialchars($course, ENT_QUOTES, 'UTF-8')
            . '</strong> attached.</p><p>Certificate ID: '
            . htmlspecialchars($syncId, ENT_QUOTES, 'UTF-8') . '</p>';
    } else {
        $mailBody = leadFormAutoDocsApplyPlaceholders($mailBody, [
            'recipient_name' => $name,
            'candidate_name' => $name,
            'name' => $name,
            'domain_name' => $course,
            'course_name' => $course,
            'cert_id' => $syncId,
            'certID' => $syncId,
            'issue_date' => $issueDateLabel,
            'company_name' => $company,
        ]);
    }

    $attachPath = $pdfPathAbs !== '' && is_file($pdfPathAbs) ? $pdfPathAbs : null;
    if ($attachPath === null && $pdfPathRel !== '') {
        $resolved = syncpediaDocumentStorageResolvePath($pdfPathRel);
        if (is_string($resolved) && is_file($resolved)) {
            $attachPath = $resolved;
        }
    }
    if ($attachPath === null) {
        // Certificate is saved; email attachment missing — still count as issued.
        return [
            'ok' => true,
            'id' => $syncId,
            'warning' => 'Certificate saved but PDF path missing for email attachment',
        ];
    }

    syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'certificates');
    $send = function_exists('syncpediaSendCertificateEmail')
        ? syncpediaSendCertificateEmail(
            $email,
            $mailSubject !== '' ? $mailSubject : 'Your Certificate',
            $mailBody,
            '',
            '',
            [['path' => $attachPath, 'name' => $pdfName]],
        )
        : syncpediaSendHrHtmlEmail(
            $email,
            $mailSubject !== '' ? $mailSubject : 'Your Certificate',
            $mailBody,
            [['path' => $attachPath, 'name' => $pdfName]],
        );
    if (empty($send['ok'])) {
        // Keep issued record; surface mail failure for retry/debug.
        error_log('[leadFormAutoDocsSendCertificate] email: ' . ($send['error'] ?? 'failed'));
        return [
            'ok' => true,
            'id' => $syncId,
            'warning' => 'Certificate issued but email failed: ' . ($send['error'] ?? 'send failed'),
        ];
    }

    return ['ok' => true, 'id' => $syncId];
}

/**
 * Process auto offer/certificate for a lead (creates + emails when toggles allow).
 *
 * @param array<string, mixed>|null $formRow
 * @param array<string, mixed>|null $metaOverride  Prefer fresh form meta from the request path
 */
function leadFormProcessAutoDocuments(PDO $db, $formRow, string $leadId, bool $isPaid, ?array $metaOverride = null, bool $ignoreDelay = false): void
{
    if (!is_array($formRow) || $leadId === '') {
        return;
    }

    // Always re-read the form row so Automations toggles saved after page load are used.
    $formId = trim((string) ($formRow['id'] ?? ''));
    if ($formId !== '') {
        try {
            $fresh = $db->prepare('SELECT * FROM lead_forms WHERE id = ? LIMIT 1');
            $fresh->execute([$formId]);
            $freshRow = $fresh->fetch(PDO::FETCH_ASSOC);
            if (is_array($freshRow)) {
                $formRow = $freshRow;
            }
        } catch (Throwable $e) {
            error_log('[leadFormProcessAutoDocuments] refresh form: ' . $e->getMessage());
        }
    }

    $meta = [];
    if (is_array($metaOverride) && $metaOverride !== []) {
        $meta = $metaOverride;
    } else {
        $rawMeta = $formRow['meta_json'] ?? null;
        if (is_string($rawMeta)) {
            $decoded = json_decode($rawMeta, true);
            $meta = is_array($decoded) ? $decoded : [];
        } elseif (is_array($rawMeta)) {
            $meta = $rawMeta;
        }
    }
    // Prefer DB meta for document flags (override may be stale from request start).
    $rawMetaDb = $formRow['meta_json'] ?? null;
    if (is_string($rawMetaDb)) {
        $decodedDb = json_decode($rawMetaDb, true);
        if (is_array($decodedDb)) {
            foreach ([
                'auto_offer_letter', 'offer_letter_require_payment', 'offer_letter_template_id',
                'auto_certificate', 'certificate_require_payment', 'certificate_template_id',
                'certificate_course_name', 'certificate_placeholder_map', 'offer_letter_placeholder_map',
                'certificate_date_duration_days', 'certificate_issue_delay_months',
            ] as $k) {
                if (array_key_exists($k, $decodedDb)) {
                    $meta[$k] = $decodedDb[$k];
                }
            }
        }
    }

    $doOffer = !empty($meta['auto_offer_letter'])
        && (empty($meta['offer_letter_require_payment']) || $isPaid);
    $doCert = !empty($meta['auto_certificate'])
        && (empty($meta['certificate_require_payment']) || $isPaid);
    if (!$doOffer && !$doCert) {
        error_log('[leadFormProcessAutoDocuments] skip lead=' . $leadId
            . ' auto_cert=' . (!empty($meta['auto_certificate']) ? '1' : '0')
            . ' require_pay=' . (!empty($meta['certificate_require_payment']) ? '1' : '0')
            . ' isPaid=' . ($isPaid ? '1' : '0')
            . ' tpl=' . trim((string) ($meta['certificate_template_id'] ?? '')));
        return;
    }

    $leadSt = $db->prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
    $leadSt->execute([$leadId]);
    $lead = $leadSt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($lead)) {
        return;
    }

    $tagsRaw = $lead['tags'] ?? null;
    $tags = [];
    if (is_string($tagsRaw)) {
        $decoded = json_decode($tagsRaw, true);
        $tags = is_array($decoded) ? $decoded : [];
    } elseif (is_array($tagsRaw)) {
        $tags = $tagsRaw;
    }

    $changed = false;

    if ($doOffer && empty($tags['auto_offer_letter_sent'])) {
        $tags['auto_offer_letter_queued'] = true;
        $res = leadFormAutoDocsSendOffer($db, $formRow, $lead, $meta);
        if (!empty($res['ok'])) {
            $tags['auto_offer_letter_sent'] = true;
            $tags['auto_offer_letter_id'] = (string) ($res['id'] ?? '');
            $tags['auto_offer_letter_at'] = gmdate('c');
            unset($tags['auto_offer_letter_error']);
            if (!empty($res['warning'])) {
                $tags['auto_offer_letter_warning'] = (string) $res['warning'];
            }
        } else {
            $tags['auto_offer_letter_error'] = (string) ($res['error'] ?? 'failed');
            error_log('[leadFormProcessAutoDocuments] offer: ' . ($res['error'] ?? 'failed'));
        }
        $changed = true;
    }

    if ($doCert && empty($tags['auto_certificate_sent'])) {
        $delayMonths = leadFormAutoDocsCertDelayMonths($meta);
        $issueAt = leadFormAutoDocsCertScheduledIssueAt($lead, $delayMonths);
        $now = new DateTimeImmutable('now');
        if (!$ignoreDelay && $issueAt > $now) {
            $tags['auto_certificate_queued'] = true;
            $tags['auto_certificate_due_at'] = $issueAt->format('c');
            if ($formId !== '') {
                $tags['form_id'] = $formId;
            }
            unset($tags['auto_certificate_error']);
            $changed = true;
        } else {
            $tags['auto_certificate_queued'] = true;
            $res = leadFormAutoDocsSendCertificate($db, $formRow, $lead, $meta);
            if (!empty($res['ok'])) {
                $tags['auto_certificate_sent'] = true;
                $tags['auto_certificate_id'] = (string) ($res['id'] ?? '');
                $tags['auto_certificate_at'] = gmdate('c');
                unset($tags['auto_certificate_error'], $tags['auto_certificate_due_at']);
                if (!empty($res['warning'])) {
                    $tags['auto_certificate_warning'] = (string) $res['warning'];
                }
            } else {
                $tags['auto_certificate_error'] = (string) ($res['error'] ?? 'failed');
                error_log('[leadFormProcessAutoDocuments] cert: ' . ($res['error'] ?? 'failed'));
            }
            $changed = true;
        }
    }

    if ($changed) {
        try {
            $db->prepare('UPDATE leads SET tags = ? WHERE id = ?')->execute([
                json_encode($tags, JSON_UNESCAPED_UNICODE),
                $leadId,
            ]);
        } catch (Throwable $e) {
            error_log('[leadFormProcessAutoDocuments] tags: ' . $e->getMessage());
        }
    }
}

/**
 * Issue queued certificates whose due date (lead created_at + duration months) has passed.
 *
 * @return array{scanned:int,issued:int,skipped:int}
 */
function leadFormProcessDueAutoCertificates(PDO $db, int $limit = 80): array
{
    $out = ['scanned' => 0, 'issued' => 0, 'skipped' => 0];
    $rows = [];
    try {
        $st = $db->query(
            "SELECT id, tags FROM leads
             WHERE tags IS NOT NULL AND tags LIKE '%auto_certificate_due_at%'
             ORDER BY created_at ASC
             LIMIT " . max(1, (int) $limit)
        );
        $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        error_log('[leadFormProcessDueAutoCertificates] list: ' . $e->getMessage());
        return $out;
    }

    $now = new DateTimeImmutable('now');
    $forms = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $out['scanned']++;
        $leadId = trim((string) ($row['id'] ?? ''));
        $tags = leadFormAutoDocsParseTags($row['tags'] ?? null);
        if ($leadId === '' || !empty($tags['auto_certificate_sent'])) {
            $out['skipped']++;
            continue;
        }
        $due = leadFormAutoDocsParseDateTime((string) ($tags['auto_certificate_due_at'] ?? ''));
        if (!$due instanceof DateTimeImmutable || $due > $now) {
            $out['skipped']++;
            continue;
        }
        $formId = trim((string) ($tags['form_id'] ?? ''));
        if ($formId === '') {
            $out['skipped']++;
            continue;
        }
        if (!array_key_exists($formId, $forms)) {
            try {
                $fst = $db->prepare('SELECT * FROM lead_forms WHERE id = ? LIMIT 1');
                $fst->execute([$formId]);
                $forms[$formId] = $fst->fetch(PDO::FETCH_ASSOC) ?: null;
            } catch (Throwable $e) {
                $forms[$formId] = null;
            }
        }
        $formRow = $forms[$formId];
        if (!is_array($formRow)) {
            $out['skipped']++;
            continue;
        }
        // due_at is only written after the payment gate already passed.
        $beforeSent = !empty($tags['auto_certificate_sent']);
        try {
            leadFormProcessAutoDocuments($db, $formRow, $leadId, true);
            $chk = $db->prepare('SELECT tags FROM leads WHERE id = ? LIMIT 1');
            $chk->execute([$leadId]);
            $after = leadFormAutoDocsParseTags($chk->fetchColumn());
            if (!$beforeSent && !empty($after['auto_certificate_sent'])) {
                $out['issued']++;
            } else {
                $out['skipped']++;
            }
        } catch (Throwable $e) {
            $out['skipped']++;
            error_log('[leadFormProcessDueAutoCertificates] lead=' . $leadId . ' ' . $e->getMessage());
        }
    }
    return $out;
}
