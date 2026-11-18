<?php
/**
 * One-time data hygiene: strip invisible characters (U+200B–U+200F, U+2060, U+FEFF)
 * and surrounding whitespace from course and batch names. Some names were pasted
 * with a leading U+2060 ("⁠AutoCAD AUG"), which broke search, sorting and LMS matching.
 *
 * CLI only (safe to re-run; only rows that actually change are updated):
 *   php /var/www/crm/api/migrate_clean_names.php            # dry run, prints changes
 *   php /var/www/crm/api/migrate_clean_names.php --apply    # writes changes
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';

$apply = in_array('--apply', $argv ?? [], true);
$db = (new Database())->getConnection();
$pattern = '/[\x{200B}-\x{200F}\x{2060}\x{FEFF}]/u';

$targets = [
    ['courses', 'name'],
    ['batches', 'name'],
    ['students', 'name'],
];

$total = 0;
foreach ($targets as [$table, $col]) {
    try {
        $rows = $db->query("SELECT id, {$col} AS v FROM {$table}")->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        echo "skip {$table}: {$e->getMessage()}\n";
        continue;
    }
    $upd = $db->prepare("UPDATE {$table} SET {$col} = ? WHERE id = ?");
    foreach ($rows as $r) {
        $old = (string) ($r['v'] ?? '');
        $new = trim((string) preg_replace($pattern, '', $old));
        if ($new === $old || $new === '') {
            continue;
        }
        $total++;
        echo ($apply ? 'fix ' : 'would fix ') . "{$table}.{$col} {$r['id']}: " . json_encode($old) . ' -> ' . json_encode($new) . "\n";
        if ($apply) {
            $upd->execute([$new, $r['id']]);
        }
    }
}
echo ($apply ? 'updated' : 'would update') . " {$total} row(s)" . ($apply ? '' : ' (dry run; pass --apply to write)') . "\n";
