<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = (string) ($_GET['action'] ?? '');
$userId = $tokenData['user_id'] ?? null;
$orgId = getOrgId($tokenData);

function certEnsureTables(PDO $db): void {
    static $done = false;
    if ($done) return;

    $db->exec("
        CREATE TABLE IF NOT EXISTS `certificate_issue_artifacts` (
          `id` CHAR(36) NOT NULL,
          `recipient_id` CHAR(36) DEFAULT NULL,
          `template_id` CHAR(36) DEFAULT NULL,
          `sync_id` VARCHAR(80) NOT NULL,
          `student_name` VARCHAR(255) DEFAULT NULL,
          `student_email` VARCHAR(255) DEFAULT NULL,
          `course_name` VARCHAR(255) DEFAULT NULL,
          `issue_date` DATE DEFAULT NULL,
          `verify_token` LONGTEXT DEFAULT NULL,
          `pdf_path` TEXT DEFAULT NULL,
          `org_id` CHAR(36) DEFAULT NULL,
          `issued_by` CHAR(36) DEFAULT NULL,
          `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          UNIQUE KEY `uq_cert_artifact_sync` (`sync_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS `certificate_email_logs` (
          `id` CHAR(36) NOT NULL,
          `certificate_id` VARCHAR(80) NOT NULL,
          `to_email` VARCHAR(255) NOT NULL,
          `cc_email` TEXT DEFAULT NULL,
          `bcc_email` TEXT DEFAULT NULL,
          `subject` TEXT NOT NULL,
          `body` LONGTEXT NOT NULL,
          `attachment_url` TEXT DEFAULT NULL,
          `message_id` VARCHAR(120) DEFAULT NULL,
          `sent_at` DATETIME DEFAULT NULL,
          `org_id` CHAR(36) DEFAULT NULL,
          `sent_by` CHAR(36) DEFAULT NULL,
          `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `idx_cert_email_logs_certificate` (`certificate_id`),
          KEY `idx_cert_email_logs_org` (`org_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $done = true;
}

function certStorageDir(): string {
    $dir = realpath(__DIR__ . '/../');
    if (!is_string($dir) || $dir === '') {
        $dir = __DIR__ . '/../';
    }
    $target = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'certificates';
    if (!is_dir($target)) {
        @mkdir($target, 0777, true);
    }
    return $target;
}

function certBuildSimplePdf(string $title, string $line1, string $line2): string {
    $safe = static function (string $v): string {
        return str_replace(['\\', '(', ')'], ['\\\\', '\(', '\)'], $v);
    };
    $t = $safe($title);
    $l1 = $safe($line1);
    $l2 = $safe($line2);
    $content = "BT /F1 20 Tf 72 760 Td ($t) Tj ET\nBT /F1 13 Tf 72 730 Td ($l1) Tj ET\nBT /F1 13 Tf 72 708 Td ($l2) Tj ET\n";
    $len = strlen($content);
    $pdf = "%PDF-1.4\n";
    $offsets = [];
    $offsets[] = strlen($pdf);
    $pdf .= "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n";
    $offsets[] = strlen($pdf);
    $pdf .= "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n";
    $offsets[] = strlen($pdf);
    $pdf .= "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n";
    $offsets[] = strlen($pdf);
    $pdf .= "4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n";
    $offsets[] = strlen($pdf);
    $pdf .= "5 0 obj<< /Length $len >>stream\n$content" . "endstream\nendobj\n";
    $xref = strlen($pdf);
    $pdf .= "xref\n0 6\n0000000000 65535 f \n";
    foreach ($offsets as $o) {
        $pdf .= sprintf("%010d 00000 n \n", $o);
    }
    $pdf .= "trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF";
    return $pdf;
}

certEnsureTables($db);

if ($method === 'GET' && $action === 'email_logs') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $certificateId = trim((string) ($_GET['certificate_id'] ?? ''));
    $where = '1=1';
    $params = [];
    if ($certificateId !== '') {
        $where .= ' AND certificate_id = ?';
        $params[] = $certificateId;
    }
    if ($orgId) {
        $where .= ' AND (org_id = ? OR org_id IS NULL)';
        $params[] = $orgId;
    }
    $stmt = $db->prepare("SELECT * FROM certificate_email_logs WHERE $where ORDER BY created_at DESC LIMIT 100");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'GET' && $action === 'pdf') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $certificateId = trim((string) ($_GET['certificate_id'] ?? ''));
    if ($certificateId === '') respond(['error' => 'certificate_id required'], 400);
    $params = [$certificateId];
    $where = 'sync_id = ?';
    if ($orgId) {
        $where .= ' AND (org_id = ? OR org_id IS NULL)';
        $params[] = $orgId;
    }
    $stmt = $db->prepare("SELECT * FROM certificate_issue_artifacts WHERE $where ORDER BY created_at DESC LIMIT 1");
    $stmt->execute($params);
    $row = $stmt->fetch();
    if (!$row || empty($row['pdf_path']) || !is_file((string) $row['pdf_path'])) {
        respond(['error' => 'PDF not found'], 404);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . basename((string) $row['pdf_path']) . '"');
    readfile((string) $row['pdf_path']);
    exit;
}

if ($method === 'POST' && $action === 'issue') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $recipientId = trim((string) ($input['recipientId'] ?? ''));
    $templateId = trim((string) ($input['templateId'] ?? ''));
    $syncId = trim((string) ($input['syncId'] ?? ''));
    if ($recipientId === '' || $templateId === '' || $syncId === '') {
        respond(['error' => 'recipientId, templateId and syncId are required'], 400);
    }

    $studentName = trim((string) ($input['recipientName'] ?? ''));
    $studentEmail = trim((string) ($input['recipientEmail'] ?? ''));
    if ($studentName === '' || $studentEmail === '') {
        $sp = [$recipientId];
        $sw = 'id = ?';
        if ($orgId) {
            $sw .= ' AND (org_id = ? OR org_id IS NULL)';
            $sp[] = $orgId;
        }
        $s = $db->prepare("SELECT id, name, email FROM students WHERE $sw LIMIT 1");
        $s->execute($sp);
        $row = $s->fetch();
        if ($row) {
            if ($studentName === '') $studentName = trim((string) ($row['name'] ?? ''));
            if ($studentEmail === '') $studentEmail = trim((string) ($row['email'] ?? ''));
        }
    }
    if ($studentName === '' || $studentEmail === '') {
        respond(['error' => 'Student details not found'], 404);
    }

    $courseName = trim((string) ($input['courseName'] ?? ''));
    $issueDate = trim((string) ($input['issueDate'] ?? date('Y-m-d')));
    $verifyToken = isset($input['verifyToken']) ? (string) $input['verifyToken'] : null;

    $pdfName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $studentName) . '_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';
    $pdfPath = certStorageDir() . DIRECTORY_SEPARATOR . $pdfName;
    $pdf = certBuildSimplePdf('Certificate Issued', "Student: $studentName", "SYNC ID: $syncId");
    if (@file_put_contents($pdfPath, $pdf) === false) {
        respond(['error' => 'Unable to generate certificate PDF'], 500);
    }

    $artifactId = generateUUID();
    $ins = $db->prepare("
        INSERT INTO certificate_issue_artifacts
        (id, recipient_id, template_id, sync_id, student_name, student_email, course_name, issue_date, verify_token, pdf_path, org_id, issued_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          student_name = VALUES(student_name),
          student_email = VALUES(student_email),
          course_name = VALUES(course_name),
          issue_date = VALUES(issue_date),
          verify_token = VALUES(verify_token),
          pdf_path = VALUES(pdf_path),
          org_id = VALUES(org_id),
          issued_by = VALUES(issued_by)
    ");
    $ins->execute([$artifactId, $recipientId, $templateId, $syncId, $studentName, $studentEmail, $courseName, $issueDate, $verifyToken, $pdfPath, $orgId, $userId]);

    $pdfUrl = '/api/certificates.php?action=pdf&certificate_id=' . rawurlencode($syncId);
    respond([
        'certificateId' => $syncId,
        'pdfUrl' => $pdfUrl,
        'syncId' => $syncId,
        'studentName' => $studentName,
        'studentEmail' => $studentEmail,
    ]);
}

if ($method === 'POST' && $action === 'send_email') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $certificateId = trim((string) ($input['certificateId'] ?? ''));
    $to = trim((string) ($input['to'] ?? ''));
    $subject = trim((string) ($input['subject'] ?? ''));
    $body = trim((string) ($input['body'] ?? ''));
    $attachmentUrl = trim((string) ($input['attachmentUrl'] ?? ''));
    $attachmentName = trim((string) ($input['attachmentName'] ?? ''));
    if ($certificateId === '' || $to === '' || $subject === '' || $body === '') {
        respond(['error' => 'certificateId, to, subject and body are required'], 400);
    }
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'Invalid TO email address'], 400);
    }

    $lookupParams = [$certificateId];
    $lookupWhere = 'sync_id = ?';
    if ($orgId) {
        $lookupWhere .= ' AND (org_id = ? OR org_id IS NULL)';
        $lookupParams[] = $orgId;
    }
    $artifactStmt = $db->prepare("SELECT pdf_path, student_name, sync_id FROM certificate_issue_artifacts WHERE $lookupWhere ORDER BY created_at DESC LIMIT 1");
    $artifactStmt->execute($lookupParams);
    $artifact = $artifactStmt->fetch(PDO::FETCH_ASSOC);
    if (!$artifact) {
        respond(['error' => 'Certificate not found'], 404);
    }

    $pdfPath = trim((string) ($artifact['pdf_path'] ?? ''));
    if ($pdfPath === '' || !is_file($pdfPath)) {
        respond(['error' => 'Certificate PDF not found on server'], 404);
    }

    $studentName = trim((string) ($artifact['student_name'] ?? 'Student'));
    $syncId = trim((string) ($artifact['sync_id'] ?? $certificateId));
    if ($attachmentName === '') {
        $attachmentName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $studentName) . '_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';
    }

    $cc = trim((string) ($input['cc'] ?? ''));
    $bcc = trim((string) ($input['bcc'] ?? ''));
    $send = syncpediaSendCertificateEmail(
        $to,
        $subject,
        $body,
        $cc,
        $bcc,
        [['path' => $pdfPath, 'name' => $attachmentName]],
    );
    if (empty($send['ok'])) {
        respond(['error' => $send['error'] ?? 'Unable to send certificate email'], 500);
    }

    $fromAddr = (string) ($send['from'] ?? syncpediaSupportMailAddress());
    $messageId = 'mail_' . uniqid('', true);
    $sentAt = date('Y-m-d H:i:s');
    $logId = generateUUID();
    $stmt = $db->prepare("
        INSERT INTO certificate_email_logs
        (id, certificate_id, to_email, cc_email, bcc_email, subject, body, attachment_url, message_id, sent_at, org_id, sent_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $logId,
        $certificateId,
        $to,
        $cc,
        $bcc,
        $subject,
        $body,
        $attachmentUrl !== '' ? $attachmentUrl : '/api/certificates.php?action=pdf&certificate_id=' . rawurlencode($syncId),
        $messageId,
        $sentAt,
        $orgId,
        $userId,
    ]);

    respond([
        'success' => true,
        'messageId' => $messageId,
        'sentAt' => $sentAt,
        'from' => $fromAddr,
    ]);
}

respond(['error' => 'Method not allowed'], 405);
