<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function hrLeadsParseInput(): array {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'multipart/form-data') !== false) {
        return $_POST;
    }
    return getInput();
}

$input = hrLeadsParseInput();
$userId = $tokenData['user_id'];
$role = $tokenData['role'] ?? '';
$orgId = getOrgId($tokenData);

function normalizeRole(string $role): string {
    $r = strtolower(trim($role));
    if ($r === 'superadmin' || $r === 'super admin' || $r === 'super-admin') return 'super_admin';
    if ($r === 'organisation') return 'org';
    return $r;
}

$current_user_id = $userId;
$current_role = normalizeRole((string) $role); // super_admin | admin | org | hr
$current_org_id = $orgId;

function ensureHrLeadsTable(PDO $db): void {
    static $done = false;
    if ($done) return;
    $sql = "CREATE TABLE IF NOT EXISTS `hr_leads` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `hr_id` CHAR(36) NOT NULL,
      `assigned_by` CHAR(36) DEFAULT NULL,
      `full_name` VARCHAR(255) NOT NULL,
      `phone` VARCHAR(20) NOT NULL,
      `email` VARCHAR(255) DEFAULT NULL,
      `source` VARCHAR(100) DEFAULT NULL,
      `status` ENUM('new','contacted','interested','not_interested','converted','lost') DEFAULT 'new',
      `priority` ENUM('low','medium','high') DEFAULT 'medium',
      `notes` TEXT DEFAULT NULL,
      `resume_path` VARCHAR(500) DEFAULT NULL,
      `follow_up_date` DATE DEFAULT NULL,
      `is_assigned` TINYINT(1) DEFAULT 0,
      `org_id` CHAR(36) DEFAULT NULL,
      `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      `deleted_at` TIMESTAMP NULL DEFAULT NULL,
      INDEX `idx_hr_leads_hr_id` (`hr_id`),
      INDEX `idx_hr_leads_status` (`status`),
      INDEX `idx_hr_leads_is_assigned` (`is_assigned`),
      INDEX `idx_hr_leads_created_at` (`created_at`),
      INDEX `idx_hr_leads_org_id` (`org_id`),
      FOREIGN KEY (`hr_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
      FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
      CONSTRAINT `fk_hr_leads_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    $db->exec($sql);
    $done = true;
}
ensureHrLeadsTable($db);

try {
    $db->exec("ALTER TABLE hr_leads ADD COLUMN resume_path VARCHAR(500) DEFAULT NULL AFTER notes");
} catch (PDOException $e) {
    // Duplicate column / already exists
}

function parsePage(): array {
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 25)));
    $offset = ($page - 1) * $limit;
    return [$page, $limit, $offset];
}

if ($action === 'add_lead' && $method === 'POST') {
    if (!in_array($current_role, ['hr', 'admin', 'super_admin'], true)) respond(['success' => false, 'message' => 'Access denied'], 403);
    $fullName = trim((string) ($input['full_name'] ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    if ($fullName === '' || $phone === '') respond(['error' => 'full_name and phone are required'], 400);
    $targetHrId = $current_user_id;
    if (in_array($current_role, ['admin', 'super_admin'], true)) {
        $targetHrId = trim((string) ($input['hr_id'] ?? ''));
        if ($targetHrId === '') respond(['error' => 'hr_id is required for admin add'], 400);
        $hrChk = $db->prepare("SELECT id, role FROM users WHERE id = ? AND is_active = 1");
        $hrChk->execute([$targetHrId]);
        $hrRow = $hrChk->fetch();
        if (!$hrRow || normalizeRole((string) ($hrRow['role'] ?? '')) !== 'hr') respond(['error' => 'Invalid HR user'], 400);
    }
    // Always derive org_id from HR user record (never trust request body)
    $orgStmt = $db->prepare("SELECT org_id FROM users WHERE id = ? LIMIT 1");
    $orgStmt->execute([$targetHrId]);
    $derivedOrgId = $orgStmt->fetch()['org_id'] ?? null;
    $resumePath = null;
    if (!empty($_FILES['resume'])) {
        $resumePath = saveLeadResumeUpload($_FILES['resume']);
    }
    $stmt = $db->prepare("INSERT INTO hr_leads (hr_id, assigned_by, full_name, phone, email, source, status, priority, notes, resume_path, follow_up_date, is_assigned, org_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)");
    $stmt->execute([
        $targetHrId,
        null,
        $fullName,
        $phone,
        $input['email'] ?? null,
        $input['source'] ?? null,
        $input['status'] ?? 'new',
        $input['priority'] ?? 'medium',
        $input['notes'] ?? null,
        $resumePath,
        $input['follow_up_date'] ?? null,
        $derivedOrgId,
    ]);
    $id = (int) $db->lastInsertId();
    $q = $db->prepare("SELECT * FROM hr_leads WHERE id = ?");
    $q->execute([$id]);
    respond(['success' => true, 'lead' => $q->fetch()]);
}

if ($action === 'my_leads' && $method === 'GET') {
    if ($current_role !== 'hr') respond(['success' => false, 'message' => 'Access denied'], 403);
    [$page, $limit, $offset] = parsePage();
    $bounds = hrLeadsWeekBoundsAndMeta();
    $where = "hr_id = ? AND is_assigned = 0 AND deleted_at IS NULL AND created_at >= ? AND created_at <= ?";
    $params = [$current_user_id, $bounds['start'], $bounds['end']];
    $status = trim((string) ($_GET['status'] ?? 'all'));
    $search = trim((string) ($_GET['search'] ?? ''));
    if ($status !== '' && $status !== 'all') { $where .= " AND status = ?"; $params[] = $status; }
    if ($search !== '') { $where .= " AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)"; $s = "%$search%"; $params[] = $s; $params[] = $s; $params[] = $s; }
    $c = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE $where");
    $c->execute($params);
    $total = (int) (($c->fetch()['c'] ?? 0));
    $stmt = $db->prepare("SELECT * FROM hr_leads WHERE $where ORDER BY created_at DESC LIMIT $limit OFFSET $offset");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    respond([
        'success' => true,
        'data' => $rows,
        'leads' => $rows,
        'total' => $total,
        'page' => $page,
        'limit' => $limit,
        'week' => $bounds['week'],
    ]);
}

if ($action === 'assigned_leads' && $method === 'GET') {
    if ($current_role !== 'hr') respond(['success' => false, 'message' => 'Access denied'], 403);
    [$page, $limit, $offset] = parsePage();
    $where = "a.hr_id = ? AND a.is_assigned = 1 AND a.deleted_at IS NULL";
    $params = [$current_user_id];
    $status = trim((string) ($_GET['status'] ?? 'all'));
    $search = trim((string) ($_GET['search'] ?? ''));
    if ($status !== '' && $status !== 'all') { $where .= " AND a.status = ?"; $params[] = $status; }
    if ($search !== '') { $where .= " AND (a.full_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ?)"; $s = "%$search%"; $params[] = $s; $params[] = $s; $params[] = $s; }
    $c = $db->prepare("SELECT COUNT(*) c FROM hr_leads a WHERE $where");
    $c->execute($params);
    $total = (int) (($c->fetch()['c'] ?? 0));
    $stmt = $db->prepare("SELECT a.*, u.full_name as assigned_by_name FROM hr_leads a LEFT JOIN users u ON u.id = a.assigned_by WHERE $where ORDER BY a.created_at DESC LIMIT $limit OFFSET $offset");
    $stmt->execute($params);
    respond(['success' => true, 'data' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'limit' => $limit]);
}

if ($action === 'update_lead' && ($method === 'PUT' || $method === 'POST')) {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) respond(['error' => 'id required'], 400);
    $sel = $db->prepare("SELECT * FROM hr_leads WHERE id = ? AND deleted_at IS NULL");
    $sel->execute([$id]);
    $lead = $sel->fetch();
    if (!$lead) respond(['error' => 'Lead not found'], 404);
    if ($current_role === 'hr') {
        if ($lead['hr_id'] !== $current_user_id) respond(['error' => 'Forbidden'], 403);
    } elseif ($current_role === 'admin') {
        if (($lead['org_id'] ?? null) !== $current_org_id) respond(['error' => 'Forbidden'], 403);
    } elseif ($current_role === 'org') {
        if (($lead['org_id'] ?? null) !== $current_org_id) respond(['error' => 'Forbidden'], 403);
    } elseif ($current_role !== 'super_admin') {
        respond(['error' => 'Forbidden'], 403);
    }
    $fields = [];
    $params = [];
    $allowedFields = ['status', 'notes', 'follow_up_date', 'priority', 'full_name', 'phone', 'email', 'source'];
    if ($current_role === 'org') {
        $allowedFields = ['status', 'notes'];
    }
    foreach ($allowedFields as $f) {
        if (array_key_exists($f, $input)) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
    }
    $newResumePath = null;
    if (!empty($_FILES['resume'])) {
        $newResumePath = saveLeadResumeUpload($_FILES['resume']);
        if ($newResumePath !== null) {
            deleteLeadResumeIfExists((string) ($lead['resume_path'] ?? ''));
            $fields[] = 'resume_path = ?';
            $params[] = $newResumePath;
        }
    }
    if (!$fields) respond(['error' => 'Nothing to update'], 400);
    $params[] = $id;
    $stmt = $db->prepare("UPDATE hr_leads SET " . implode(',', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['success' => true, 'message' => 'Lead updated']);
}

if ($action === 'delete_lead' && $method === 'DELETE') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) respond(['error' => 'id required'], 400);
    if ($current_role === 'org') respond(['success' => false, 'message' => 'Access denied'], 403);
    if ($current_role === 'hr') {
        $stmt = $db->prepare("UPDATE hr_leads SET deleted_at = NOW() WHERE id = ? AND hr_id = ?");
        $stmt->execute([$id, $current_user_id]);
    } elseif ($current_role === 'admin') {
        $stmt = $db->prepare("UPDATE hr_leads SET deleted_at = NOW() WHERE id = ? AND org_id = ?");
        $stmt->execute([$id, $current_org_id]);
    } elseif ($current_role === 'super_admin') {
        $stmt = $db->prepare("UPDATE hr_leads SET deleted_at = NOW() WHERE id = ?");
        $stmt->execute([$id]);
    } else {
        respond(['success' => false, 'message' => 'Access denied'], 403);
    }
    respond(['success' => true, 'message' => 'Lead deleted']);
}

if ($action === 'get_lead' && $method === 'GET') {
    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) respond(['error' => 'id required'], 400);
    $stmt = $db->prepare("SELECT a.*, h.full_name as hr_name, ab.full_name as assigned_by_name, o.name as org_name FROM hr_leads a LEFT JOIN users h ON h.id = a.hr_id LEFT JOIN users ab ON ab.id = a.assigned_by LEFT JOIN organizations o ON o.id = a.org_id WHERE a.id = ? AND a.deleted_at IS NULL");
    $stmt->execute([$id]);
    $lead = $stmt->fetch();
    if (!$lead) respond(['error' => 'Lead not found'], 404);
    if ($current_role === 'hr') {
        if ($lead['hr_id'] !== $current_user_id) respond(['error' => 'Forbidden'], 403);
    } elseif ($current_role === 'admin' || $current_role === 'org') {
        if (($lead['org_id'] ?? null) !== $current_org_id) respond(['error' => 'Forbidden'], 403);
    } elseif ($current_role !== 'super_admin') {
        respond(['error' => 'Forbidden'], 403);
    }
    respond(['success' => true, 'lead' => $lead]);
}

if ($action === 'all_leads' && $method === 'GET') {
    if ($current_role === 'hr') respond(['success' => false, 'message' => 'Access denied'], 403);
    if (!in_array($current_role, ['super_admin', 'admin', 'org'], true)) respond(['success' => false, 'message' => 'Access denied'], 403);
    [$page, $limit, $offset] = parsePage();
    $where = "a.deleted_at IS NULL";
    $params = [];
    if ($current_role === 'admin' || $current_role === 'org') {
        $where .= " AND a.org_id = ?";
        $params[] = $current_org_id;
    } elseif ($current_role === 'super_admin' && !empty($_GET['org_id']) && $_GET['org_id'] !== 'all') {
        $where .= " AND a.org_id = ?";
        $params[] = $_GET['org_id'];
    }
    if (!empty($_GET['hr_id'])) { $where .= " AND a.hr_id = ?"; $params[] = $_GET['hr_id']; }
    if (isset($_GET['is_assigned']) && $_GET['is_assigned'] !== '') { $where .= " AND a.is_assigned = ?"; $params[] = (int) $_GET['is_assigned']; }
    if (!empty($_GET['status']) && $_GET['status'] !== 'all') { $where .= " AND a.status = ?"; $params[] = $_GET['status']; }
    if (!empty($_GET['source']) && $_GET['source'] !== 'all') { $where .= " AND a.source = ?"; $params[] = $_GET['source']; }
    if (!empty($_GET['search'])) { $where .= " AND (a.full_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ?)"; $s = '%' . $_GET['search'] . '%'; $params[] = $s; $params[] = $s; $params[] = $s; }
    $dateFrom = trim((string) ($_GET['date_from'] ?? ''));
    $dateTo = trim((string) ($_GET['date_to'] ?? ''));
    if ($dateFrom !== '') {
        $where .= " AND DATE(a.created_at) >= ?";
        $params[] = $dateFrom;
    }
    if ($dateTo !== '') {
        $where .= " AND DATE(a.created_at) <= ?";
        $params[] = $dateTo;
    }
    $c = $db->prepare("SELECT COUNT(*) c FROM hr_leads a WHERE $where");
    $c->execute($params);
    $total = (int) (($c->fetch()['c'] ?? 0));
    $stmt = $db->prepare("SELECT a.*, h.full_name as hr_name, ab.full_name as assigned_by_name, o.name as org_name FROM hr_leads a LEFT JOIN users h ON h.id = a.hr_id LEFT JOIN users ab ON ab.id = a.assigned_by LEFT JOIN organizations o ON o.id = a.org_id WHERE $where ORDER BY a.created_at DESC LIMIT $limit OFFSET $offset");
    $stmt->execute($params);
    $u = $db->prepare("SELECT COUNT(*) c FROM hr_leads a WHERE $where AND a.is_assigned = 0");
    $u->execute($params);
    $unassigned = (int) (($u->fetch()['c'] ?? 0));
    $rows = $stmt->fetchAll();
    respond(['success' => true, 'leads' => $rows, 'data' => $rows, 'total' => $total, 'unassigned' => $unassigned, 'page' => $page, 'limit' => $limit]);
}

/**
 * Validate and apply a single hr_leads assignment. Returns assoc array describing the outcome.
 * Org rules:
 *  - admin: lead.org_id and hr.org_id must both equal admin's org.
 *  - super_admin: lead.org_id and hr.org_id must match each other (no cross-org assignments).
 */
function hrLeadsApplyAssignment(PDO $db, string $currentRole, ?string $currentOrgId, string $currentUserId, int $leadId, string $hrId): array {
    if ($leadId <= 0 || $hrId === '') {
        return ['ok' => false, 'id' => $leadId, 'error' => 'id and hr_id required'];
    }

    $chk = $db->prepare("SELECT id, role, org_id FROM users WHERE id = ? AND is_active = 1");
    $chk->execute([$hrId]);
    $hr = $chk->fetch();
    if (!$hr || normalizeRole((string) ($hr['role'] ?? '')) !== 'hr') {
        return ['ok' => false, 'id' => $leadId, 'error' => 'Invalid HR user'];
    }

    $leadStmt = $db->prepare("SELECT id, org_id FROM hr_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1");
    $leadStmt->execute([$leadId]);
    $lead = $leadStmt->fetch();
    if (!$lead) {
        return ['ok' => false, 'id' => $leadId, 'error' => 'Lead not found'];
    }

    $leadOrgId = $lead['org_id'] ?? null;
    $hrOrgId = $hr['org_id'] ?? null;

    if ($currentRole === 'admin') {
        if ($leadOrgId !== $currentOrgId || $hrOrgId !== $currentOrgId) {
            return ['ok' => false, 'id' => $leadId, 'error' => 'Access denied'];
        }
    } elseif ($currentRole === 'super_admin') {
        if ($leadOrgId !== $hrOrgId) {
            return ['ok' => false, 'id' => $leadId, 'error' => 'HR and lead belong to different organisations'];
        }
    }

    $upd = $db->prepare("UPDATE hr_leads SET hr_id = ?, is_assigned = 1, assigned_by = ? WHERE id = ? AND deleted_at IS NULL");
    $upd->execute([$hrId, $currentUserId, $leadId]);

    try {
        $n = $db->prepare("INSERT INTO notifications (id, user_id, title, message, type, is_read, org_id) VALUES (?, ?, ?, ?, 'lead_assigned', 0, ?)");
        $n->execute([generateUUID(), $hrId, 'New lead assigned', 'A lead has been assigned to you in HR Leads.', $leadOrgId]);
    } catch (Throwable $e) {
        /* notification failure must not block the assignment */
    }

    return ['ok' => true, 'id' => $leadId, 'hr_id' => $hrId];
}

if ($action === 'assign_lead' && $method === 'PUT') {
    if (!in_array($current_role, ['super_admin', 'admin'], true)) respond(['success' => false, 'message' => 'Access denied'], 403);
    $id = (int) ($input['id'] ?? 0);
    $hrId = trim((string) ($input['hr_id'] ?? ''));
    $res = hrLeadsApplyAssignment($db, $current_role, $current_org_id, $current_user_id, $id, $hrId);
    if (!$res['ok']) {
        $status = ($res['error'] === 'Access denied') ? 403 : 400;
        respond(['success' => false, 'message' => $res['error']], $status);
    }
    respond(['success' => true, 'message' => 'Lead assigned']);
}

if ($action === 'bulk_assign_leads' && $method === 'POST') {
    if (!in_array($current_role, ['super_admin', 'admin'], true)) respond(['success' => false, 'message' => 'Access denied'], 403);
    $assignments = $input['assignments'] ?? [];
    if (!is_array($assignments) || empty($assignments)) {
        respond(['success' => false, 'message' => 'assignments array required'], 400);
    }
    $results = [];
    $ok = 0;
    $failed = 0;
    foreach ($assignments as $row) {
        $leadId = (int) ($row['id'] ?? 0);
        $hrId = trim((string) ($row['hr_id'] ?? ''));
        $r = hrLeadsApplyAssignment($db, $current_role, $current_org_id, $current_user_id, $leadId, $hrId);
        $results[] = $r;
        if (!empty($r['ok'])) {
            $ok++;
        } else {
            $failed++;
        }
    }
    respond([
        'success' => $failed === 0,
        'assigned' => $ok,
        'failed' => $failed,
        'total' => count($assignments),
        'results' => $results,
    ]);
}

if ($action === 'lead_stats' && $method === 'GET') {
    if ($current_role === 'hr') respond(['success' => false, 'message' => 'Access denied'], 403);
    if (!in_array($current_role, ['super_admin', 'admin', 'org'], true)) respond(['success' => false, 'message' => 'Access denied'], 403);
    $where = "deleted_at IS NULL";
    $params = [];
    if ($current_role === 'admin' || $current_role === 'org') { $where .= " AND org_id = ?"; $params[] = $current_org_id; }
    elseif ($current_role === 'super_admin' && !empty($_GET['org_id']) && $_GET['org_id'] !== 'all') { $where .= " AND org_id = ?"; $params[] = $_GET['org_id']; }

    $qTotal = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE $where");
    $qTotal->execute($params);
    $total = (int) (($qTotal->fetch()['c'] ?? 0));

    $byStatus = ['new' => 0, 'contacted' => 0, 'interested' => 0, 'not_interested' => 0, 'converted' => 0, 'lost' => 0];
    $qStatus = $db->prepare("SELECT status, COUNT(*) c FROM hr_leads WHERE $where GROUP BY status");
    $qStatus->execute($params);
    foreach ($qStatus->fetchAll() as $r) $byStatus[$r['status']] = (int) $r['c'];

    $qWeek = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE $where AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    $qWeek->execute($params);
    $thisWeek = (int) (($qWeek->fetch()['c'] ?? 0));

    $qMonth = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE $where AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
    $qMonth->execute($params);
    $thisMonth = (int) (($qMonth->fetch()['c'] ?? 0));
    $qUnassigned = $db->prepare("SELECT COUNT(*) c FROM hr_leads WHERE $where AND is_assigned = 0");
    $qUnassigned->execute($params);
    $unassigned = (int) (($qUnassigned->fetch()['c'] ?? 0));

    $qHr = $db->prepare("SELECT a.hr_id, u.full_name as hr_name, COUNT(*) as count FROM hr_leads a LEFT JOIN users u ON u.id = a.hr_id WHERE a.deleted_at IS NULL" . (($current_role === 'admin' || $current_role === 'org') ? " AND a.org_id = ?" : "") . " GROUP BY a.hr_id, u.full_name ORDER BY count DESC");
    $qHr->execute(($current_role === 'admin' || $current_role === 'org') ? [$current_org_id] : []);

    respond([
        'success' => true,
        'total' => $total,
        'by_status' => $byStatus,
        'unassigned' => $unassigned,
        'this_week' => $thisWeek,
        'this_month' => $thisMonth,
        'stats' => ['total' => $total, 'by_status' => $byStatus, 'unassigned' => $unassigned, 'this_week' => $thisWeek, 'this_month' => $thisMonth, 'by_hr' => $qHr->fetchAll()]
    ]);
}

respond(['error' => 'Invalid action'], 400);
