<?php
/**
 * Public certificate verification — no authentication required.
 * GET /api/public-certificate-verify.php?id=CERT_ID&token=VERIFY_TOKEN
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cert_ids.php';
cors();

$db = (new Database())->getConnection();
$certId = trim((string) ($_GET['id'] ?? ''));
$token = trim((string) ($_GET['token'] ?? ''));

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
    'overrides' => [
        'recipientName' => $row['recipient_name'],
        'domainName' => $row['course_name'],
    ],
]);
