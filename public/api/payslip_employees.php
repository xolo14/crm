<?php
/**
 * Payslip employee directory CRUD.
 *
 * Routes (uses ?action= query param to mirror hr.php / marketing.php style):
 *   GET    payslip_employees.php?action=list[&org_id=...]   (super_admin only override)
 *   POST   payslip_employees.php?action=create
 *   PUT    payslip_employees.php?action=update&id=...
 *   DELETE payslip_employees.php?action=delete&id=...       (soft delete)
 *
 * Access: super_admin · admin · org   (matches sidebar gate on /payslip).
 * Org scoping: new rows inherit `resolveCreatorOrgId(...)`. List + write
 * operations are scoped to the caller's effective org unless they are
 * super_admin, who may pass `?org_id=` to filter.
 */

require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$role = strtolower((string) ($tokenData['role'] ?? ''));
$normalizedRole = $role === 'superadmin' ? 'super_admin' : ($role === 'organisation' ? 'org' : $role);
$userId = (string) ($tokenData['user_id'] ?? '');
$callerOrgId = getOrgId($tokenData);
$input = getInput();

function payslipEmpAllowed(string $r): bool {
    return in_array($r, ['super_admin', 'admin', 'org'], true);
}

if (!payslipEmpAllowed($normalizedRole)) {
    respond(['error' => 'Insufficient permissions'], 403);
}

/** Map DB row -> frontend `Employee` shape. */
function mapEmployeeRow(array $r): array {
    return [
        'id' => (string) $r['id'],
        'employeeCode' => (string) ($r['employee_code'] ?? ''),
        'name' => (string) ($r['name'] ?? ''),
        'designation' => (string) ($r['designation'] ?? ''),
        'department' => (string) ($r['department'] ?? ''),
        'email' => (string) ($r['email'] ?? ''),
        'phone' => (string) ($r['phone'] ?? ''),
        'panNumber' => (string) ($r['pan_number'] ?? ''),
        'bankName' => (string) ($r['bank_name'] ?? ''),
        'accountNumber' => (string) ($r['account_number'] ?? ''),
        'ifscCode' => (string) ($r['ifsc_code'] ?? ''),
        'ctc' => (float) ($r['ctc'] ?? 0),
        'pfApplicable' => (int) ($r['pf_applicable'] ?? 1) === 1,
        'ptApplicable' => (int) ($r['pt_applicable'] ?? 1) === 1,
        'joiningDate' => (string) ($r['joining_date'] ?? ''),
        'createdAt' => (string) ($r['created_at'] ?? ''),
        'orgId' => isset($r['org_id']) ? (string) $r['org_id'] : null,
    ];
}

function nextEmployeeCode(PDO $db, string $orgId): string {
    try {
        $st = $db->prepare("SELECT employee_code FROM payslip_employees WHERE org_id = ? AND employee_code LIKE 'SYNC-EMP-%'");
        $st->execute([$orgId]);
        $max = 0;
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $code) {
            if (preg_match('/SYNC-EMP-(\d+)/', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'SYNC-EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    } catch (Throwable $e) {
        return 'SYNC-EMP-001';
    }
}

if ($action === 'list' && $method === 'GET') {
    $orgFilter = $callerOrgId;
    if ($normalizedRole === 'super_admin') {
        $q = trim((string) ($_GET['org_id'] ?? ''));
        if ($q !== '' && $q !== 'all') {
            $orgFilter = $q;
        } elseif ($q === 'all') {
            $orgFilter = null;
        }
    }

    if ($orgFilter !== null && $orgFilter !== '') {
        $st = $db->prepare("SELECT * FROM payslip_employees WHERE deleted_at IS NULL AND org_id = ? ORDER BY employee_code ASC");
        $st->execute([$orgFilter]);
    } else {
        $st = $db->query("SELECT * FROM payslip_employees WHERE deleted_at IS NULL ORDER BY employee_code ASC");
    }
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    respond(['data' => array_map('mapEmployeeRow', $rows)]);
}

if ($action === 'create' && $method === 'POST') {
    $name = trim((string) ($input['name'] ?? ''));
    $ctc = (float) ($input['ctc'] ?? 0);
    if ($name === '') respond(['error' => 'Name is required'], 400);
    if ($ctc <= 0) respond(['error' => 'CTC must be greater than 0'], 400);

    $orgId = resolveCreatorOrgId($db, $tokenData);
    if (!$orgId) respond(['error' => 'Could not resolve organization'], 400);

    $code = trim((string) ($input['employeeCode'] ?? ''));
    if ($code === '') {
        $code = nextEmployeeCode($db, $orgId);
    }

    $pan = strtoupper(trim((string) ($input['panNumber'] ?? '')));
    $ifsc = strtoupper(trim((string) ($input['ifscCode'] ?? '')));

    $id = generateUUID();
    try {
        $st = $db->prepare("
            INSERT INTO payslip_employees
                (id, org_id, employee_code, name, designation, department,
                 email, phone, pan_number, bank_name, account_number, ifsc_code,
                 ctc, pf_applicable, pt_applicable, joining_date, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ");
        $st->execute([
            $id,
            $orgId,
            $code,
            $name,
            trim((string) ($input['designation'] ?? '')),
            trim((string) ($input['department'] ?? '')),
            trim((string) ($input['email'] ?? '')),
            trim((string) ($input['phone'] ?? '')),
            $pan,
            trim((string) ($input['bankName'] ?? '')),
            trim((string) ($input['accountNumber'] ?? '')),
            $ifsc,
            $ctc,
            !empty($input['pfApplicable']) ? 1 : 0,
            !empty($input['ptApplicable']) ? 1 : 0,
            !empty($input['joiningDate']) ? (string) $input['joiningDate'] : null,
            $userId ?: null,
        ]);
    } catch (Throwable $e) {
        if (isMysqlDuplicateKey($e)) {
            respond(['error' => 'Employee ID already exists in this organization'], 409);
        }
        respond(['error' => 'Could not create employee', 'detail' => $e->getMessage()], 500);
    }

    $row = $db->prepare("SELECT * FROM payslip_employees WHERE id = ? LIMIT 1");
    $row->execute([$id]);
    respond(['data' => mapEmployeeRow($row->fetch(PDO::FETCH_ASSOC) ?: [])], 201);
}

if ($action === 'update' && ($method === 'PUT' || $method === 'POST')) {
    $id = trim((string) ($_GET['id'] ?? $input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);

    $existing = $db->prepare("SELECT * FROM payslip_employees WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $existing->execute([$id]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    if (!$row) respond(['error' => 'Employee not found'], 404);
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org update not allowed'], 403);
    }

    $map = [
        'employeeCode' => 'employee_code',
        'name' => 'name',
        'designation' => 'designation',
        'department' => 'department',
        'email' => 'email',
        'phone' => 'phone',
        'panNumber' => 'pan_number',
        'bankName' => 'bank_name',
        'accountNumber' => 'account_number',
        'ifscCode' => 'ifsc_code',
        'ctc' => 'ctc',
        'pfApplicable' => 'pf_applicable',
        'ptApplicable' => 'pt_applicable',
        'joiningDate' => 'joining_date',
    ];
    $sets = [];
    $params = [];
    foreach ($map as $jsonKey => $dbCol) {
        if (!array_key_exists($jsonKey, $input)) continue;
        $val = $input[$jsonKey];
        if (in_array($jsonKey, ['panNumber', 'ifscCode', 'employeeCode'], true)) {
            $val = strtoupper(trim((string) $val));
            if ($jsonKey === 'employeeCode' && $val === '') {
                respond(['error' => 'employeeCode cannot be empty'], 400);
            }
        } elseif (in_array($jsonKey, ['pfApplicable', 'ptApplicable'], true)) {
            $val = $val ? 1 : 0;
        } elseif ($jsonKey === 'ctc') {
            $val = (float) $val;
        } elseif ($jsonKey === 'joiningDate') {
            $val = $val === '' ? null : (string) $val;
        } else {
            $val = trim((string) $val);
        }
        $sets[] = "`$dbCol` = ?";
        $params[] = $val;
    }
    if (!$sets) respond(['error' => 'Nothing to update'], 400);
    $params[] = $id;

    try {
        $st = $db->prepare("UPDATE payslip_employees SET " . implode(', ', $sets) . " WHERE id = ?");
        $st->execute($params);
    } catch (Throwable $e) {
        if (isMysqlDuplicateKey($e)) {
            respond(['error' => 'Employee ID already exists in this organisation'], 409);
        }
        respond(['error' => 'Could not update employee', 'detail' => $e->getMessage()], 500);
    }

    $sel = $db->prepare("SELECT * FROM payslip_employees WHERE id = ? LIMIT 1");
    $sel->execute([$id]);
    respond(['data' => mapEmployeeRow($sel->fetch(PDO::FETCH_ASSOC) ?: [])]);
}

if ($action === 'delete' && ($method === 'DELETE' || $method === 'POST')) {
    $id = trim((string) ($_GET['id'] ?? $input['id'] ?? ''));
    if ($id === '') respond(['error' => 'id required'], 400);

    $sel = $db->prepare("SELECT org_id FROM payslip_employees WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $sel->execute([$id]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) respond(['error' => 'Employee not found'], 404);
    if ($normalizedRole !== 'super_admin' && (string) $row['org_id'] !== (string) $callerOrgId) {
        respond(['error' => 'Cross-org delete not allowed'], 403);
    }

    try {
        $db->prepare("UPDATE payslip_employees SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([$id]);
    } catch (Throwable $e) {
        respond(['error' => 'Could not delete employee', 'detail' => $e->getMessage()], 500);
    }
    respond(['message' => 'Employee deleted', 'id' => $id]);
}

respond(['error' => 'Unknown action'], 400);
