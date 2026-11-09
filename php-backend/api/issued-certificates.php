<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cert_ids.php';
cors();

$db = (new Database())->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$tokenData = verifyToken();
$userId = $tokenData['user_id'] ?? null;

certEnsureTypeColumns($db);
certEnsureOrgPrefixColumn($db);

function tableHasColumn(PDO $db, string $table, string $column): bool {
    return syncpediaColumnExists($db, $table, $column);
}

if ($method === 'GET') {
    requireRole($tokenData, ['admin', 'super_admin', 'manager', 'org', 'operational_manager']);
    $org = orgFilter($tokenData);
    $sql = 'SELECT id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status, verify_token, created_at';
    $sql .= " FROM issued_certificates WHERE {$org['where']} ORDER BY created_at DESC LIMIT 2000";
    $stmt = $db->prepare($sql);
    $stmt->execute($org['params']);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $emailByCert = [];
    $ids = [];
    foreach ($rows as $row) {
        $cid = trim((string) ($row['id'] ?? ''));
        if ($cid !== '') {
            $ids[] = $cid;
        }
    }
    if ($ids) {
        try {
            $hasStatus = tableHasColumn($db, 'certificate_email_logs', 'status');
            $hasError = tableHasColumn($db, 'certificate_email_logs', 'error_message');
            $statusSelect = $hasStatus ? 'status' : "'sent' AS status";
            $errorSelect = $hasError ? 'error_message' : 'NULL AS error_message';
            $in = implode(',', array_fill(0, count($ids), '?'));
            // Latest log per certificate_id (MySQL 8 window, with ORDER BY fallback via max created_at join).
            $logSql = "
                SELECT cel.certificate_id, cel.to_email, cel.sent_at, {$statusSelect}, {$errorSelect}, cel.created_at
                FROM certificate_email_logs cel
                INNER JOIN (
                    SELECT certificate_id, MAX(created_at) AS max_created
                    FROM certificate_email_logs
                    WHERE certificate_id IN ({$in})
                    GROUP BY certificate_id
                ) latest ON latest.certificate_id = cel.certificate_id AND latest.max_created = cel.created_at
            ";
            $logStmt = $db->prepare($logSql);
            $logStmt->execute($ids);
            while ($log = $logStmt->fetch(PDO::FETCH_ASSOC)) {
                $cid = trim((string) ($log['certificate_id'] ?? ''));
                if ($cid === '' || isset($emailByCert[$cid])) {
                    continue;
                }
                $st = strtolower(trim((string) ($log['status'] ?? 'sent')));
                if ($st !== 'failed') {
                    $st = 'sent';
                }
                $emailByCert[$cid] = [
                    'email_status' => $st,
                    'email_error' => $st === 'failed' ? trim((string) ($log['error_message'] ?? '')) : null,
                    'email_to' => trim((string) ($log['to_email'] ?? '')),
                    'email_sent_at' => $log['sent_at'] ?? null,
                ];
            }
        } catch (Throwable $e) {
            error_log('[issued-certificates] email status: ' . $e->getMessage());
        }
    }

    foreach ($rows as &$row) {
        if (isset($row['cert_type'])) {
            $row['cert_type'] = certNormalizeType($row['cert_type']);
        }
        $cid = trim((string) ($row['id'] ?? ''));
        $mail = $emailByCert[$cid] ?? null;
        $row['email_status'] = is_array($mail) ? ($mail['email_status'] ?? null) : null;
        $row['email_error'] = is_array($mail) ? ($mail['email_error'] ?? null) : null;
        $row['email_to'] = is_array($mail) ? ($mail['email_to'] ?? null) : null;
        $row['email_sent_at'] = is_array($mail) ? ($mail['email_sent_at'] ?? null) : null;
    }
    unset($row);
    respond(['data' => $rows]);
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
    $idMap = [];
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
        $certType = certNormalizeType($item['certType'] ?? 'CC');
        $issueDate = trim((string)($item['issueDate'] ?? ''));
        $status = trim((string)($item['status'] ?? 'issued'));
        $verifyToken = isset($item['verifyToken']) ? (string)$item['verifyToken'] : null;

        if ($templateId === '' || $templateName === '' || $recipientName === '' || $courseName === '' || $issueDate === '') {
            $errors[] = ['id' => $id, 'error' => 'Missing required fields'];
            continue;
        }
        if (!in_array($status, ['issued', 'revoked', 'expired'], true)) {
            $status = 'issued';
        }

        $tplParams = array_merge([$templateId], $tplOrg['params']);
        $tplChk = $db->prepare("SELECT ct.id, ct.cert_type FROM certificate_templates ct WHERE ct.id = ? AND {$tplOrg['where']} LIMIT 1");
        $tplChk->execute($tplParams);
        $tplRow = $tplChk->fetch(PDO::FETCH_ASSOC);
        if (!$tplRow) {
            $errors[] = ['id' => $id, 'error' => 'Template not in your organization'];
            continue;
        }
        $certType = certNormalizeType($tplRow['cert_type'] ?? $certType);

        $orgIdStr = trim((string) $orgId);
        $prefix = $orgIdStr !== '' ? certGetOrgPrefix($db, $orgIdStr) : null;
        if ($prefix === null && $orgIdStr !== '') {
            $fromId = certNormalizePrefix(explode('-', strtoupper($id))[0] ?? '');
            $wanted = $fromId ?: certSuggestPrefix($db, $orgIdStr);
            $claimed = certClaimOrgPrefix($db, $orgIdStr, $wanted);
            if (empty($claimed['ok'])) {
                $errors[] = ['id' => $id, 'error' => $claimed['error'] ?? 'Certificate prefix is not available.'];
                continue;
            }
            $prefix = $claimed['prefix'];
        }
        if ($prefix === null) {
            $errors[] = ['id' => $id, 'error' => 'Organization prefix is required before issuing certificates.'];
            continue;
        }
        $proposed = $id;
        try {
            $id = certResolveIssuedId($db, $proposed, $prefix, $certType);
        } catch (Throwable $e) {
            $errors[] = ['id' => $proposed, 'error' => 'Could not allocate a unique certificate number'];
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
            if ($proposed !== '') {
                $idMap[$proposed] = $id;
            }
        } catch (Throwable $e) {
            error_log('[issued-certificates] insert: ' . $e->getMessage());
            if (isMysqlDuplicateKey($e)) {
                $errors[] = ['id' => $id, 'error' => 'Certificate already exists'];
            } else {
                $errors[] = ['id' => $id, 'error' => 'Could not save this certificate. Refresh the page and try again.'];
            }
        }
    }

    if ($created >= 2) {
        syncpediaNotifyOrgAdminsOfBulkKind(
            $db,
            (string) $userId,
            $orgId ? (string) $orgId : null,
            'certificates',
            (int) $created,
        );
    }

    $topError = null;
    if ($created === 0 && $errors !== []) {
        $topError = (string) ($errors[0]['error'] ?? 'Could not issue certificate');
    }
    respond([
        'created' => $created,
        'ids' => $ids,
        'id_map' => $idMap,
        'errors' => $errors,
        'error' => $topError,
    ], $created > 0 ? 201 : 400);
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

if ($method === 'DELETE') {
    requireRole($tokenData, ['admin', 'super_admin', 'org']);
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'ID required'], 400);
    }
    if (is_file(__DIR__ . '/document_storage.php')) {
        require_once __DIR__ . '/document_storage.php';
    }
    if (!function_exists('syncpediaPurgeIssuedCertificate') || !syncpediaPurgeIssuedCertificate($db, $tokenData, $id)) {
        respond(['error' => 'Issued certificate not found'], 404);
    }
    respond(['message' => 'Deleted successfully']);
}

respond(['error' => 'Method not allowed'], 405);
