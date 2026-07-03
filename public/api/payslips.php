<?php
/**
 * Payslip CRUD.
 *
 * Routes:
 *   GET    payslips.php?action=list[&employee_id=&month=YYYY-MM&status=&org_id=]
 *   POST   payslips.php?action=create
 *   PUT    payslips.php?action=update_status&id=...     (draft → generated → sent)
 *   POST   payslips.php?action=send_email              (email PDF from hr@syncpedia.in)
 *   POST   payslips.php?action=save_pdf                (persist PDF on server)
 *   GET    payslips.php?action=pdf&id=...              (stream stored PDF)
 *   DELETE payslips.php?action=delete&id=...            (soft delete)
 *
 * Access: super_admin · admin · org.
 * Org scoping: rows inherit `resolveCreatorOrgId(...)` on create. Cross-org
 * is blocked for non-super_admin on every read/write.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/document_storage.php';
cors();

$db = (new Database())->getConnection();
syncpediaDocumentEnsureColumn($db, 'payslips', 'pdf_path', 'TEXT DEFAULT NULL');
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$normalizedRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$userId = (string) ($tokenData['user_id'] ?? '');
$callerOrgId = getOrgId($tokenData);
$input = getInput();

if (!in_array($normalizedRole, ['super_admin', 'admin', 'org'], true)) {
    respond(['error' => 'Insufficient permissions'], 403);
}

function payslipAllowedStatus(string $s): bool {
    return in_array($s, ['draft', 'generated', 'sent'], true);
}

function mapPayslipRow(array $r): array {
    $components = [
        'basic' => (float) ($r['basic'] ?? 0),
        'hra' => (float) ($r['hra'] ?? 0),
        'specialAllowance' => (float) ($r['special_allowance'] ?? 0),
        'otherAllowance' => (float) ($r['other_allowance'] ?? 0),
        'grossEarnings' => (float) ($r['gross_earnings'] ?? 0),
        'pfEmployee' => (float) ($r['pf_employee'] ?? 0),
        'pfEmployer' => (float) ($r['pf_employer'] ?? 0),
        'professionalTax' => (float) ($r['professional_tax'] ?? 0),
        'tds' => (float) ($r['tds'] ?? 0),
        'otherDeductions' => (float) ($r['other_deductions'] ?? 0),
        'totalDeductions' => (float) ($r['total_deductions'] ?? 0),
        'netPay' => (float) ($r['net_pay'] ?? 0),
    ];

    return [
        'id' => (string) $r['id'],
        'employeeId' => (string) ($r['employee_id'] ?? ''),
        'employeeName' => (string) ($r['employee_name'] ?? ''),
        'employeeCode' => (string) ($r['employee_code'] ?? ''),
        'designation' => (string) ($r['designation'] ?? ''),
        'department' => (string) ($r['department'] ?? ''),
        'panNumber' => (string) ($r['pan_number'] ?? ''),
        'bankName' => (string) ($r['bank_name'] ?? ''),
        'accountNumber' => (string) ($r['account_number'] ?? ''),
        'ifscCode' => (string) ($r['ifsc_code'] ?? ''),
        'month' => (string) ($r['month'] ?? ''),
        'monthLabel' => (string) ($r['month_label'] ?? ''),
        'components' => $components,
        'pfApplicable' => (int) ($r['pf_applicable'] ?? 0) === 1,
        'ptApplicable' => (int) ($r['pt_applicable'] ?? 0) === 1,
        'workingDays' => (int) ($r['working_days'] ?? 0),
        'paidDays' => (int) ($r['paid_days'] ?? 0),
        'generatedBy' => (string) ($r['generated_by'] ?? ''),
        'generatedAt' => (string) ($r['generated_at'] ?? ''),
        'status' => (string) ($r['status'] ?? 'draft'),
        'orgId' => isset($r['org_id']) ? (string) $r['org_id'] : null,
        'pdfPath' => isset($r['pdf_path']) ? (string) $r['pdf_path'] : null,
        'hasStoredPdf' => !empty($r['pdf_path']) && syncpediaDocumentStorageFileExists((string) $r['pdf_path']),
    ];
}

function payslipDecodePdfBase64(string $raw): ?string {
    if (str_contains($raw, ',')) {
        $raw = substr($raw, strrpos($raw, ',') + 1);
    }
    $bin = base64_decode($raw, true);
    return ($bin !== false && $bin !== '') ? $bin : null;
}

function payslipPersistPdf(PDO $db, string $id, string $pdfBinary): ?string {
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '_', $id);
    $path = syncpediaDocumentStorageSavePdf('payslips', 'Payslip_' . $safeId . '.pdf', $pdfBinary);
    if ($path === null) {
        return null;
    }
    try {
        $db->prepare('UPDATE payslips SET pdf_path = ? WHERE id = ? AND deleted_at IS NULL')->execute([$path, $id]);
    } catch (Throwable $e) {
        error_log('payslipPersistPdf: ' . $e->getMessage());
    }
    return $path;
}

if ($action === 'list' && $method === 'GET') {
    $sql = "SELECT * FROM payslips WHERE deleted_at IS NULL";
    $params = [];

    if ($normalizedRole === 'super_admin') {
        $orgQ = trim((string) ($_GET['org_id'] ?? ''));
        if ($orgQ !== '' && $orgQ !== 'all') {
            $sql .= " AND org_id = ?";
            $params[] = $orgQ;
        }
    } else {
        $sql .= " AND org_id = ?";
        $params[] = $callerOrgId;
    }

    if (!empty($_GET['employee_id'])) {
        $sql .= " AND employee_id = ?";
        $params[] = (string) $_GET['employee_id'];
    }
    if (!empty($_GET['month'])) {
        $sql .= " AND `month` = ?";
        $params[] = (string) $_GET['month'];
    }
    if (!empty($_GET['status']) && payslipAllowedStatus((string) $_GET['status'])) {
        $sql .= " AND status = ?";
        $params[] = (string) $_GET['status'];
    }

    $sql .= " ORDER BY generated_at DESC, created_at DESC LIMIT 500";
    $st = $db->prepare($sql);
    $st->execute($params);
    respond(['data' => array_map('mapPayslipRow', $st->fetchAll(PDO::FETCH_ASSOC))]);
}

if ($action === 'create' && $method === 'POST') {
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') respond(['error' => 'Payslip id required (e.g. SYNC-PAY-YYYYMM-XXXXX)'], 400);
    $employeeId = trim((string) ($input['employeeId'] ?? ''));
    if ($employeeId === '') respond(['error' => 'employeeId required'], 400);
    $month = trim((string) ($input['month'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) respond(['error' => 'month must be YYYY-MM'], 400);
    $statusIn = (string) ($input['status'] ?? 'generated');
    if (!payslipAllowedStatus($statusIn)) respond(['error' => 'Invalid status'], 400);

    $emp = $db->prepare("SELECT * FROM payslip_employees WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $emp->execute([$employeeId]);
    $empRow = $emp->fetch(PDO::FETCH_ASSOC);
    if (!$empRow) respond(['error' => 'Employee not found'], 404);

    $orgId = (string) $empRow['org_id'];
    if ($normalizedRole !== 'super_admin' && $orgId !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org payslip creation not allowed'], 403);
    }

    $components = is_array($input['components'] ?? null) ? $input['components'] : [];
    $generatedBy = trim((string) ($input['generatedBy'] ?? ''));
    if ($generatedBy === '') {
        try {
            $u = $db->prepare('SELECT full_name, email FROM users WHERE id = ? LIMIT 1');
            $u->execute([$userId]);
            $ur = $u->fetch(PDO::FETCH_ASSOC);
            $generatedBy = $ur ? ((string) ($ur['full_name'] ?? '') ?: (string) ($ur['email'] ?? '')) : 'Administrator';
        } catch (Throwable $e) {
            $generatedBy = 'Administrator';
        }
    }

    $monthLabel = (string) ($input['monthLabel'] ?? '');
    if ($monthLabel === '') {
        $ts = strtotime($month . '-01');
        if ($ts !== false) $monthLabel = date('F Y', $ts);
    }

    try {
        $st = $db->prepare("
            INSERT INTO payslips
                (id, org_id, employee_id, employee_name, employee_code, designation, department,
                 pan_number, bank_name, account_number, ifsc_code,
                 `month`, month_label, working_days, paid_days, pf_applicable, pt_applicable,
                 basic, hra, special_allowance, other_allowance, gross_earnings,
                 pf_employee, pf_employer, professional_tax, tds, other_deductions, total_deductions, net_pay,
                 status, generated_by, generated_by_user_id, generated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ");
        $st->execute([
            $id,
            $orgId,
            $employeeId,
            (string) $empRow['name'],
            (string) $empRow['employee_code'],
            (string) $empRow['designation'],
            (string) $empRow['department'],
            (string) $empRow['pan_number'],
            (string) $empRow['bank_name'],
            (string) $empRow['account_number'],
            (string) $empRow['ifsc_code'],
            $month,
            $monthLabel,
            (int) ($input['workingDays'] ?? 26),
            (int) ($input['paidDays'] ?? 26),
            !empty($input['pfApplicable']) ? 1 : 0,
            !empty($input['ptApplicable']) ? 1 : 0,
            (float) ($components['basic'] ?? 0),
            (float) ($components['hra'] ?? 0),
            (float) ($components['specialAllowance'] ?? 0),
            (float) ($components['otherAllowance'] ?? 0),
            (float) ($components['grossEarnings'] ?? 0),
            (float) ($components['pfEmployee'] ?? 0),
            (float) ($components['pfEmployer'] ?? 0),
            (float) ($components['professionalTax'] ?? 0),
            (float) ($components['tds'] ?? 0),
            (float) ($components['otherDeductions'] ?? 0),
            (float) ($components['totalDeductions'] ?? 0),
            (float) ($components['netPay'] ?? 0),
            $statusIn,
            $generatedBy,
            $userId ?: null,
        ]);
    } catch (Throwable $e) {
        if (isMysqlDuplicateKey($e)) {
            respond(['error' => 'Payslip already exists for this employee/month or id collision'], 409);
        }
        respond(['error' => 'Could not save payslip', 'detail' => $e->getMessage()], 500);
    }

    $row = $db->prepare("SELECT * FROM payslips WHERE id = ? LIMIT 1");
    $row->execute([$id]);
    respond(['data' => mapPayslipRow($row->fetch(PDO::FETCH_ASSOC) ?: [])], 201);
}

if ($action === 'update_status' && ($method === 'PUT' || $method === 'POST')) {
    $id = trim((string) ($_GET['id'] ?? $input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);
    $status = (string) ($input['status'] ?? '');
    if (!payslipAllowedStatus($status)) respond(['error' => 'Invalid status'], 400);

    $sel = $db->prepare("SELECT org_id FROM payslips WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) respond(['error' => 'Payslip not found'], 404);
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org update not allowed'], 403);
    }

    try {
        $db->prepare("UPDATE payslips SET status = ? WHERE id = ?")->execute([$status, $id]);
    } catch (Throwable $e) {
        respond(['error' => 'Could not update payslip status', 'detail' => $e->getMessage()], 500);
    }
    respond(['message' => 'Status updated', 'id' => $id, 'status' => $status]);
}

if ($action === 'pdf' && $method === 'GET') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $sel = $db->prepare('SELECT id, org_id, pdf_path FROM payslips WHERE id = ? AND deleted_at IS NULL LIMIT 1');
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Payslip not found'], 404);
    }
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Forbidden'], 403);
    }
    $path = trim((string) ($row['pdf_path'] ?? ''));
    if (!syncpediaDocumentStorageFileExists($path)) {
        respond(['error' => 'Payslip PDF not stored yet. Generate and save the payslip first.'], 404);
    }
    syncpediaDocumentStorageStreamPdf($path, 'Payslip_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $id) . '.pdf');
}

if ($action === 'save_pdf' && $method === 'POST') {
    $id = trim((string) ($input['id'] ?? $_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'Payslip id required'], 400);
    }
    $sel = $db->prepare('SELECT id, org_id FROM payslips WHERE id = ? AND deleted_at IS NULL LIMIT 1');
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Payslip not found'], 404);
    }
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Forbidden'], 403);
    }
    $pdfBinary = payslipDecodePdfBase64((string) ($input['pdfBase64'] ?? ''));
    if ($pdfBinary === null) {
        respond(['error' => 'Invalid payslip PDF data'], 400);
    }
    $path = payslipPersistPdf($db, $id, $pdfBinary);
    if ($path === null) {
        respond(['error' => 'Could not save payslip PDF on server'], 500);
    }
    respond(['success' => true, 'id' => $id, 'pdf_path' => $path]);
}

if ($action === 'send_email' && $method === 'POST') {
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'Payslip id required'], 400);
    }

    $sel = $db->prepare("
        SELECT p.*, e.email AS employee_email, e.name AS emp_name
        FROM payslips p
        LEFT JOIN payslip_employees e ON e.id = p.employee_id AND e.deleted_at IS NULL
        WHERE p.id = ? AND p.deleted_at IS NULL
        LIMIT 1
    ");
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Payslip not found'], 404);
    }
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org send not allowed'], 403);
    }

    $to = trim((string) ($input['to'] ?? $row['employee_email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'Valid employee email is required'], 400);
    }

    $pdfBinary = payslipDecodePdfBase64((string) ($input['pdfBase64'] ?? ''));
    if ($pdfBinary === null) {
        respond(['error' => 'Invalid payslip PDF data'], 400);
    }

    $attachPath = payslipPersistPdf($db, $id, $pdfBinary);
    if ($attachPath === null || !is_file($attachPath)) {
        $safeId = preg_replace('/[^A-Za-z0-9_-]/', '_', $id);
        $attachPath = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'payslip_' . $safeId . '_' . uniqid('', true) . '.pdf';
        if (@file_put_contents($attachPath, $pdfBinary) === false) {
            respond(['error' => 'Could not prepare payslip PDF for email'], 500);
        }
        $tmpOnly = true;
    } else {
        $tmpOnly = false;
    }
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '_', $id);

    $employeeName = trim((string) ($row['employee_name'] ?? $row['emp_name'] ?? 'Team Member'));
    $monthLabel = trim((string) ($row['month_label'] ?? $row['month'] ?? ''));
    $subject = trim((string) ($input['subject'] ?? ''));
    if ($subject === '') {
        $subject = 'Payslip — ' . ($monthLabel !== '' ? $monthLabel : 'Salary');
    }
    $body = trim((string) ($input['body'] ?? ''));
    if ($body === '') {
        $body = "Dear {$employeeName},\n\n"
            . "Please find attached your payslip"
            . ($monthLabel !== '' ? " for {$monthLabel}" : '')
            . ".\n\n"
            . "If you have any questions, reply to this email.\n\n"
            . "Regards,\nSyncpedia HR";
    }
    $fileName = trim((string) ($input['fileName'] ?? ''));
    if ($fileName === '') {
        $fileName = 'Payslip_' . $safeId . '.pdf';
    }

    $cc = trim((string) ($input['cc'] ?? ''));
    $bcc = trim((string) ($input['bcc'] ?? ''));

    $send = syncpediaSendPayslipEmail(
        $to,
        $subject,
        $body,
        [['path' => $attachPath, 'name' => $fileName]],
        $cc,
        $bcc,
    );
    if (!empty($tmpOnly)) {
        @unlink($attachPath);
    }

    if (empty($send['ok'])) {
        respond(['error' => $send['error'] ?? 'Unable to send payslip email'], 500);
    }

    try {
        $db->prepare("UPDATE payslips SET status = 'sent' WHERE id = ?")->execute([$id]);
    } catch (Throwable $e) {
        // Email sent; status update failure is non-fatal
    }

    respond([
        'success' => true,
        'to' => $to,
        'from' => (string) ($send['from'] ?? syncpediaHrMailAddress()),
        'status' => 'sent',
        'pdf_path' => empty($tmpOnly) ? $attachPath : null,
    ]);
}

if ($action === 'delete' && ($method === 'DELETE' || $method === 'POST')) {
    $id = trim((string) ($_GET['id'] ?? $input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);

    $sel = $db->prepare("SELECT org_id FROM payslips WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) respond(['error' => 'Payslip not found'], 404);
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org delete not allowed'], 403);
    }

    try {
        $db->prepare("UPDATE payslips SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([$id]);
    } catch (Throwable $e) {
        respond(['error' => 'Could not delete payslip', 'detail' => $e->getMessage()], 500);
    }
    respond(['message' => 'Payslip deleted', 'id' => $id]);
}

respond(['error' => 'Unknown action'], 400);
