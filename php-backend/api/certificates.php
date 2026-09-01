<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/document_storage.php';
require_once __DIR__ . '/cert_ids.php';
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

    $db->exec("
        CREATE TABLE IF NOT EXISTS certificate_email_logs (
          id CHAR(36) NOT NULL,
          certificate_id VARCHAR(80) NOT NULL,
          to_email VARCHAR(255) NOT NULL,
          cc_email TEXT DEFAULT NULL,
          bcc_email TEXT DEFAULT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          attachment_url TEXT DEFAULT NULL,
          message_id VARCHAR(120) DEFAULT NULL,
          sent_at TIMESTAMP DEFAULT NULL,
          org_id CHAR(36) DEFAULT NULL,
          sent_by CHAR(36) DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        )
    ");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_cert_email_logs_certificate ON certificate_email_logs (certificate_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_cert_email_logs_org ON certificate_email_logs (org_id)');
    syncpediaDocumentEnsureColumn($db, 'certificate_issue_artifacts', 'gcs_object', 'TEXT DEFAULT NULL');

    $done = true;
}

function certStorageDir(): string {
    return syncpediaDocumentStorageDir('certificates');
}

function certDecodePdfBase64(string $raw): ?string {
    $decoded = syncpediaDecodePdfBase64($raw);
    return (!empty($decoded['ok']) && isset($decoded['bytes'])) ? (string) $decoded['bytes'] : null;
}

certEnsureTables($db);
certEnsureTypeColumns($db);
certEnsureOrgPrefixColumn($db);

if ($method === 'GET' && $action === 'email_logs') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $certificateId = trim((string) ($_GET['certificate_id'] ?? ''));
    $org = orgFilter($tokenData, 'cel', $db);
    $where = $org['where'];
    $params = $org['params'];
    if ($certificateId !== '') {
        $where .= ' AND cel.certificate_id = ?';
        $params[] = $certificateId;
    }
    $stmt = $db->prepare("SELECT cel.* FROM certificate_email_logs cel WHERE $where ORDER BY cel.created_at DESC LIMIT 100");
    $stmt->execute($params);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'GET' && $action === 'pdf') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $certificateId = trim((string) ($_GET['certificate_id'] ?? ''));
    if ($certificateId === '') respond(['error' => 'certificate_id required'], 400);
    $org = orgFilter($tokenData, 'cia', $db);
    $params = array_merge([$certificateId], $org['params']);
    $stmt = $db->prepare("SELECT cia.* FROM certificate_issue_artifacts cia WHERE cia.sync_id = ? AND {$org['where']} ORDER BY cia.created_at DESC LIMIT 1");
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'PDF not found'], 404);
    }
    $downloadName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($row['sync_id'] ?? $certificateId)) . '.pdf';
    $localPath = trim((string) ($row['pdf_path'] ?? ''));
    $gcsObject = isset($row['gcs_object']) ? trim((string) $row['gcs_object']) : '';
    if ($localPath !== '' && is_file($localPath)) {
        syncpediaDocumentStorageStreamPdf($localPath, $downloadName);
    }
    syncpediaDocumentStorageStreamLocalOrGcs($localPath !== '' ? $localPath : null, $gcsObject !== '' ? $gcsObject : null, $downloadName);
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
        $s = $db->prepare('SELECT s.* FROM students s WHERE s.id = ? LIMIT 1');
        $s->execute([$recipientId]);
        $row = $s->fetch(PDO::FETCH_ASSOC);
        if (is_array($row) && userCanAccessStudentRow($db, $tokenData, (string) $userId, (string) ($tokenData['role'] ?? ''), $row)) {
            if ($studentName === '') $studentName = trim((string) ($row['name'] ?? ''));
            if ($studentEmail === '') $studentEmail = trim((string) ($row['email'] ?? ''));
        }
    }
    if ($studentName === '' || $studentEmail === '') {
        respond(['error' => 'Student details not found'], 404);
    }

    $tplOrg = orgFilter($tokenData, 'ct', $db);
    $tplParams = array_merge([$templateId], $tplOrg['params']);
    $tplStmt = $db->prepare("SELECT ct.id, ct.cert_type FROM certificate_templates ct WHERE ct.id = ? AND {$tplOrg['where']} LIMIT 1");
    $tplStmt->execute($tplParams);
    $tplRow = $tplStmt->fetch(PDO::FETCH_ASSOC);
    if (!$tplRow) {
        respond(['error' => 'Certificate template not found in your organization'], 404);
    }
    $certType = certNormalizeType($tplRow['cert_type'] ?? 'CC');

    $writeOrgId = trim((string) resolveWriteOrgId($db, $tokenData));
    $prefix = $writeOrgId !== '' ? certGetOrgPrefix($db, $writeOrgId) : null;
    if ($prefix === null && $writeOrgId !== '') {
        $fromId = certNormalizePrefix(explode('-', strtoupper($syncId))[0] ?? '');
        $wanted = $fromId ?: certSuggestPrefix($db, $writeOrgId);
        $claimed = certClaimOrgPrefix($db, $writeOrgId, $wanted);
        if (empty($claimed['ok'])) {
            respond(['error' => $claimed['error'] ?? 'Certificate prefix is not available.'], 409);
        }
        $prefix = $claimed['prefix'];
    }
    if ($prefix === null || !certIsValidIssuedId($syncId, $prefix, $certType)) {
        respond(['error' => 'Certificate number must be PREFIX-TYPE-XXXXXX for this organization (e.g. SP-CS-482193)'], 400);
    }

    $courseName = trim((string) ($input['courseName'] ?? ''));
    $issueDate = trim((string) ($input['issueDate'] ?? date('Y-m-d')));
    $verifyToken = isset($input['verifyToken']) ? (string) $input['verifyToken'] : null;

    $pdfName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $studentName) . '_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';
    $pdfBase64 = trim((string) ($input['pdf_base64'] ?? $input['pdfBase64'] ?? ''));
    if ($pdfBase64 === '') {
        respond(['error' => 'pdf_base64 is required — generate the certificate PDF in the browser before issuing'], 400);
    }
    $pdfBytes = certDecodePdfBase64($pdfBase64);
    if ($pdfBytes === null) {
        respond(['error' => 'Invalid pdf_base64 — expected a real certificate PDF'], 400);
    }

    $gcsKey = function_exists('syncpediaGcsObjectKey')
        ? syncpediaGcsObjectKey(
            $writeOrgId !== null && $writeOrgId !== '' ? (string) $writeOrgId : null,
            'certificates',
            $syncId,
            $studentName
        )
        : '';
    $saved = syncpediaDocumentStorageSaveAndUpload('certificates', $pdfName, $pdfBytes, $gcsKey);
    if (empty($saved['ok'])) {
        respond(['error' => $saved['error'] ?? 'Unable to generate certificate PDF'], 500);
    }
    $pdfPathRel = (string) ($saved['local_path'] ?? '');
    $pdfPathAbs = isset($saved['local_abs']) && is_string($saved['local_abs'])
        ? $saved['local_abs']
        : (syncpediaDocumentStorageResolvePath($pdfPathRel) ?: (certStorageDir() . DIRECTORY_SEPARATOR . syncpediaDocumentSafeFilename($pdfName)));
    $gcsObject = isset($saved['gcs_object']) && is_string($saved['gcs_object']) ? $saved['gcs_object'] : null;

    $artifactId = generateUUID();
    $upsert = syncpediaUpsertClause(
        $db,
        '(sync_id)',
        [
            'student_name = EXCLUDED.student_name',
            'student_email = EXCLUDED.student_email',
            'course_name = EXCLUDED.course_name',
            'issue_date = EXCLUDED.issue_date',
            'verify_token = EXCLUDED.verify_token',
            'pdf_path = EXCLUDED.pdf_path',
            'gcs_object = EXCLUDED.gcs_object',
            'org_id = EXCLUDED.org_id',
            'issued_by = EXCLUDED.issued_by',
        ],
        [
            '`student_name` = VALUES(`student_name`)',
            '`student_email` = VALUES(`student_email`)',
            '`course_name` = VALUES(`course_name`)',
            '`issue_date` = VALUES(`issue_date`)',
            '`verify_token` = VALUES(`verify_token`)',
            '`pdf_path` = VALUES(`pdf_path`)',
            '`gcs_object` = VALUES(`gcs_object`)',
            '`org_id` = VALUES(`org_id`)',
            '`issued_by` = VALUES(`issued_by`)',
        ],
    );
    try {
        $ins = $db->prepare("
            INSERT INTO certificate_issue_artifacts
            (id, recipient_id, template_id, sync_id, student_name, student_email, course_name, issue_date, verify_token, pdf_path, gcs_object, org_id, issued_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            {$upsert}
        ");
        $ins->execute([$artifactId, $recipientId, $templateId, $syncId, $studentName, $studentEmail, $courseName, $issueDate, $verifyToken, $pdfPathRel, $gcsObject, $writeOrgId, $userId]);
    } catch (Throwable $e) {
        // Older DBs without gcs_object column
        $upsertLegacy = syncpediaUpsertClause(
            $db,
            '(sync_id)',
            [
                'student_name = EXCLUDED.student_name',
                'student_email = EXCLUDED.student_email',
                'course_name = EXCLUDED.course_name',
                'issue_date = EXCLUDED.issue_date',
                'verify_token = EXCLUDED.verify_token',
                'pdf_path = EXCLUDED.pdf_path',
                'org_id = EXCLUDED.org_id',
                'issued_by = EXCLUDED.issued_by',
            ],
            [
                '`student_name` = VALUES(`student_name`)',
                '`student_email` = VALUES(`student_email`)',
                '`course_name` = VALUES(`course_name`)',
                '`issue_date` = VALUES(`issue_date`)',
                '`verify_token` = VALUES(`verify_token`)',
                '`pdf_path` = VALUES(`pdf_path`)',
                '`org_id` = VALUES(`org_id`)',
                '`issued_by` = VALUES(`issued_by`)',
            ],
        );
        $ins = $db->prepare("
            INSERT INTO certificate_issue_artifacts
            (id, recipient_id, template_id, sync_id, student_name, student_email, course_name, issue_date, verify_token, pdf_path, org_id, issued_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            {$upsertLegacy}
        ");
        $ins->execute([$artifactId, $recipientId, $templateId, $syncId, $studentName, $studentEmail, $courseName, $issueDate, $verifyToken, $pdfPathRel, $writeOrgId, $userId]);
    }

    $pdfUrl = '/api/certificates.php?action=pdf&certificate_id=' . rawurlencode($syncId);
    respond([
        'certificateId' => $syncId,
        'pdfUrl' => $pdfUrl,
        'syncId' => $syncId,
        'studentName' => $studentName,
        'studentEmail' => $studentEmail,
        'storage' => [
            'local' => $pdfPathRel !== '',
            'gcs' => !empty($saved['gcs_uploaded']),
            'gcs_object' => $gcsObject,
            'gcs_error' => isset($saved['gcs_error']) ? $saved['gcs_error'] : null,
        ],
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

    $org = orgFilter($tokenData, 'cia', $db);
    $lookupParams = array_merge([$certificateId], $org['params']);
    $artifactStmt = $db->prepare("SELECT cia.pdf_path, cia.gcs_object, cia.student_name, cia.sync_id, cia.org_id FROM certificate_issue_artifacts cia WHERE cia.sync_id = ? AND {$org['where']} ORDER BY cia.created_at DESC LIMIT 1");
    $artifactStmt->execute($lookupParams);
    $artifact = $artifactStmt->fetch(PDO::FETCH_ASSOC);
    if (!$artifact) {
        respond(['error' => 'Certificate not found'], 404);
    }

    $pdfPath = trim((string) ($artifact['pdf_path'] ?? ''));
    $gcsObject = trim((string) ($artifact['gcs_object'] ?? ''));
    $attachPath = null;
    $tempDownloaded = false;

    $resolved = syncpediaDocumentStorageResolvePath($pdfPath);
    if (is_string($resolved) && is_file($resolved)) {
        $attachPath = $resolved;
    } elseif ($pdfPath !== '' && is_file($pdfPath)) {
        $attachPath = $pdfPath;
    } elseif ($gcsObject !== '' && function_exists('syncpediaGcsDownloadObject')) {
        $dl = syncpediaGcsDownloadObject($gcsObject);
        if (!empty($dl['ok']) && isset($dl['bytes']) && is_string($dl['bytes'])) {
            $tmp = certStorageDir() . DIRECTORY_SEPARATOR . 'mail_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $certificateId) . '.pdf';
            if (@file_put_contents($tmp, $dl['bytes']) !== false) {
                $attachPath = $tmp;
                $tempDownloaded = true;
            }
        }
    }
    if ($attachPath === null || !is_file($attachPath)) {
        respond(['error' => 'Certificate PDF not found on server'], 404);
    }

    $studentName = trim((string) ($artifact['student_name'] ?? 'Student'));
    $syncId = trim((string) ($artifact['sync_id'] ?? $certificateId));
    if ($attachmentName === '') {
        $attachmentName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $studentName) . '_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $syncId) . '.pdf';
    }

    $cc = trim((string) ($input['cc'] ?? ''));
    $bcc = trim((string) ($input['bcc'] ?? ''));
    $artifactOrgId = trim((string) ($artifact['org_id'] ?? ''));
    syncpediaSetMailContext($artifactOrgId !== '' ? $artifactOrgId : null, 'certificates');
    $send = syncpediaSendCertificateEmail(
        $to,
        $subject,
        $body,
        $cc,
        $bcc,
        [['path' => $attachPath, 'name' => $attachmentName]],
    );
    if (empty($send['ok'])) {
        if ($tempDownloaded && is_file($attachPath)) {
            @unlink($attachPath);
        }
        respond(['error' => $send['error'] ?? 'Unable to send certificate email'], 500);
    }

    // Free disk when GCS has the durable copy
    if ($gcsObject !== '') {
        syncpediaDocumentStorageDeleteLocal($pdfPath);
        if ($tempDownloaded && is_file($attachPath)) {
            @unlink($attachPath);
        }
    } elseif ($tempDownloaded && is_file($attachPath)) {
        @unlink($attachPath);
    }

    $fromAddr = (string) ($send['from'] ?? syncpediaSupportMailAddress());
    $messageId = 'mail_' . uniqid('', true);
    $sentAt = date('Y-m-d H:i:s');
    $logId = generateUUID();
    $logOrgId = resolveWriteOrgId($db, $tokenData);
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
        $logOrgId,
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
