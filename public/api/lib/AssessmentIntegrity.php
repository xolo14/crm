<?php
/**
 * Attempt integrity trail for HR review. Never auto-fails scoring.
 */

function peaklyyIntegrityEnsureColumns(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN integrity_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec("ALTER TABLE peaklyy_attempts ADD COLUMN integrity_flag VARCHAR(16) NULL");
    } catch (Throwable $e) {
    }
}

function peaklyyIntegrityDecode($raw): array
{
    if (is_array($raw)) {
        return $raw;
    }
    if (!is_string($raw) || trim($raw) === '' || strcasecmp(trim($raw), 'null') === 0) {
        return [];
    }
    $tmp = json_decode($raw, true);
    return is_array($tmp) ? $tmp : [];
}

/** @return array{flag: string, signals: list<string>} */
function peaklyyIntegrityComputeFlag(array $s): array
{
    $independent = [];
    $tab = (int) ($s['tab_hides'] ?? 0);
    $hidden = (int) ($s['hidden_ms'] ?? 0);
    if ($tab >= 3 || $hidden >= 20000) {
        $independent[] = 'focus_loss';
    }
    if ((int) ($s['fast_answers'] ?? 0) >= 8) {
        $independent[] = 'fast_answers';
    }
    if ((int) ($s['extension_dom'] ?? 0) >= 1) {
        $independent[] = 'extension_dom';
    }
    if ((int) ($s['resize_devtools'] ?? 0) >= 2) {
        $independent[] = 'devtools_heuristic';
    }
    $flag = count($independent) >= 2 ? 'review' : 'clear';
    return ['flag' => $flag, 'signals' => $independent];
}

function peaklyyIntegrityMerge(array $old, array $incoming): array
{
    $keys = ['tab_hides', 'hidden_ms', 'blurs', 'fast_answers', 'extension_dom', 'resize_devtools'];
    $out = $old;
    foreach ($keys as $k) {
        $out[$k] = max((int) ($old[$k] ?? 0), (int) ($incoming[$k] ?? 0));
    }
    $events = [];
    if (!empty($old['events']) && is_array($old['events'])) {
        $events = $old['events'];
    }
    if (!empty($incoming['event']) && is_array($incoming['event'])) {
        $events[] = $incoming['event'];
    }
    if (!empty($incoming['events']) && is_array($incoming['events'])) {
        foreach ($incoming['events'] as $e) {
            if (is_array($e)) {
                $events[] = $e;
            }
        }
    }
    $out['events'] = array_slice($events, -40);
    $computed = peaklyyIntegrityComputeFlag($out);
    $out['flag'] = $computed['flag'];
    $out['signals'] = $computed['signals'];
    $out['updated_at'] = gmdate('c');
    return $out;
}

function peaklyyIntegritySave(PDO $db, string $attemptId, array $merged): void
{
    $flag = (string) ($merged['flag'] ?? 'clear');
    if ($flag !== 'review') {
        $flag = 'clear';
    }
    $json = json_encode($merged, JSON_UNESCAPED_UNICODE);
    $tab = (int) ($merged['tab_hides'] ?? 0);
    $ext = (int) ($merged['extension_dom'] ?? 0);
    try {
        $db->prepare(
            'UPDATE peaklyy_attempts SET integrity_json = ?, integrity_flag = ?, violation_count = GREATEST(COALESCE(violation_count, 0), ?) WHERE id = ?'
        )->execute([$json, $flag, $tab + $ext, $attemptId]);
    } catch (Throwable $e) {
        try {
            $db->prepare('UPDATE peaklyy_attempts SET integrity_json = ? WHERE id = ?')->execute([$json, $attemptId]);
        } catch (Throwable $e2) {
        }
    }
}

function peaklyyIntegrityApplyIncoming(PDO $db, array $attemptRow, array $incoming): array
{
    $old = peaklyyIntegrityDecode($attemptRow['integrity_json'] ?? null);
    $merged = peaklyyIntegrityMerge($old, $incoming);
    peaklyyIntegritySave($db, (string) $attemptRow['id'], $merged);
    return $merged;
}

function peaklyyIntegrityFinishAttempt(PDO $db, array $attempt, $incoming): void
{
    peaklyyIntegrityEnsureColumns($db);
    if (!is_array($incoming)) {
        $incoming = [];
    }
    try {
        $st = $db->prepare('SELECT id, integrity_json FROM peaklyy_attempts WHERE id = ? LIMIT 1');
        $st->execute([(string) $attempt['id']]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            peaklyyIntegrityApplyIncoming($db, $row, $incoming);
        }
    } catch (Throwable $e) {
    }
}

function peaklyyIntegrityAttachToRow(array $r): array
{
    $view = peaklyyIntegrityPublicView($r['integrity_json'] ?? null, $r['integrity_flag'] ?? null);
    $r['integrity'] = $view;
    $r['integrity_flag'] = $view['flag'];
    unset($r['integrity_json']);
    return $r;
}

function peaklyyIntegrityPublicView($raw, $flagCol = null): array
{
    $data = peaklyyIntegrityDecode($raw);
    $computed = peaklyyIntegrityComputeFlag($data);
    $flag = strtolower(trim((string) ($flagCol ?: ($data['flag'] ?? $computed['flag']))));
    if ($flag !== 'review') {
        $flag = $computed['flag'];
    }
    return [
        'flag' => $flag,
        'signals' => $data['signals'] ?? $computed['signals'],
        'tab_hides' => (int) ($data['tab_hides'] ?? 0),
        'hidden_ms' => (int) ($data['hidden_ms'] ?? 0),
        'blurs' => (int) ($data['blurs'] ?? 0),
        'fast_answers' => (int) ($data['fast_answers'] ?? 0),
        'extension_dom' => (int) ($data['extension_dom'] ?? 0),
        'resize_devtools' => (int) ($data['resize_devtools'] ?? 0),
    ];
}

