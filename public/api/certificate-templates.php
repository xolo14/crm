<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'] ?? null;

function certTemplatesEnsureColumns(PDO $db): void {
    static $done = false;
    if ($done) return;

    try {
        $chk = $db->query("SHOW COLUMNS FROM `certificate_templates` LIKE 'style_json'");
        if ($chk && !$chk->fetch()) {
            $db->exec("ALTER TABLE `certificate_templates` ADD COLUMN `style_json` JSON DEFAULT NULL AFTER `accent_color`");
        }
    } catch (Throwable $e) {
    }

    try {
        $chk = $db->query("SHOW COLUMNS FROM `certificate_templates` LIKE 'layers_json'");
        if ($chk && !$chk->fetch()) {
            $db->exec("ALTER TABLE `certificate_templates` ADD COLUMN `layers_json` JSON DEFAULT NULL AFTER `fields_json`");
        }
    } catch (Throwable $e) {
    }

    $done = true;
}

/** Reject huge base64 data URLs — large assets must use upload_asset first. */
function certTemplateRejectOversizedEmbeddedImages(array &$style, array &$fields, array &$layers): void {
    $maxInline = 400 * 1024;
    $check = static function (?string $value, string $label) use ($maxInline): void {
        if (!is_string($value) || !str_starts_with($value, 'data:')) {
            return;
        }
        if (strlen($value) > $maxInline) {
            respond([
                'error' => $label . ' is too large to embed in the template. Upload it using the Background image control (or asset upload), then save again.',
            ], 413);
        }
    };
    $check($style['bgImage'] ?? null, 'Background image');
    $check($style['bgPdf'] ?? null, 'Background PDF');
    foreach (['signatureImage', 'watermarkImage', 'logoLeftImage', 'logoRightImage'] as $fk) {
        $check($fields[$fk] ?? null, ucfirst($fk));
    }
    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $check($layer['content'] ?? null, 'Layer image');
    }
}

certTemplatesEnsureColumns($db);

$action = trim((string) ($_GET['action'] ?? ''));

if ($action === 'upload_asset' && $method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'multipart/form-data') === false) {
        respond(['error' => 'Expected multipart/form-data'], 400);
    }
    if (empty($_FILES['file'])) {
        respond(['error' => 'file is required'], 400);
    }
    $url = saveCertificateTemplateImageUpload($_FILES['file']);
    respond(['url' => $url, 'success' => true]);
}

if ($method === 'GET' && $action === '') {
    $org = orgFilter($tokenData);
    $stmt = $db->prepare("
        SELECT id, name, status, cert_type, layout_style, bg_color, accent_color, style_json, fields_json, layers_json, created_at
        FROM certificate_templates
        WHERE {$org['where']}
        ORDER BY created_at DESC
        LIMIT 1000
    ");
    $stmt->execute($org['params']);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $styleJson = [];
        $fieldsJson = [];
        $layersJson = [];
        if (!empty($r['style_json'])) {
            $tmp = json_decode((string)$r['style_json'], true);
            if (is_array($tmp)) $styleJson = $tmp;
        }
        if (!empty($r['fields_json'])) {
            $tmp = json_decode((string)$r['fields_json'], true);
            if (is_array($tmp)) $fieldsJson = $tmp;
        }
        if (!empty($r['layers_json'])) {
            $tmp = json_decode((string)$r['layers_json'], true);
            if (is_array($tmp)) $layersJson = $tmp;
        }

        $r['template'] = [
            'id' => (string)$r['id'],
            'name' => (string)$r['name'],
            'status' => (string)$r['status'],
            'createdAt' => substr((string)$r['created_at'], 0, 10),
            'certType' => (string)$r['cert_type'],
            'style' => array_merge([
                'layout' => (string)$r['layout_style'],
                'bgColor' => (string)$r['bg_color'],
                'accentColor' => (string)$r['accent_color'],
            ], $styleJson),
            'fields' => $fieldsJson,
            'layers' => $layersJson,
        ];
    }
    $out = array_map(fn($x) => $x['template'], $rows);
    respond(['data' => $out]);
}

if ($method === 'POST' && $action === '') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || $rawBody === '') {
        respond([
            'error' => 'Request body is empty. Template images must be uploaded separately (use upload_asset). If saving a large template, raise PHP post_max_size on the server.',
        ], 413);
    }
    $input = json_decode($rawBody, true);
    if (!is_array($input)) {
        respond(['error' => 'Invalid JSON body. Large embedded images cannot be saved inline — upload the background image first, then save the template.'], 400);
    }
    $template = $input['template'] ?? null;
    if (!is_array($template)) respond(['error' => 'template object is required'], 400);

    $id = trim((string)($template['id'] ?? ''));
    if ($id === '') $id = generateUUID();
    $name = trim((string)($template['name'] ?? 'Untitled Template'));
    $status = trim((string)($template['status'] ?? 'draft'));
    $certType = trim((string)($template['certType'] ?? 'CC'));
    $style = is_array($template['style'] ?? null) ? $template['style'] : [];
    $fields = is_array($template['fields'] ?? null) ? $template['fields'] : [];
    $layers = is_array($template['layers'] ?? null) ? $template['layers'] : [];
    certTemplateRejectOversizedEmbeddedImages($style, $fields, $layers);
    $orgId = getOrgId($tokenData);

    if (!in_array($status, ['active', 'draft', 'archived'], true)) $status = 'draft';
    if (!in_array($certType, ['CC', 'ACH', 'PRO', 'INT', 'WS'], true)) $certType = 'CC';
    $layoutStyle = (string)($style['layout'] ?? 'classic');
    if (!in_array($layoutStyle, ['classic', 'dark-pro', 'elegant'], true)) $layoutStyle = 'classic';
    $bgColor = (string)($style['bgColor'] ?? '#ffffff');
    $accentColor = (string)($style['accentColor'] ?? '#1A6B3C');
    $styleJson = json_encode($style, JSON_UNESCAPED_UNICODE);
    $fieldsJson = json_encode($fields, JSON_UNESCAPED_UNICODE);
    $layersJson = json_encode($layers, JSON_UNESCAPED_UNICODE);

    $check = $db->prepare("SELECT id FROM certificate_templates WHERE id = ? LIMIT 1");
    $check->execute([$id]);
    $exists = (bool)$check->fetch();

    if ($exists) {
        $org = orgFilter($tokenData);
        $params = [$name, $status, $certType, $layoutStyle, $bgColor, $accentColor, $styleJson, $fieldsJson, $layersJson, $id];
        $sql = "
            UPDATE certificate_templates
            SET name = ?, status = ?, cert_type = ?, layout_style = ?, bg_color = ?, accent_color = ?, style_json = ?, fields_json = ?, layers_json = ?
            WHERE id = ?
        ";
        if ($org['where'] !== '1=1') {
            $sql .= " AND {$org['where']}";
            $params = array_merge($params, $org['params']);
        }
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        respond(['id' => $id, 'message' => 'Template updated']);
    }

    $stmt = $db->prepare("
        INSERT INTO certificate_templates
        (id, name, status, cert_type, layout_style, bg_color, accent_color, style_json, fields_json, layers_json, created_by, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$id, $name, $status, $certType, $layoutStyle, $bgColor, $accentColor, $styleJson, $fieldsJson, $layersJson, $userId, $orgId]);
    respond(['id' => $id, 'message' => 'Template created'], 201);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') respond(['error' => 'ID required'], 400);
    $org = orgFilter($tokenData);
    $params = [$id];
    $sql = "DELETE FROM certificate_templates WHERE id = ?";
    if ($org['where'] !== '1=1') {
        $sql .= " AND {$org['where']}";
        $params = array_merge($params, $org['params']);
    }
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['message' => 'Template deleted']);
}

respond(['error' => 'Method not allowed'], 405);
