<?php
/**
 * Public certificate verification — no authentication required.
 * GET /api/public-certificate-verify.php?id=CERT_ID&token=VERIFY_TOKEN
 * GET ...&format=pdf  → stream the issued PDF (same file as email attachment)
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cert_ids.php';
require_once __DIR__ . '/document_storage.php';
cors();

$db = (new Database())->getConnection();
$certId = trim((string) ($_GET['id'] ?? ''));
$token = trim((string) ($_GET['token'] ?? ''));
$format = strtolower(trim((string) ($_GET['format'] ?? '')));

if ($certId === '' || $token === '') {
    respond(['verified' => false, 'error' => 'Certificate id and verification token are required'], 400);
}

if (!syncpediaColumnExists($db, 'issued_certificates', 'verify_token')) {
    respond(['verified' => false, 'error' => 'Verification not available'], 404);
}

$stmt = $db->prepare(
    'SELECT id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, verify_token
     FROM issued_certificates WHERE id = ? LIMIT 1',
);
$stmt->execute([$certId]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row || ($row['status'] ?? '') !== 'issued') {
    respond(['verified' => false, 'error' => 'Certificate not found'], 404);
}

$stored = (string) ($row['verify_token'] ?? '');
if ($stored === '' || !hash_equals($stored, $token)) {
    respond(['verified' => false, 'error' => 'Invalid verification token'], 403);
}

/**
 * Resolve issued PDF artifact for this cert id (token already validated on issued_certificates).
 * @return array{pdf_path:?string,gcs_object:?string}|null
 */
$resolveArtifact = static function (PDO $db, string $syncId, string $verifyToken): ?array {
    try {
        $hasGcs = syncpediaColumnExists($db, 'certificate_issue_artifacts', 'gcs_object');
        $cols = $hasGcs ? 'pdf_path, gcs_object, verify_token' : 'pdf_path, verify_token';
        // Prefer artifact whose verify_token matches; else latest for this sync_id.
        $q = $db->prepare(
            "SELECT {$cols} FROM certificate_issue_artifacts
             WHERE sync_id = ?
             ORDER BY
               CASE WHEN verify_token IS NOT NULL AND verify_token = ? THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1",
        );
        $q->execute([$syncId, $verifyToken]);
        $art = $q->fetch(PDO::FETCH_ASSOC);
        if (!$art) {
            return null;
        }
        return [
            'pdf_path' => trim((string) ($art['pdf_path'] ?? '')),
            'gcs_object' => $hasGcs ? trim((string) ($art['gcs_object'] ?? '')) : '',
        ];
    } catch (Throwable $e) {
        error_log('[public-certificate-verify] artifact lookup: ' . $e->getMessage());
        return null;
    }
};

$artifact = $resolveArtifact($db, $certId, $token);
$pdfPath = is_array($artifact) ? (string) ($artifact['pdf_path'] ?? '') : '';
$gcsObject = is_array($artifact) ? (string) ($artifact['gcs_object'] ?? '') : '';
$hasPdf = ($pdfPath !== '' && syncpediaDocumentStorageFileExists($pdfPath))
    || ($gcsObject !== '');

if ($format === 'pdf') {
    if (!$hasPdf) {
        respond(['error' => 'PDF not found'], 404);
    }
    $downloadName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $certId) . '.pdf';
    if ($pdfPath !== '' && syncpediaDocumentStorageFileExists($pdfPath)) {
        syncpediaDocumentStorageStreamPdf($pdfPath, $downloadName);
    }
    syncpediaDocumentStorageStreamLocalOrGcs(
        $pdfPath !== '' ? $pdfPath : null,
        $gcsObject !== '' ? $gcsObject : null,
        $downloadName,
    );
}

$template = null;
$tplId = trim((string) ($row['template_id'] ?? ''));
if ($tplId !== '') {
    $tstmt = $db->prepare(
        'SELECT id, name, status, cert_type, layout_style, bg_color, accent_color, style_json, fields_json, layers_json, created_at
         FROM certificate_templates WHERE id = ? LIMIT 1',
    );
    $tstmt->execute([$tplId]);
    $tpl = $tstmt->fetch(PDO::FETCH_ASSOC);
    if ($tpl) {
        $styleJson = syncpediaDecodeAssocJson($tpl['style_json'] ?? null);
        $fieldsJson = syncpediaDecodeAssocJson($tpl['fields_json'] ?? null);
        $layersJson = syncpediaDecodeAssocJson($tpl['layers_json'] ?? null);
        $template = [
            'id' => (string) $tpl['id'],
            'name' => (string) $tpl['name'],
            'status' => (string) ($tpl['status'] ?? 'active'),
            'createdAt' => substr((string) ($tpl['created_at'] ?? date('Y-m-d')), 0, 10),
            'certType' => certNormalizeType($tpl['cert_type'] ?? 'CC'),
            'style' => array_merge([
                'layout' => (string) ($tpl['layout_style'] ?? 'classic'),
                'bgColor' => (string) ($tpl['bg_color'] ?? '#ffffff'),
                'accentColor' => (string) ($tpl['accent_color'] ?? '#1A6B3C'),
            ], $styleJson),
            'fields' => $fieldsJson,
            'layers' => $layersJson,
        ];
    }
}

respond([
    'verified' => true,
    'certId' => $row['id'],
    'recipientName' => $row['recipient_name'],
    'courseName' => $row['course_name'],
    'certType' => certNormalizeType($row['cert_type'] ?? 'CC'),
    'issueDate' => $row['issue_date'],
    'templateName' => $row['template_name'],
    'template' => $template,
    'hasPdf' => $hasPdf,
    'overrides' => [
        'recipientName' => $row['recipient_name'],
        'domainName' => $row['course_name'],
    ],
]);
