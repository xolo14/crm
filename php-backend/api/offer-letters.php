<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/document_storage.php';
cors();

$db = (new Database())->getConnection();
offerLettersEnsurePdfPathColumn($db);
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

/** Admins/managers always; HR only when page_access.offer_letters is enabled. */
function offerLettersRequireCallerAccess(PDO $db, array $tokenData): void {
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if (in_array($role, ['super_admin', 'admin', 'manager', 'org'], true)) {
        return;
    }
    if ($role === 'hr') {
        ensureUsersPageAccessColumn($db);
        try {
            $st = $db->prepare('SELECT role, page_access_json FROM users WHERE id = ? LIMIT 1');
            $st->execute([(string) ($tokenData['user_id'] ?? '')]);
            $row = $st->fetch(PDO::FETCH_ASSOC) ?: ['role' => 'hr', 'page_access_json' => null];
        } catch (Throwable $e) {
            $row = ['role' => 'hr', 'page_access_json' => null];
        }
        if (userCanAccessOfferLettersPage($tokenData, is_array($row) ? $row : null)) {
            return;
        }
    }
    respond(['error' => 'Forbidden — Offer Letters access is disabled for this account'], 403);
}

offerLettersRequireCallerAccess($db, $tokenData);

function offerLetterStorageDir(): string {
    return syncpediaDocumentStorageDir('offer_letters');
}

function offerLettersEnsurePdfPathColumn(PDO $db): void {
    syncpediaDocumentEnsureColumn($db, 'offer_letters_sent', 'pdf_path', 'TEXT DEFAULT NULL');
}

/** Absolute filesystem path for the saved PDF (one file per sent-letter id). */
function offerLetterPdfFilePath(string $id): string {
    $safe = preg_replace('/[^a-f0-9\-]/i', '', $id);
    if ($safe === '') {
        $safe = 'unknown';
    }
    return offerLetterStorageDir() . DIRECTORY_SEPARATOR . $safe . '.pdf';
}

function offerLetterPublicPdfUrl(string $id): string {
    return '/api/offer-letters.php?action=pdf&id=' . rawurlencode($id);
}

/** Org-scoped access for offer letter templates (sent letters already use orgFilter). */
function offerLetterTemplateOrgFilter($tokenData, string $tableAlias = 't'): array {
    return orgFilter($tokenData, $tableAlias);
}

function offerLettersFetchTemplateInScope(PDO $db, $tokenData, string $id): ?array {
    $org = offerLetterTemplateOrgFilter($tokenData, '');
    $params = array_merge([$id], $org['params']);
    $stmt = $db->prepare("SELECT * FROM offer_letter_templates WHERE id = ? AND {$org['where']} LIMIT 1");
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * Render HTML to PDF on disk using Dompdf (composer install in php-backend).
 * Returns false if vendor/autoload is missing or rendering fails.
 */
/** Composer autoload next to api/, or sibling php-backend when deployed from public/api. */
function offerLetterAutoloadPath(): ?string {
    $candidates = [
        __DIR__ . '/../vendor/autoload.php',                    // public/vendor (Hostinger public_html/vendor)
        __DIR__ . '/../../vendor/autoload.php',                 // site-root/vendor
        __DIR__ . '/../../php-backend/vendor/autoload.php',
        __DIR__ . '/../../../php-backend/vendor/autoload.php',
    ];
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    return null;
}

/**
 * @return array{ok:bool,error?:string}
 */
function offerLetterRenderHtmlToPdf(string $html, string $destAbsPath): array {
    $dir = dirname($destAbsPath);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Cannot create storage/offer_letters — check folder permissions'];
    }
    if (!is_writable($dir)) {
        return ['ok' => false, 'error' => 'storage/offer_letters is not writable'];
    }

    $autoload = offerLetterAutoloadPath();
    if ($autoload === null) {
        return [
            'ok' => false,
            'error' => 'Dompdf not installed. On Hostinger SSH run: cd php-backend && sh install-vendor.sh — or send pdf_base64 from the browser.',
        ];
    }
    require_once $autoload;
    if (!class_exists(\Dompdf\Dompdf::class)) {
        return [
            'ok' => false,
            'error' => 'Dompdf package missing in vendor/. Run composer install in php-backend and upload vendor/, or send pdf_base64 from the browser.',
        ];
    }
    try {
        $options = new \Dompdf\Options();
        $options->set('isRemoteEnabled', true);
        $options->set('isHtml5ParserEnabled', true);
        $base = realpath(__DIR__ . '/../');
        if (is_string($base) && $base !== '') {
            $options->setChroot($base);
        }
        $dompdf = new \Dompdf\Dompdf($options);
        $wrapped = $html;
        if (stripos($html, '<html') === false) {
            $wrapped = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family: DejaVu Sans, sans-serif; font-size: 12px;}</style></head><body>'
                . $html . '</body></html>';
        }
        $dompdf->loadHtml($wrapped, 'UTF-8');
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();
        $out = $dompdf->output();
        if ($out === false || $out === '') {
            return ['ok' => false, 'error' => 'Dompdf produced an empty PDF'];
        }
        if (@file_put_contents($destAbsPath, $out) === false) {
            return ['ok' => false, 'error' => 'Could not write PDF file to storage'];
        }
        return ['ok' => true];
    } catch (Throwable $e) {
        error_log('offerLetterRenderHtmlToPdf: ' . $e->getMessage());
        return ['ok' => false, 'error' => 'PDF render failed: ' . $e->getMessage()];
    }
}

/**
 * Persist a client-generated PDF (base64, with or without data-URL prefix).
 *
 * @return array{ok:bool,error?:string}
 */
function offerLetterPersistPdfBase64(string $raw, string $destAbsPath): array {
    $raw = trim($raw);
    if (str_starts_with($raw, 'data:')) {
        $comma = strpos($raw, ',');
        if ($comma === false) {
            return ['ok' => false, 'error' => 'Invalid pdf_base64 data URL'];
        }
        $raw = substr($raw, $comma + 1);
    }
    $bin = base64_decode($raw, true);
    if ($bin === false || strlen($bin) < 100) {
        return ['ok' => false, 'error' => 'Invalid pdf_base64'];
    }
    // Basic PDF magic
    if (strncmp($bin, '%PDF', 4) !== 0) {
        return ['ok' => false, 'error' => 'pdf_base64 is not a PDF'];
    }
    $dir = dirname($destAbsPath);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Cannot create storage/offer_letters'];
    }
    if (@file_put_contents($destAbsPath, $bin) === false) {
        return ['ok' => false, 'error' => 'Could not write PDF file to storage'];
    }
    return ['ok' => true];
}

$actionGet = $_GET['action'] ?? '';

// GET — stream stored PDF (same auth as list; JS uses fetch + Bearer token)
if ($method === 'GET' && $actionGet === 'pdf') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'hr']);
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $org = orgFilter($tokenData, 'ols');
    $params = array_merge([$id], $org['params']);
    $stmt = $db->prepare("SELECT ols.id FROM offer_letters_sent ols WHERE ols.id = ? AND {$org['where']} LIMIT 1");
    $stmt->execute($params);
    if (!$stmt->fetch()) {
        respond(['error' => 'Not found'], 404);
    }
    $path = offerLetterPdfFilePath($id);
    if (!is_file($path)) {
        respond(['error' => 'PDF not found on server'], 404);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="offer-letter-' . preg_replace('/[^a-z0-9_-]/i', '_', $id) . '.pdf"');
    readfile($path);
    exit;
}

// GET - List templates and sent letters
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'templates';

    if ($action === 'templates') {
        requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org', 'hr']);
        $org = offerLetterTemplateOrgFilter($tokenData, 't');
        $stmt = $db->prepare("SELECT t.* FROM offer_letter_templates t WHERE {$org['where']} ORDER BY t.created_at DESC");
        $stmt->execute($org['params']);
        respond(['data' => $stmt->fetchAll()]);
    }

    if ($action === 'sent') {
        $org = orgFilter($tokenData, 'ols');
        $stmt = $db->prepare("
            SELECT ols.*, olt.template_name 
            FROM offer_letters_sent ols 
            LEFT JOIN offer_letter_templates olt ON ols.template_id = olt.id 
            WHERE {$org['where']}
            ORDER BY ols.sent_at DESC LIMIT 500
        ");
        $stmt->execute($org['params']);
        respond(['data' => $stmt->fetchAll()]);
    }

    if ($action === 'template' && !empty($_GET['id'])) {
        requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org', 'hr']);
        $template = offerLettersFetchTemplateInScope($db, $tokenData, (string) $_GET['id']);
        if (!$template) {
            respond(['error' => 'Template not found'], 404);
        }
        respond(['data' => $template]);
    }

    respond(['error' => 'Invalid action'], 400);
}

// POST - Create template or send letter
if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'hr']);
    $input = getInput();
    $action = $_GET['action'] ?? 'create_template';

    if ($action === 'create_template') {
        $id = generateUUID();
        $orgId = getOrgId($tokenData);
        if (($orgId === null || trim((string) $orgId) === '')
            && syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
            $syncOrgStmt = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
            $orgId = $syncOrgStmt ? ($syncOrgStmt->fetchColumn() ?: null) : null;
        }
        $status = $input['status'] ?? 'active';
        $name = trim($input['template_name'] ?? '') ?: 'Untitled Template';
        $roleTitle = trim($input['role_title'] ?? '');
        $html = (string)($input['html_content'] ?? '');
        try {
            $stmt = $db->prepare("INSERT INTO offer_letter_templates (id, template_name, role_title, html_content, status, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$id, $name, $roleTitle, $html, $status, $userId, $orgId]);
        } catch (Exception $e) {
            try {
                $stmt = $db->prepare("INSERT INTO offer_letter_templates (id, template_name, role_title, html_content, status, created_by) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute([$id, $name, $roleTitle, $html, $status, $userId]);
            } catch (Exception $e2) {
                respond(['error' => 'Could not save template: ' . $e2->getMessage()], 500);
            }
        }
        respond(['id' => $id, 'message' => 'Template created'], 201);
    }

    if ($action === 'send') {
        $id = generateUUID();
        $orgId = getOrgId($tokenData);
        if (($orgId === null || trim((string) $orgId) === '')
            && syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
            $syncOrgStmt = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
            $orgId = $syncOrgStmt ? ($syncOrgStmt->fetchColumn() ?: null) : null;
        }
        $templateId = trim((string) ($input['template_id'] ?? ''));
        if ($templateId !== '') {
            $tpl = offerLettersFetchTemplateInScope($db, $tokenData, $templateId);
            if (!$tpl) {
                respond(['error' => 'Template not found in your organization'], 404);
            }
        }
        $html = (string)($input['html_content'] ?? '');
        $recipientEmail = trim((string)($input['recipient_email'] ?? ''));
        if ($recipientEmail === '' || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
            respond(['error' => 'Valid recipient email is required'], 400);
        }

        $pdfPath = offerLetterPdfFilePath($id);
        $pdfBase64 = trim((string) ($input['pdf_base64'] ?? $input['pdfBase64'] ?? ''));
        if ($pdfBase64 !== '') {
            $persist = offerLetterPersistPdfBase64($pdfBase64, $pdfPath);
            if (empty($persist['ok'])) {
                respond(['error' => $persist['error'] ?? 'Could not save offer letter PDF'], 500);
            }
        } else {
            $rendered = offerLetterRenderHtmlToPdf($html, $pdfPath);
            if (empty($rendered['ok'])) {
                respond([
                    'error' => $rendered['error'] ?? 'Could not generate offer letter PDF',
                    'hint' => 'Upload php-backend/vendor (run install-vendor.sh) or retry — the app can send a browser-generated PDF.',
                ], 500);
            }
        }
        $pdfUrl = offerLetterPublicPdfUrl($id);

        $recipientName = trim((string)($input['recipient_name'] ?? 'Candidate'));
        $roleTitle = trim((string)($input['role_title'] ?? ''));
        $emailSubject = trim((string)($input['email_subject'] ?? ''));
        if ($emailSubject === '') {
            $emailSubject = 'Offer Letter' . ($roleTitle !== '' ? ' — ' . $roleTitle : '');
        }
        $emailHtml = trim((string)($input['email_html'] ?? ''));
        if ($emailHtml === '') {
            $emailHtml = '<p>Dear ' . htmlspecialchars($recipientName, ENT_QUOTES, 'UTF-8')
                . ',</p><p>Please find your offer letter attached as a PDF.</p>'
                . '<p>Regards,<br>Syncpedia HR</p>';
        }
        $safeName = preg_replace('/[^A-Za-z0-9_-]/', '_', $recipientName);
        $attachName = trim((string)($input['attachment_name'] ?? ''));
        if ($attachName === '') {
            $attachName = 'Offer_Letter_' . $safeName . '.pdf';
        }

        $cc = trim((string)($input['cc'] ?? ''));
        $bcc = trim((string)($input['bcc'] ?? ''));

        syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'offer_letters');
        $mail = syncpediaSendHrHtmlEmail(
            $recipientEmail,
            $emailSubject,
            $emailHtml,
            [['path' => $pdfPath, 'name' => $attachName]],
            '',
            $cc,
            $bcc,
        );
        if (empty($mail['ok'])) {
            @unlink($pdfPath);
            respond(['error' => $mail['error'] ?? 'Could not send offer letter email'], 500);
        }

        // SMTP (especially Google) can take long enough for shared-hosting MySQL to
        // close the connection opened at request bootstrap. Reconnect only after
        // the mail operation so the sent-letter insert uses a live connection.
        try {
            $db = syncpediaCreatePdo();
        } catch (Throwable $e) {
            error_log('offer_letters reconnect after email: ' . $e->getMessage());
            respond([
                'id' => $id,
                'message' => 'Offer letter emailed, but the sent record could not be saved',
                'email_sent' => true,
                'record_saved' => false,
                'warning' => 'Database connection failed after email delivery. Do not resend; refresh Sent Letters later.',
                'from' => (string)($mail['from'] ?? syncpediaHrMailAddress()),
                'to' => $recipientEmail,
            ], 201);
        }

        try {
            $stmt = $db->prepare("INSERT INTO offer_letters_sent (id, template_id, recipient_name, recipient_email, role_title, html_content, pdf_url, status, sent_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $id,
                $input['template_id'] ?? null,
                $input['recipient_name'],
                $input['recipient_email'],
                $input['role_title'] ?? '',
                $html,
                $pdfUrl,
                $input['status'] ?? 'sent',
                $userId,
                $orgId,
            ]);
        } catch (Throwable $e) {
            $isMissingOrgColumn = stripos($e->getMessage(), 'unknown column') !== false
                && stripos($e->getMessage(), 'org_id') !== false;
            if ($isMissingOrgColumn) {
                try {
                    $db = syncpediaCreatePdo();
                    $stmt = $db->prepare("INSERT INTO offer_letters_sent (id, template_id, recipient_name, recipient_email, role_title, html_content, pdf_url, status, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    $stmt->execute([
                        $id,
                        $input['template_id'] ?? null,
                        $input['recipient_name'],
                        $input['recipient_email'],
                        $input['role_title'] ?? '',
                        $html,
                        $pdfUrl,
                        $input['status'] ?? 'sent',
                        $userId,
                    ]);
                } catch (Throwable $fallbackError) {
                    error_log('offer_letters sent record fallback: ' . $fallbackError->getMessage());
                    respond([
                        'id' => $id,
                        'message' => 'Offer letter emailed, but the sent record could not be saved',
                        'email_sent' => true,
                        'record_saved' => false,
                        'warning' => 'The email was accepted by SMTP. Do not resend it.',
                        'from' => (string)($mail['from'] ?? syncpediaHrMailAddress()),
                        'to' => $recipientEmail,
                    ], 201);
                }
            } else {
                error_log('offer_letters sent record insert: ' . $e->getMessage());
                respond([
                    'id' => $id,
                    'message' => 'Offer letter emailed, but the sent record could not be saved',
                    'email_sent' => true,
                    'record_saved' => false,
                    'warning' => 'The email was accepted by SMTP. Do not resend it.',
                    'from' => (string)($mail['from'] ?? syncpediaHrMailAddress()),
                    'to' => $recipientEmail,
                ], 201);
            }
        }
        try {
            $db->prepare('UPDATE offer_letters_sent SET pdf_path = ? WHERE id = ?')->execute([$pdfPath, $id]);
        } catch (Throwable $e) {
            error_log('offer_letters pdf_path update: ' . $e->getMessage());
        }
        respond([
            'id' => $id,
            'message' => 'Offer letter sent',
            'pdf_url' => $pdfUrl,
            'pdf_path' => $pdfPath,
            'email_sent' => true,
            'from' => (string)($mail['from'] ?? syncpediaHrMailAddress()),
            'to' => $recipientEmail,
        ], 201);
    }

    if ($action === 'bulk_send') {
        respond([
            'error' => 'bulk_send is retired. Use action=send for each letter so email is actually delivered.',
        ], 410);
    }

    respond(['error' => 'Invalid action'], 400);
}

// PUT - Update template
if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    if (!offerLettersFetchTemplateInScope($db, $tokenData, $id)) {
        respond(['error' => 'Template not found'], 404);
    }

    $input = getInput();
    $fields = [];
    $params = [];

    foreach (['template_name', 'role_title', 'html_content', 'status'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);

    $params[] = $id;
    $stmt = $db->prepare("UPDATE offer_letter_templates SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Template updated']);
}

// DELETE - Delete template or sent letter
if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);

    $action = $_GET['action'] ?? 'template';

    if ($action === 'sent') {
        @unlink(offerLetterPdfFilePath($id));
        $org = orgFilter($tokenData, 'ols');
        $params = array_merge([$id], $org['params']);
        $stmt = $db->prepare("DELETE FROM offer_letters_sent ols WHERE ols.id = ? AND {$org['where']}");
        $stmt->execute($params);
    } else {
        if (!offerLettersFetchTemplateInScope($db, $tokenData, $id)) {
            respond(['error' => 'Template not found'], 404);
        }
        $stmt = $db->prepare("DELETE FROM offer_letter_templates WHERE id = ?");
        $stmt->execute([$id]);
    }
    respond(['message' => 'Deleted successfully']);
}

respond(['error' => 'Method not allowed'], 405);
