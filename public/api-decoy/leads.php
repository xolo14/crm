<?php
/**
 * DECOY-ONLY leads list + CSV export (masked). Separate DB only.
 */
require_once __DIR__ . '/helpers.php';
decoyCors();

$db = (new DecoyDatabase())->getConnection();
decoyEnsureSchema($db);
$user = decoyRequireAuth($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));

if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
    if ($limit < 1) {
        $limit = 50;
    }
    if ($limit > 200) {
        $limit = 200;
    }
    $offset = isset($_GET['offset']) ? (int) $_GET['offset'] : 0;
    if ($offset < 0) {
        $offset = 0;
    }
    $search = trim((string) ($_GET['search'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? ''));

    $where = '1=1';
    $params = [];
    if ($status !== '' && $status !== 'all') {
        $where .= ' AND status = ?';
        $params[] = $status;
    }
    if ($search !== '') {
        $where .= ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
        $s = '%' . $search . '%';
        $params[] = $s;
        $params[] = $s;
        $params[] = $s;
    }

    $cst = $db->prepare("SELECT COUNT(*) FROM decoy_leads WHERE {$where}");
    $cst->execute($params);
    $total = (int) $cst->fetchColumn();

    $st = $db->prepare(
        "SELECT id, name, email, phone, source, status, company, created_at
         FROM decoy_leads WHERE {$where}
         ORDER BY created_at DESC
         LIMIT {$limit} OFFSET {$offset}"
    );
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $masked = array_map('decoyMaskLeadRow', $rows);

    decoyRespond([
        'data' => $masked,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
    ]);
}

if ($method === 'GET' && $action === 'export') {
    decoyAlert('export_csv', [
        'decoy_user' => (string) ($user['email'] ?? ''),
        'session_id' => null,
    ]);

    $filename = 'leads_export_' . date('Y-m-d') . '.csv';
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-store');

    $out = fopen('php://output', 'w');
    if ($out === false) {
        decoyRespond(['error' => 'Export failed'], 500);
    }
    fprintf($out, chr(0xEF) . chr(0xBB) . chr(0xBF));
    fputcsv($out, ['id', 'name', 'email', 'phone', 'source', 'status', 'company', 'created_at']);

    $st = $db->query(
        'SELECT id, name, email, phone, source, status, company, created_at
         FROM decoy_leads ORDER BY created_at DESC'
    );
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        $m = decoyMaskLeadRow($row);
        fputcsv($out, [
            $m['id'] ?? '',
            $m['name'] ?? '',
            $m['email'] ?? '',
            $m['phone'] ?? '',
            $m['source'] ?? '',
            $m['status'] ?? '',
            $m['company'] ?? '',
            $m['created_at'] ?? '',
        ]);
    }
    fclose($out);
    exit;
}

decoyRespond(['error' => 'Method not allowed'], 405);
