<?php
/**
 * Payment candidates — pitch price + installments per rep (org-scoped).
 *
 * GET ?action=list&owner_user_id=   — candidates with totals (role-scoped)
 * GET ?action=detail&id=            — one candidate + installment lines
 * GET ?action=lookup&email=&phone=  — match existing candidate for current user only
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/PaymentCandidates.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? 'list'));

paymentCandidatesEnsureSchema($db);

$scope = paymentCandidatesListScope($db, $tokenData);
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$userId = trim((string) ($tokenData['user_id'] ?? ''));

if ($method === 'PUT') {
    $input = getInput();
    $action = trim((string) ($_GET['action'] ?? ($input['action'] ?? 'update_pitch')));
    if ($action !== 'update_pitch') {
        respond(['error' => 'Invalid action'], 400);
    }
    $id = trim((string) ($_GET['id'] ?? ($input['id'] ?? '')));
    if ($id === '') {
        respond(['error' => 'id is required'], 400);
    }
    if (!array_key_exists('pitch_price', $input)) {
        respond(['error' => 'pitch_price is required'], 400);
    }
    $pitch = round((float) $input['pitch_price'], 2);
    if ($pitch < 0) {
        respond(['error' => 'pitch_price must be 0 or greater'], 400);
    }

    $st = $db->prepare("SELECT pc.*, u.full_name AS owner_name FROM payment_candidates pc
        LEFT JOIN users u ON u.id = pc.owner_user_id
        WHERE pc.id = ? AND {$scope['sql']} LIMIT 1");
    $st->execute(array_merge([$id], $scope['params']));
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    if (!paymentCandidatesCanEditPitch($tokenData, $row)) {
        respond(['error' => 'Forbidden — only the rep who owns this candidate or an org admin can edit pitch'], 403);
    }

    $db->prepare('UPDATE payment_candidates SET pitch_price = ? WHERE id = ?')->execute([$pitch, $id]);
    $row['pitch_price'] = $pitch;
    paymentCandidatesSyncPitchFromLinks($db, $id);
    $st = $db->prepare("SELECT pc.*, u.full_name AS owner_name FROM payment_candidates pc
        LEFT JOIN users u ON u.id = pc.owner_user_id
        WHERE pc.id = ? LIMIT 1");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: $row;
    $totals = paymentCandidatesTotalsForRow($db, $row);
    respond([
        'message' => 'Pitch price updated',
        'data' => array_merge($row, $totals, [
            'installments' => paymentCandidatesFetchInstallments($db, $id),
        ]),
    ]);
 }

if ($method !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
 }

if ($action === 'lookup') {
    $orgId = resolveCreatorOrgId($db, $tokenData);
    if ($orgId === null || $orgId === '') {
        respond(['data' => null]);
    }
    $ownerId = $userId;
    if (!$scope['owner_only']) {
        $filterOwner = trim((string) ($_GET['owner_user_id'] ?? ''));
        if ($filterOwner !== '') {
            $ownerId = $filterOwner;
        }
    }
    $email = trim((string) ($_GET['email'] ?? ''));
    $phone = trim((string) ($_GET['phone'] ?? ''));
    $row = paymentCandidatesFindExisting($db, (string) $orgId, $ownerId, $email, $phone);
    if (!$row) {
        respond(['data' => null]);
    }
    $totals = paymentCandidatesTotalsForRow($db, $row);
    respond([
        'data' => array_merge($row, $totals, [
            'next_installment' => paymentCandidatesNextInstallmentNumber($db, (string) $row['id']),
        ]),
    ]);
 }

if ($action === 'detail') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id is required'], 400);
    }
    $st = $db->prepare("SELECT pc.*, u.full_name AS owner_name FROM payment_candidates pc
        LEFT JOIN users u ON u.id = pc.owner_user_id
        WHERE pc.id = ? AND {$scope['sql']} LIMIT 1");
    $st->execute(array_merge([$id], $scope['params']));
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    $totals = paymentCandidatesTotalsForRow($db, $row);
    respond([
        'data' => array_merge($row, $totals, [
            'installments' => paymentCandidatesFetchInstallments($db, $id),
        ]),
    ]);
 }

if ($action === 'list' || $action === '') {
    // Migrate legacy payment links / manuals into candidates so old records appear.
    $orgForBackfill = resolveCreatorOrgId($db, $tokenData);
    $ownersForBackfill = null;
    if ($scope['owner_only']) {
        $ownersForBackfill = [$userId !== '' ? $userId : '__none__'];
    } elseif ($role === 'manager') {
        $ownersForBackfill = hierarchyGetVisibleUserIds($db, $tokenData);
        if (empty($ownersForBackfill) && $userId !== '') {
            $ownersForBackfill = [$userId];
        }
    }
    $filterOwner = trim((string) ($_GET['owner_user_id'] ?? ''));
    if ($filterOwner !== '' && !$scope['owner_only']) {
        $ownersForBackfill = [$filterOwner];
    }
    // Throttle legacy backfill — running on every list under parallel page loads
    // exhausts Hostinger MySQL connections (cascading 500s across APIs).
    $backfillKey = 'pc_bf_' . md5(
        ($orgForBackfill !== null && $orgForBackfill !== '' ? (string) $orgForBackfill : 'all')
        . '|' . (is_array($ownersForBackfill) ? implode(',', $ownersForBackfill) : '*')
    );
    $backfillFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . $backfillKey;
    $backfillDue = true;
    try {
        if (is_file($backfillFile) && (time() - (int) filemtime($backfillFile)) < 300) {
            $backfillDue = false;
        }
    } catch (Throwable $e) {
        $backfillDue = true;
    }
    if ($backfillDue) {
        try {
            paymentCandidatesBackfillLegacy(
                $db,
                $orgForBackfill !== null && $orgForBackfill !== '' ? (string) $orgForBackfill : null,
                $ownersForBackfill,
            );
            @file_put_contents($backfillFile, (string) time());
        } catch (Throwable $e) {
            error_log('[payment_candidates] backfill on list: ' . $e->getMessage());
        }
    }

    $where = $scope['sql'];
    $params = $scope['params'];

    if ($filterOwner !== '' && !$scope['owner_only']) {
        $where .= ' AND pc.owner_user_id = ?';
        $params[] = $filterOwner;
    } elseif ($scope['owner_only']) {
        // L1 always own only
    }

    $search = strtolower(trim((string) ($_GET['search'] ?? '')));
    $fromUnix = isset($_GET['from']) && $_GET['from'] !== '' ? (int) $_GET['from'] : null;
    $toUnix = isset($_GET['to']) && $_GET['to'] !== '' ? (int) $_GET['to'] : null;
    if ($fromUnix !== null && $fromUnix <= 0) {
        $fromUnix = null;
    }
    if ($toUnix !== null && $toUnix <= 0) {
        $toUnix = null;
    }
    $periodScoped = $fromUnix !== null || $toUnix !== null;

    $sql = "SELECT pc.*, u.full_name AS owner_name
            FROM payment_candidates pc
            LEFT JOIN users u ON u.id = pc.owner_user_id
            WHERE {$where}
            ORDER BY pc.updated_at DESC, pc.customer_name ASC
            LIMIT 500";
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $hideUnpaidForm = paymentCandidatesUnpaidLeadFormOnlyIds($db, $rows);

    $out = [];
    $kpi = [
        'candidate_count' => 0,
        'total_pitch' => 0.0,
        'total_paid' => 0.0,
        'total_remaining' => 0.0,
        'cleared_count' => 0,
        'enrolled_count' => 0,
    ];

    foreach ($rows as $row) {
        if (!empty($hideUnpaidForm[(string) ($row['id'] ?? '')])) {
            continue;
        }
        if ($search !== '') {
            $hay = strtolower(
                ($row['customer_name'] ?? '') . ' ' .
                ($row['customer_email'] ?? '') . ' ' .
                ($row['customer_phone'] ?? '') . ' ' .
                ($row['owner_name'] ?? '')
            );
            if (strpos($hay, $search) === false) {
                continue;
            }
        }
        $totals = paymentCandidatesTotalsForRow($db, $row, $fromUnix, $toUnix);
        $merged = array_merge($row, $totals);
        $merged['pitch_price'] = (float) ($totals['pitch_price'] ?? 0);
        $merged['total_paid'] = (float) ($totals['total_paid'] ?? 0);
        $merged['remaining'] = (float) ($totals['remaining'] ?? 0);
        if ($periodScoped && empty($totals['first_installment_date'])) {
            continue;
        }
        $out[] = $merged;
        $kpi['candidate_count']++;
        $kpi['total_pitch'] += (float) $totals['pitch_price'];
        $kpi['total_paid'] += (float) $totals['total_paid'];
 if ($periodScoped) {
 $periodPaid = (float) ($totals['total_paid'] ?? 0);
 $periodPitch = (float) ($totals['pitch_price'] ?? 0);
 $kpi['total_remaining'] += (float) max(0, round($periodPitch - $periodPaid, 2));
 if ($periodPaid + 0.001 >= $periodPitch && $periodPitch > 0) {
 $kpi['cleared_count']++;
 }
 } else {
 $kpi['total_remaining'] += (float) $totals['remaining'];
 if ($totals['status'] === 'cleared') {
 $kpi['cleared_count']++;
 }
 }
 if (!empty($totals['enrolled'])) {
 $kpi['enrolled_count']++;
 }
    }

    $kpi['total_pitch'] = round($kpi['total_pitch'], 2);
    $kpi['total_paid'] = round($kpi['total_paid'], 2);
    $kpi['total_remaining'] = round($kpi['total_remaining'], 2);

    respond(['data' => $out, 'kpi' => $kpi]);
 }

respond(['error' => 'Invalid action'], 400);
