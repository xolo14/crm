<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

/** Roles that manage fresher salary tracker. */
function fsmAllowedRole(string $role): bool
{
    $r = syncpediaNormalizeRoleKey($role);
    return in_array($r, ['super_admin', 'admin', 'org', 'manager'], true);
}

/** Org policy edit: org admin / admin / super_admin only. */
function fsmPolicyEditRole(string $role): bool
{
    $r = syncpediaNormalizeRoleKey($role);
    return in_array($r, ['super_admin', 'admin', 'org'], true);
}

function fsmEnsureTable(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS fresher_salary_members (
          id CHAR(36) NOT NULL,
          org_id CHAR(36) DEFAULT NULL,
          payload TEXT NOT NULL,
          created_by CHAR(36) DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        )
    ");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_fsm_org ON fresher_salary_members (org_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_fsm_updated ON fresher_salary_members (updated_at)');
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

function fsmSyncTraineeJoinDate(PDO $db, string $traineeUserId, string $joiningDateYmd): void
{
    $tid = trim($traineeUserId);
    $jd10 = substr(trim($joiningDateYmd), 0, 10);
    if ($tid === '' || !preg_match('/^[0-9a-f-]{36}$/i', $tid)) {
        return;
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $jd10)) {
        return;
    }
    usersEnsureFresherTrainingJoinDateColumn($db);
    $up = $db->prepare('UPDATE users SET fresher_training_join_date = ? WHERE id = ?');
    $up->execute([$jd10, $tid]);
}

/**
 * @return array<string,mixed>
 */
function fsmBuildMyProgress(PDO $db, string $userId, ?string $orgId): array
{
    usersEnsureFresherTrainingJoinDateColumn($db);
    $policy = fresherLoadOrgPolicy($db, $orgId);
    $st = $db->prepare('SELECT fresher_training_join_date, org_id FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $urow = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $joinYmd = substr(trim((string) ($urow['fresher_training_join_date'] ?? '')), 0, 10);
    $userOrg = trim((string) ($urow['org_id'] ?? ''));
    $scopeOrg = ($orgId !== null && trim($orgId) !== '') ? trim($orgId) : ($userOrg !== '' ? $userOrg : null);
    if ($scopeOrg) {
        $policy = fresherLoadOrgPolicy($db, $scopeOrg);
    }

    $payload = fresherLoadTrackerPayloadByTraineeUserId($db, $userId, $scopeOrg);
    if ($payload === null && $scopeOrg !== null) {
        $payload = fresherLoadTrackerPayloadByTraineeUserId($db, $userId, null);
    }

    if (($joinYmd === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinYmd)) && is_array($payload)) {
        $fromPayload = substr(trim((string) ($payload['joiningDate'] ?? '')), 0, 10);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromPayload)) {
            $joinYmd = $fromPayload;
            fsmSyncTraineeJoinDate($db, $userId, $joinYmd);
        }
    }

    if ($joinYmd === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinYmd)) {
        return ['enrolled' => false, 'policy' => $policy];
    }

    if (is_array($payload)) {
        $payload = fresherAutoSyncMemberPayload($db, $payload, $policy, $scopeOrg);
        // Persist synced payload when member row exists
        if (!empty($payload['id'])) {
            try {
                $up = $db->prepare('UPDATE fresher_salary_members SET payload = ? WHERE id = ?');
                $up->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $payload['id']]);
            } catch (Throwable $e) {
            }
        }
    }

    $calendar = fresherComputePhaseFromJoinPolicy($joinYmd, $policy);
    if ($calendar === null) {
        return ['enrolled' => false, 'policy' => $policy];
    }

    $phaseKey = (string) ($calendar['phase_key'] ?? 'training');
    if ($phaseKey === 'pre_join') {
        $phaseKey = 'training';
    }
    $window = fresherPhaseWindowByKeyPolicy($joinYmd, $phaseKey === 'completed' ? 'completed' : $phaseKey, $policy);
    if ($window === null) {
        $window = $calendar;
    }

    $target = (int) ($window['target_rupees'] ?? 0);
    $mapKey = $phaseKey;
    if (preg_match('/^month(\d+)$/', $phaseKey, $mm) && (int) $mm[1] > 3) {
        $mapKey = 'month3';
    }
    $achieved = is_array($payload) ? fresherAchievedForPhaseKey($payload, $mapKey === 'pre_join' ? 'training' : $mapKey) : 0.0;
    $remaining = max(0.0, (float) $target - $achieved);
    $pct = $target > 0 ? round(($achieved / $target) * 1000) / 10 : 0.0;

    return [
        'enrolled' => true,
        'joining_date' => $joinYmd,
        'phase_key' => $phaseKey,
        'phase_label' => (string) ($window['label'] ?? $phaseKey),
        'window_start' => $window['window_start'] ?? null,
        'window_end_exclusive' => $window['window_end_exclusive'] ?? null,
        'target_rupees' => $target,
        'achieved_rupees' => $achieved,
        'remaining_rupees' => $remaining,
        'achievement_pct' => $pct,
        'salary_type' => is_array($payload) ? ($payload['salaryType'] ?? null) : null,
        'headline_status' => is_array($payload) ? ($payload['headlineStatus'] ?? null) : null,
        'tracker_phase' => is_array($payload) ? ($payload['currentPhase'] ?? null) : null,
        'member_name' => is_array($payload) ? ($payload['name'] ?? null) : null,
        'policy' => $policy,
        'member' => is_array($payload) ? $payload : null,
    ];
}

fsmEnsureTable($db);
fresherEnsurePolicyTable($db);

// ---------- GET my_progress (any authenticated user) ----------
if ($method === 'GET' && strtolower(trim((string) ($_GET['action'] ?? ''))) === 'my_progress') {
    $orgId = trim((string) ($tokenData['org_id'] ?? ''));
    respond(['data' => fsmBuildMyProgress($db, (string) $userId, $orgId !== '' ? $orgId : null)]);
}

// ---------- GET/PUT policy (admins) ----------
if (strtolower(trim((string) ($_GET['action'] ?? ''))) === 'policy') {
    if (!fsmAllowedRole($role)) {
        respond(['error' => 'Access denied'], 403);
    }
    $orgId = resolveWriteOrgId($db, $tokenData);
    if ($method === 'GET') {
        respond(['data' => fresherLoadOrgPolicy($db, $orgId)]);
    }
    if ($method === 'PUT' || $method === 'POST') {
        if (!fsmPolicyEditRole($role)) {
            respond(['error' => 'Only organisation admins can edit policy numbers'], 403);
        }
        if (!$orgId) {
            respond(['error' => 'Organisation required'], 400);
        }
        $input = getInput();
        $policy = is_array($input['policy'] ?? null) ? $input['policy'] : $input;
        $saved = fresherSaveOrgPolicy($db, (string) $orgId, is_array($policy) ? $policy : [], (string) $userId);
        syncpediaNotifyFresherPolicyChanged($db, (string) $userId, (string) $orgId);
        respond(['data' => $saved, 'message' => 'Policy saved']);
    }
    respond(['error' => 'Method not allowed'], 405);
}

if (!fsmAllowedRole($role)) {
    respond(['error' => 'Access denied'], 403);
}

// ---------- GET list (auto-sync phases + payment achieved) ----------
if ($method === 'GET') {
    $org = orgFilter($tokenData, 'fsm');
    $orgId = resolveWriteOrgId($db, $tokenData);
    $policy = fresherLoadOrgPolicy($db, $orgId);
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
        $rowOrg = trim((string) ($row['org_id'] ?? '')) ?: $orgId;
        $prevPhase = strtolower(trim((string) ($p['currentPhase'] ?? '')));
        $synced = fresherAutoSyncMemberPayload($db, $p, $policy, $rowOrg);
        $nextPhase = strtolower(trim((string) ($synced['currentPhase'] ?? '')));
        if ($prevPhase !== '' && $nextPhase !== '' && $prevPhase !== $nextPhase) {
            syncpediaNotifyFresherPhaseMoved(
                $db,
                (string) ($synced['name'] ?? ''),
                isset($synced['trainee_user_id']) ? (string) $synced['trainee_user_id'] : null,
                $prevPhase,
                $nextPhase,
                $rowOrg ? (string) $rowOrg : null,
            );
        }
        $enc = json_encode($synced, JSON_UNESCAPED_UNICODE);
        if ($enc !== false && $enc !== (string) ($row['payload'] ?? '')) {
            try {
                $up = $db->prepare('UPDATE fresher_salary_members SET payload = ? WHERE id = ?');
                $up->execute([$enc, $synced['id']]);
            } catch (Throwable $e) {
            }
        }
        $members[] = $synced;
    }
    respond(['data' => $members, 'policy' => $policy]);
}

$input = getInput();

// ---------- POST ----------
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
        $sent = syncpediaSendHtmlEmail($email, $subject, $html, 'hr_updates');
        if (!(($sent['ok'] ?? false) === true)) {
            respond(['error' => $sent['error'] ?? 'Could not send email'], 502);
        }
        respond(['success' => true, 'to' => $email]);
    }

    if ($action === 'register_trainee_join') {
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
        fsmSyncTraineeJoinDate($db, $tid, $jd10);
        respond(['success' => true, 'trainee_user_id' => $tid, 'joining_date' => $jd10]);
    }

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

    $orgId = resolveWriteOrgId($db, $tokenData);
    $policy = fresherLoadOrgPolicy($db, $orgId);
    $member = fresherAutoSyncMemberPayload($db, $member, $policy, $orgId);
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

    $tid = trim((string) ($member['trainee_user_id'] ?? ''));
    $jd = substr(trim((string) ($member['joiningDate'] ?? '')), 0, 10);
    if ($tid !== '' && $jd !== '') {
        fsmSyncTraineeJoinDate($db, $tid, $jd);
    }

    syncpediaNotifyFresherTrainingAdded(
        $db,
        (string) $userId,
        $name,
        $tid !== '' ? $tid : null,
        $orgId ? (string) $orgId : null,
    );

    respond(['data' => $member, 'message' => 'Created'], 201);
}

// ---------- PUT update (manual overrides — org admin only for achieved fields) ----------
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
    $chk = $db->prepare("SELECT id, payload, org_id FROM fresher_salary_members fsm WHERE fsm.id = ? AND {$org['where']} LIMIT 1");
    $chk->execute(array_merge([$id], $org['params']));
    $existing = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$existing) {
        respond(['error' => 'Not found'], 404);
    }

    $prev = fsmDecodePayload($existing['payload'] ?? '') ?: [];
    $manual = !empty($input['manual']) || !empty($member['manual_edit']);
    if ($manual && !fsmPolicyEditRole($role)) {
        respond(['error' => 'Only organisation admins can manually edit achieved amounts'], 403);
    }

    if ($manual) {
        $overrides = is_array($prev['manual_overrides'] ?? null) ? $prev['manual_overrides'] : [];
        $phases = $input['override_phases'] ?? ['training', 'month1', 'month2', 'month3'];
        if (!is_array($phases)) {
            $phases = ['training', 'month1', 'month2', 'month3'];
        }
        foreach ($phases as $ph) {
            $overrides[(string) $ph] = true;
        }
        $member['manual_overrides'] = $overrides;
    } else {
        $member['manual_overrides'] = $prev['manual_overrides'] ?? [];
    }

    $orgId = trim((string) ($existing['org_id'] ?? '')) ?: resolveWriteOrgId($db, $tokenData);
    $policy = fresherLoadOrgPolicy($db, $orgId);
    // Re-sync after merge so phase stays calendar-driven; respect manual_overrides.
    $prevPhase = strtolower(trim((string) ($prev['currentPhase'] ?? '')));
    $member = fresherAutoSyncMemberPayload($db, $member, $policy, $orgId);
    $nextPhase = strtolower(trim((string) ($member['currentPhase'] ?? '')));
    if ($prevPhase !== '' && $nextPhase !== '' && $prevPhase !== $nextPhase) {
        syncpediaNotifyFresherPhaseMoved(
            $db,
            (string) ($member['name'] ?? ''),
            isset($member['trainee_user_id']) ? (string) $member['trainee_user_id'] : null,
            $prevPhase,
            $nextPhase,
            $orgId ? (string) $orgId : null,
        );
    }

    $payload = json_encode($member, JSON_UNESCAPED_UNICODE);
    if ($payload === false) {
        respond(['error' => 'Invalid member payload'], 400);
    }

    $stmt = $db->prepare('UPDATE fresher_salary_members SET payload = ? WHERE id = ?');
    $stmt->execute([$payload, $id]);

    $tid = trim((string) ($member['trainee_user_id'] ?? ''));
    $jd = substr(trim((string) ($member['joiningDate'] ?? '')), 0, 10);
    if ($tid !== '' && $jd !== '') {
        fsmSyncTraineeJoinDate($db, $tid, $jd);
    }

    respond(['data' => $member, 'message' => 'Updated']);
}

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
