<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/Timetables.php';
cors();

$db = (new Database())->getConnection();
timetablesEnsureSchema($db);
$tokenData = verifyToken();
timetablesRequireAccess($tokenData);

$method = $_SERVER['REQUEST_METHOD'];
$action = trim((string) ($_GET['action'] ?? ''));
$id = trim((string) ($_GET['id'] ?? ''));
$userId = (string) ($tokenData['user_id'] ?? '');

if ($method === 'GET' && $action === 'students') {
    $batchId = trim((string) ($_GET['batch_id'] ?? ''));
    if ($batchId === '') {
        respond(['error' => 'batch_id required'], 400);
    }
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $st = $db->prepare(
        "SELECT id, name, email, phone FROM students
         WHERE batch_id = ? AND org_id = ?
           AND email IS NOT NULL AND TRIM(email) <> ''
           AND LOWER(TRIM(COALESCE(status, 'active'))) NOT IN ('dropped', 'inactive', 'deleted')
         ORDER BY name ASC"
    );
    $st->execute([$batchId, $orgId]);
    respond(['data' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
}

if ($method === 'GET' && $action === 'preview' && $id !== '') {
    $row = timetablesFetchOne($db, $tokenData, $id);
    if (!$row) {
        respond(['error' => 'Timetable not found'], 404);
    }
    $orgId = (string) ($row['org_id'] ?? '');
    $sessions = timetablesFetchSessions($db, $id);
    $branding = timetablesFetchOrgBranding($db, $orgId);
    $html = timetablesBuildPosterHtml($branding, (string) ($row['title'] ?? ''), $sessions);
    respond(['html' => $html, 'data' => $row, 'sessions' => $sessions]);
}

if ($method === 'GET' && ($action === 'get' || $id !== '') && $action !== 'list') {
    $fetchId = $id !== '' ? $id : trim((string) ($_GET['timetable_id'] ?? ''));
    if ($fetchId === '') {
        respond(['error' => 'id required'], 400);
    }
    $row = timetablesFetchOne($db, $tokenData, $fetchId);
    if (!$row) {
        respond(['error' => 'Timetable not found'], 404);
    }
    $row['sessions'] = timetablesFetchSessions($db, $fetchId);
    respond(['data' => $row]);
}

if ($method === 'GET') {
    $org = orgFilter($tokenData, 't', $db);
    $st = $db->prepare("
        SELECT t.*, b.name AS batch_name, c.name AS course_name,
               (SELECT COUNT(*) FROM timetable_sessions ts WHERE ts.timetable_id = t.id) AS session_count,
               (SELECT COUNT(*) FROM timetable_sends ts2 WHERE ts2.timetable_id = t.id) AS send_count
        FROM timetables t
        LEFT JOIN batches b ON t.batch_id = b.id
        LEFT JOIN courses c ON t.course_id = c.id
        WHERE {$org['where']}
        ORDER BY t.period_start DESC, t.updated_at DESC
        LIMIT 500
    ");
    $st->execute($org['params']);
    respond(['data' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
}

if ($method === 'POST' && $action === 'send' && $id !== '') {
    $row = timetablesFetchOne($db, $tokenData, $id);
    if (!$row) {
        respond(['error' => 'Timetable not found'], 404);
    }
    $input = getInput();
    if (!is_array($input)) {
        $input = [];
    }
    $recipients = $input['recipients'] ?? [];
    if (!is_array($recipients) || count($recipients) === 0) {
        respond(['error' => 'At least one recipient is required'], 400);
    }
    $subject = trim((string) ($input['subject'] ?? ''));
    if ($subject === '') {
        $subject = trim((string) ($row['title'] ?? 'Class Timetable'));
        if ($subject === '') {
            $subject = 'Offline Class Timetable';
        }
    }
    $orgId = (string) ($row['org_id'] ?? '');
    $sessions = timetablesFetchSessions($db, $id);
    $branding = timetablesFetchOrgBranding($db, $orgId);
    $html = timetablesBuildPosterHtml($branding, (string) ($row['title'] ?? ''), $sessions);
    $batchId = trim((string) ($input['batch_id'] ?? ''));

    syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'timetables');
    $fromAddr = syncpediaHrMailAddress();
    $fromName = trim((string) ($branding['org_name'] ?? 'Syncpedia'));

    $sent = 0;
    $failed = [];
    $ins = $db->prepare(
        'INSERT INTO timetable_sends (id, timetable_id, recipient_email, recipient_name, batch_id, status, sent_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    foreach ($recipients as $r) {
        if (!is_array($r)) {
            continue;
        }
        $email = strtolower(trim((string) ($r['email'] ?? '')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $name = trim((string) ($r['name'] ?? ''));
        $res = syncpediaSendHtmlEmailWithFrom(
            $email,
            $subject,
            $html,
            $fromAddr,
            $fromName,
            'timetables',
        );
        if (!empty($res['ok'])) {
            $sent++;
            $ins->execute([
                generateUUID(),
                $id,
                $email,
                $name !== '' ? $name : null,
                $batchId !== '' ? $batchId : null,
                'sent',
                $userId !== '' ? $userId : null,
            ]);
        } else {
            $failed[] = ['email' => $email, 'error' => (string) ($res['error'] ?? 'Send failed')];
        }
    }

    if ($sent === 0) {
        respond([
            'error' => 'Could not send to any recipient',
            'failed' => $failed,
        ], 500);
    }

    respond([
        'message' => "Timetable sent to {$sent} recipient(s)",
        'sent' => $sent,
        'failed' => $failed,
    ]);
}

if ($method === 'POST') {
    $input = getInput();
    if (!is_array($input)) {
        $input = [];
    }
    $title = trim((string) ($input['title'] ?? 'Class Timetable'));
    if ($title === '') {
        $title = 'Class Timetable';
    }
    $anchor = trim((string) ($input['period_start'] ?? $input['anchor_date'] ?? ''));
    if ($anchor === '') {
        respond(['error' => 'period_start is required'], 400);
    }
    $period = timetablesNormalizePeriod((string) ($input['period_type'] ?? 'week'), $anchor);
    $orgId = resolveCreatorOrgId($db, $tokenData);
    $batchId = trim((string) ($input['batch_id'] ?? ''));
    $courseId = trim((string) ($input['course_id'] ?? ''));
    if ($batchId !== '') {
        $bst = $db->prepare('SELECT course_id FROM batches WHERE id = ? AND org_id = ? LIMIT 1');
        $bst->execute([$batchId, $orgId]);
        $bc = $bst->fetchColumn();
        if ($bc) {
            $courseId = (string) $bc;
        }
    }
    $tid = generateUUID();
    $db->prepare(
        'INSERT INTO timetables (id, org_id, title, period_type, period_start, period_end, batch_id, course_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $tid,
        $orgId,
        $title,
        $period['period_type'],
        $period['period_start'],
        $period['period_end'],
        $batchId !== '' ? $batchId : null,
        $courseId !== '' ? $courseId : null,
        $userId !== '' ? $userId : null,
    ]);
    $sessions = $input['sessions'] ?? [];
    if (is_array($sessions)) {
        timetablesReplaceSessions($db, $tid, $sessions);
    }
    $row = timetablesFetchOne($db, $tokenData, $tid);
    if ($row) {
        $row['sessions'] = timetablesFetchSessions($db, $tid);
    }
    respond(['id' => $tid, 'message' => 'Timetable created', 'data' => $row], 201);
}

if ($method === 'PUT' && $id !== '') {
    $row = timetablesFetchOne($db, $tokenData, $id);
    if (!$row) {
        respond(['error' => 'Timetable not found'], 404);
    }
    $input = getInput();
    if (!is_array($input)) {
        $input = [];
    }
    $sets = [];
    $params = [];
    if (array_key_exists('title', $input)) {
        $sets[] = 'title = ?';
        $params[] = trim((string) $input['title']) ?: 'Class Timetable';
    }
    if (array_key_exists('period_type', $input) || array_key_exists('period_start', $input)) {
        $ptype = (string) ($input['period_type'] ?? $row['period_type'] ?? 'week');
        $anchor = trim((string) ($input['period_start'] ?? $row['period_start'] ?? ''));
        if ($anchor !== '') {
            $period = timetablesNormalizePeriod($ptype, $anchor);
            $sets[] = 'period_type = ?';
            $params[] = $period['period_type'];
            $sets[] = 'period_start = ?';
            $params[] = $period['period_start'];
            $sets[] = 'period_end = ?';
            $params[] = $period['period_end'];
        }
    }
    if (array_key_exists('batch_id', $input)) {
        $batchId = trim((string) ($input['batch_id'] ?? ''));
        $sets[] = 'batch_id = ?';
        $params[] = $batchId !== '' ? $batchId : null;
        if ($batchId !== '') {
            $orgId = (string) ($row['org_id'] ?? '');
            $bst = $db->prepare('SELECT course_id FROM batches WHERE id = ? AND org_id = ? LIMIT 1');
            $bst->execute([$batchId, $orgId]);
            $bc = $bst->fetchColumn();
            if ($bc) {
                $sets[] = 'course_id = ?';
                $params[] = (string) $bc;
            }
        }
    }
    if (array_key_exists('course_id', $input)) {
        $courseId = trim((string) ($input['course_id'] ?? ''));
        $sets[] = 'course_id = ?';
        $params[] = $courseId !== '' ? $courseId : null;
    }
    if ($sets) {
        $params[] = $id;
        $db->prepare('UPDATE timetables SET ' . implode(', ', $sets) . ', updated_at = CURRENT_TIMESTAMP WHERE id = ?')->execute($params);
    }
    if (array_key_exists('sessions', $input) && is_array($input['sessions'])) {
        timetablesReplaceSessions($db, $id, $input['sessions']);
    }
    $updated = timetablesFetchOne($db, $tokenData, $id);
    if ($updated) {
        $updated['sessions'] = timetablesFetchSessions($db, $id);
    }
    respond(['message' => 'Timetable updated', 'data' => $updated]);
}

if ($method === 'DELETE' && $id !== '') {
    $row = timetablesFetchOne($db, $tokenData, $id);
    if (!$row) {
        respond(['error' => 'Timetable not found'], 404);
    }
    $db->prepare('DELETE FROM timetable_sends WHERE timetable_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM timetable_sessions WHERE timetable_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM timetables WHERE id = ?')->execute([$id]);
    respond(['message' => 'Timetable deleted']);
}

respond(['error' => 'Invalid request'], 400);
