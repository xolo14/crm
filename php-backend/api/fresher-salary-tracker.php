<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

/** Roles that manage fresher salary tracker (aligned with Team page). */
function fsmAllowedRole(string $role): bool
{
    return in_array($role, ['super_admin', 'admin', 'manager'], true);
}

function fsmEnsureTable(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS `fresher_salary_members` (
          `id` CHAR(36) NOT NULL,
          `org_id` CHAR(36) DEFAULT NULL,
          `payload` LONGTEXT NOT NULL,
          `created_by` CHAR(36) DEFAULT NULL,
          `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `idx_fsm_org` (`org_id`),
          KEY `idx_fsm_updated` (`updated_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $done = true;
}

function fsmDecodePayload($raw): ?array
{
    if (is_array($raw)) {
        return $raw;
    }
    $s = is_string($raw) ? $raw : '';
    if ($s === '') {
        return null;
    }
    $j = json_decode($s, true);
    return is_array($j) ? $j : null;
}

fsmEnsureTable($db);

if (!fsmAllowedRole($role)) {
    respond(['error' => 'Access denied'], 403);
}

// ---------- GET list ----------
if ($method === 'GET') {
    $org = orgFilter($tokenData, 'fsm');
    $sql = "SELECT id, org_id, payload, created_by, created_at, updated_at FROM fresher_salary_members fsm WHERE {$org['where']} ORDER BY fsm.updated_at DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($org['params']);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $members = [];
    foreach ($rows as $row) {
        $p = fsmDecodePayload($row['payload'] ?? '');
        if (!$p || empty($p['id'])) {
            continue;
        }
        $members[] = $p;
    }
    respond(['data' => $members]);
}

$input = getInput();

// ---------- POST send training invite (email only) ----------
if ($method === 'POST') {
    $action = strtolower(trim((string) ($_GET['action'] ?? '')));
    if ($action === 'send_training_invite') {
        $email = trim((string) ($input['email'] ?? ''));
        $fullName = trim((string) ($input['full_name'] ?? ''));
        $joining = trim((string) ($input['joining_date'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(['error' => 'Valid email is required'], 400);
        }
        if ($fullName === '') {
            respond(['error' => 'full_name is required'], 400);
        }
        $html = syncpediaBuildFresherTrainingInviteEmailHtml($fullName, $joining);
        $subject = 'Welcome to Syncpedia fresher training';
        $sent = syncpediaSendHtmlEmail($email, $subject, $html);
        if (!(($sent['ok'] ?? false) === true)) {
            respond(['error' => $sent['error'] ?? 'Could not send email'], 502);
        }
        respond(['success' => true, 'to' => $email]);
    }

    if ($action === 'register_trainee_join') {
        usersEnsureFresherTrainingJoinDateColumn($db);
        $tid = trim((string) ($input['trainee_user_id'] ?? ''));
        $jd = trim((string) ($input['joining_date'] ?? ''));
        if ($tid === '' || !preg_match('/^[0-9a-f-]{36}$/i', $tid)) {
            respond(['error' => 'trainee_user_id (UUID) is required'], 400);
        }
        $jd10 = substr($jd, 0, 10);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $jd10)) {
            respond(['error' => 'joining_date as YYYY-MM-DD is required'], 400);
        }
        $st = $db->prepare('SELECT id, org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$tid]);
        $tr = $st->fetch(PDO::FETCH_ASSOC);
        if (!$tr) {
            respond(['error' => 'Trainee not found'], 404);
        }
        $tokOrg = trim((string) ($tokenData['org_id'] ?? ''));
        $trOrg = trim((string) ($tr['org_id'] ?? ''));
        if (strtolower(trim((string) $role)) !== 'super_admin' && $tokOrg !== '' && $trOrg !== '' && $trOrg !== $tokOrg) {
            respond(['error' => 'Trainee is outside your organisation'], 403);
        }
        $up = $db->prepare('UPDATE users SET fresher_training_join_date = ? WHERE id = ?');
        $up->execute([$jd10, $tid]);
        respond(['success' => true, 'trainee_user_id' => $tid, 'joining_date' => $jd10]);
    }

    // ---------- POST create member row ----------
    $member = $input['member'] ?? $input;
    if (!is_array($member)) {
        respond(['error' => 'member object required'], 400);
    }
    $id = trim((string) ($member['id'] ?? ''));
    if ($id === '') {
        $id = generateUUID();
        $member['id'] = $id;
    }
    $name = trim((string) ($member['name'] ?? ''));
    if ($name === '') {
        respond(['error' => 'name is required'], 400);
    }

    $orgId = getOrgId($tokenData);
    $payload = json_encode($member, JSON_UNESCAPED_UNICODE);
    if ($payload === false) {
        respond(['error' => 'Invalid member payload'], 400);
    }

    try {
        $stmt = $db->prepare('INSERT INTO fresher_salary_members (id, org_id, payload, created_by) VALUES (?, ?, ?, ?)');
        $stmt->execute([$id, $orgId, $payload, $userId]);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate') !== false || strpos($e->getMessage(), '1062') !== false) {
            respond(['error' => 'Member id already exists'], 409);
        }
        respond(['error' => 'Could not save: ' . $e->getMessage()], 500);
    }

    respond(['data' => $member, 'message' => 'Created'], 201);
}

// ---------- PUT update ----------
if ($method === 'PUT') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $member = $input['member'] ?? $input;
    if (!is_array($member)) {
        respond(['error' => 'member object required'], 400);
    }
    $member['id'] = $id;

    $org = orgFilter($tokenData, 'fsm');
    $chk = $db->prepare("SELECT id FROM fresher_salary_members fsm WHERE fsm.id = ? AND {$org['where']} LIMIT 1");
    $chk->execute(array_merge([$id], $org['params']));
    if (!$chk->fetch()) {
        respond(['error' => 'Not found'], 404);
    }

    $payload = json_encode($member, JSON_UNESCAPED_UNICODE);
    if ($payload === false) {
        respond(['error' => 'Invalid member payload'], 400);
    }

    $stmt = $db->prepare('UPDATE fresher_salary_members SET payload = ? WHERE id = ?');
    $stmt->execute([$payload, $id]);

    respond(['data' => $member, 'message' => 'Updated']);
}

// ---------- DELETE ----------
if ($method === 'DELETE') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }

    $org = orgFilter($tokenData, 'fsm');
    $chk = $db->prepare("SELECT id FROM fresher_salary_members fsm WHERE fsm.id = ? AND {$org['where']} LIMIT 1");
    $chk->execute(array_merge([$id], $org['params']));
    if (!$chk->fetch()) {
        respond(['error' => 'Not found'], 404);
    }

    $stmt = $db->prepare('DELETE FROM fresher_salary_members WHERE id = ?');
    $stmt->execute([$id]);
    respond(['message' => 'Deleted']);
}

respond(['error' => 'Method not allowed'], 405);
