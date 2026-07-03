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
        __DIR__ . '/../vendor/autoload.php',
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

function offerLetterRenderHtmlToPdf(string $html, string $destAbsPath): bool {
    $autoload = offerLetterAutoloadPath();
    if ($autoload === null) {
        return false;
    }
    require_once $autoload;
    if (!class_exists(\Dompdf\Dompdf::class)) {
        return false;
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
            return false;
        }
        return @file_put_contents($destAbsPath, $out) !== false;
    } catch (Throwable $e) {
        error_log('offerLetterRenderHtmlToPdf: ' . $e->getMessage());
        return false;
    }
}

$actionGet = $_GET['action'] ?? '';

// GET — stream stored PDF (same auth as list; JS uses fetch + Bearer token)
if ($method === 'GET' && $actionGet === 'pdf') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
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
        requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
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
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $action = $_GET['action'] ?? 'create_template';

    if ($action === 'create_template') {
        $id = generateUUID();
        $orgId = getOrgId($tokenData);
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
        if (!offerLetterRenderHtmlToPdf($html, $pdfPath)) {
            respond(['error' => 'Could not generate offer letter PDF'], 500);
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
        } catch (Exception $e) {
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
        $letters = $input['letters'] ?? [];
        if (empty($letters)) respond(['error' => 'No letters provided'], 400);

        $ids = [];
        $orgId = getOrgId($tokenData);
        foreach ($letters as $letter) {
            $id = generateUUID();
            $html = (string)($letter['html_content'] ?? '');
            $pdfUrl = null;
            if (offerLetterRenderHtmlToPdf($html, offerLetterPdfFilePath($id))) {
                $pdfUrl = offerLetterPublicPdfUrl($id);
            }
            try {
                $stmtWithOrg = $db->prepare("INSERT INTO offer_letters_sent (id, template_id, recipient_name, recipient_email, role_title, html_content, pdf_url, status, sent_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmtWithOrg->execute([
                    $id,
                    $letter['template_id'] ?? null,
                    $letter['recipient_name'],
                    $letter['recipient_email'],
                    $letter['role_title'] ?? '',
                    $html,
                    $pdfUrl,
                    $letter['status'] ?? 'sent',
                    $userId,
                    $orgId,
                ]);
            } catch (Exception $e) {
                $stmt = $db->prepare("INSERT INTO offer_letters_sent (id, template_id, recipient_name, recipient_email, role_title, html_content, pdf_url, status, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $id,
                    $letter['template_id'] ?? null,
                    $letter['recipient_name'],
                    $letter['recipient_email'],
                    $letter['role_title'] ?? '',
                    $html,
                    $pdfUrl,
                    $letter['status'] ?? 'sent',
                    $userId,
                ]);
            }
            $ids[] = $id;
        }
        respond(['ids' => $ids, 'message' => count($ids) . ' offer letters created'], 201);
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
