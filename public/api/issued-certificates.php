<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$tokenData = verifyToken();
$userId = $tokenData['user_id'] ?? null;

function tableHasColumn(PDO $db, string $table, string $column): bool {
    return syncpediaColumnExists($db, $table, $column);
}

if ($method === 'GET') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org']);
    $org = orgFilter($tokenData);
    $sql = 'SELECT id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, verify_token, created_at';
    $sql .= " FROM issued_certificates WHERE {$org['where']} ORDER BY created_at DESC LIMIT 2000";    $stmt = $db->prepare($sql);
    $stmt->execute($org['params']);
    respond(['data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $input = getInput();
    $list = $input['certificates'] ?? [];
    if (!is_array($list) || count($list) === 0) {
        respond(['error' => 'certificates array is required'], 400);
    }

    $orgId = resolveWriteOrgId($db, $tokenData);
    $hasVerifyToken = tableHasColumn($db, 'issued_certificates', 'verify_token');
    $created = 0;
    $ids = [];
    $errors = [];
    $tplOrg = orgFilter($tokenData, 'ct', $db);

    if ($hasVerifyToken) {
        $stmt = $db->prepare("
            INSERT INTO issued_certificates
            (id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, issued_by, org_id, verify_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
    } else {
        $stmt = $db->prepare("
            INSERT INTO issued_certificates
            (id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, issued_by, org_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
    }

    foreach ($list as $item) {
        $id = trim((string)($item['id'] ?? ''));
        $templateId = trim((string)($item['templateId'] ?? ''));
        $templateName = trim((string)($item['templateName'] ?? ''));
        $recipientName = trim((string)($item['recipientName'] ?? ''));
        $courseName = trim((string)($item['courseName'] ?? ''));
        $certType = trim((string)($item['certType'] ?? 'CC'));
        $issueDate = trim((string)($item['issueDate'] ?? ''));
        $status = trim((string)($item['status'] ?? 'issued'));
        $verifyToken = isset($item['verifyToken']) ? (string)$item['verifyToken'] : null;

        if ($id === '' || $templateId === '' || $templateName === '' || $recipientName === '' || $courseName === '' || $issueDate === '') {
            $errors[] = ['id' => $id, 'error' => 'Missing required fields'];
            continue;
        }
        if (!in_array($certType, ['CC', 'ACH', 'PRO', 'INT', 'WS'], true)) {
            $certType = 'CC';
        }
        if (!in_array($status, ['issued', 'revoked', 'expired'], true)) {
            $status = 'issued';
        }

        $tplParams = array_merge([$templateId], $tplOrg['params']);
        $tplChk = $db->prepare("SELECT ct.id FROM certificate_templates ct WHERE ct.id = ? AND {$tplOrg['where']} LIMIT 1");
        $tplChk->execute($tplParams);
        if (!$tplChk->fetch()) {
            $errors[] = ['id' => $id, 'error' => 'Template not in your organization'];
            continue;
        }

        try {
            if ($hasVerifyToken) {
                $stmt->execute([$id, $templateId, $templateName, $recipientName, $courseName, $certType, $issueDate, $status, $userId, $orgId, $verifyToken]);
            } else {
                $stmt->execute([$id, $templateId, $templateName, $recipientName, $courseName, $certType, $issueDate, $status, $userId, $orgId]);
            }
            $created += 1;
            $ids[] = $id;
        } catch (Throwable $e) {
            if (isMysqlDuplicateKey($e)) {
                $errors[] = ['id' => $id, 'error' => 'Certificate already exists'];
            } else {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }
    }

    respond(['created' => $created, 'ids' => $ids, 'errors' => $errors], $created > 0 ? 201 : 400);
}

if ($method === 'PUT') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager']);
    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') respond(['error' => 'ID required'], 400);
    $input = getInput();
    $status = trim((string)($input['status'] ?? ''));
    if (!in_array($status, ['issued', 'revoked', 'expired'], true)) {
        respond(['error' => 'Invalid status'], 400);
    }

    $org = orgFilter($tokenData);
    $params = [$status, $id];
    $sql = "UPDATE issued_certificates SET status = ? WHERE id = ?";
    if ($org['where'] !== '1=1') {
        $sql .= " AND {$org['where']}";
        $params = array_merge($params, $org['params']);
    }
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respond(['message' => 'Status updated']);
}

respond(['error' => 'Method not allowed'], 405);
