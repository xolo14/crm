<?php
/**
 * Data hygiene report + targeted fixes for the audit's remaining data issues.
 * CLI only. Without flags it only REPORTS; every fix is opt-in.
 *
 *   php /var/www/crm/api/data_hygiene.php
 *       Lists: leads with no/unknown organization, display-text typos
 *       ("Awarness", "Reliveling"), courses priced 0, coupons whose discount is not
 *       below their minimum order.
 *
 *   php /var/www/crm/api/data_hygiene.php --fix-orphans=<org_id>
 *       Moves leads with no/unknown organization into <org_id>.
 *
 *   php /var/www/crm/api/data_hygiene.php --fix-typos
 *       Awarness -> Awareness, Reliveling -> Relieving in name/title/label/subject
 *       columns only (never slugs, codes, source keys or URLs).
 *
 *   php /var/www/crm/api/data_hygiene.php --fix-form-sources
 *       Re-points leads whose form_<slug> source matches no form to the form whose slug
 *       matches once punctuation is ignored (merges duplicate form cards).
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/helpers.php';

$fixOrphans = null;
$fixTypos = false;
foreach ($argv ?? [] as $arg) {
    if (preg_match('/^--fix-orphans=([0-9a-fA-F-]{8,64})$/', (string) $arg, $m)) {
        $fixOrphans = $m[1];
    }
    if ($arg === '--fix-typos') {
        $fixTypos = true;
    }
}

$db = (new Database())->getConnection();
$dbName = (string) $db->query('SELECT DATABASE()')->fetchColumn();

echo "== Leads with no or unknown organization ==\n";
$orphans = $db->query(
    "SELECT id, name, email, source, created_at, org_id FROM leads
      WHERE org_id IS NULL OR org_id = '' OR org_id NOT IN (SELECT id FROM organizations)"
)->fetchAll(PDO::FETCH_ASSOC) ?: [];
foreach ($orphans as $r) {
    echo "  {$r['id']}  " . ($r['name'] ?? '') . ' <' . ($r['email'] ?? '') . '>  source=' . ($r['source'] ?? '') . '  org_id=' . json_encode($r['org_id']) . "\n";
}
echo '  ' . count($orphans) . " lead(s)\n";
if ($fixOrphans !== null && $orphans) {
    $ok = $db->prepare('SELECT COUNT(*) FROM organizations WHERE id = ?');
    $ok->execute([$fixOrphans]);
    if ((int) $ok->fetchColumn() !== 1) {
        echo "  !! organization {$fixOrphans} not found; nothing changed\n";
    } else {
        $up = $db->prepare("UPDATE leads SET org_id = ? WHERE id = ?");
        foreach ($orphans as $r) {
            $up->execute([$fixOrphans, $r['id']]);
        }
        echo '  moved ' . count($orphans) . " lead(s) into {$fixOrphans}\n";
    }
}

echo "\n== Organizations (for --fix-orphans) ==\n";
foreach ($db->query('SELECT id, name FROM organizations ORDER BY name')->fetchAll(PDO::FETCH_ASSOC) ?: [] as $o) {
    echo "  {$o['id']}  {$o['name']}\n";
}

echo "\n== Typos in display text ==\n";
$typos = ['Awarness' => 'Awareness', 'Reliveling' => 'Relieving'];
$cols = $db->prepare(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('varchar', 'text', 'mediumtext', 'longtext', 'char')"
);
$cols->execute([$dbName]);
$editable = '/(^|_)(name|title|label|subject|heading|display_name|template_name)$/i';
foreach ($cols->fetchAll(PDO::FETCH_ASSOC) ?: [] as $c) {
    $t = $c['TABLE_NAME'];
    $col = $c['COLUMN_NAME'];
    foreach ($typos as $bad => $good) {
        try {
            $q = $db->prepare("SELECT COUNT(*) FROM `{$t}` WHERE BINARY `{$col}` LIKE ?");
            $q->execute(['%' . $bad . '%']);
            $n = (int) $q->fetchColumn();
        } catch (Throwable $e) {
            continue;
        }
        if ($n === 0) {
            continue;
        }
        $isEditable = (bool) preg_match($editable, $col);
        echo "  {$t}.{$col}: {$n} row(s) contain \"{$bad}\"" . ($isEditable ? '' : '  (not auto-fixed: not a display-name column)') . "\n";
        if ($fixTypos && $isEditable) {
            $u = $db->prepare("UPDATE `{$t}` SET `{$col}` = REPLACE(`{$col}`, ?, ?) WHERE BINARY `{$col}` LIKE ?");
            $u->execute([$bad, $good, '%' . $bad . '%']);
            echo "    fixed {$u->rowCount()} row(s) -> \"{$good}\"\n";
        }
    }
}

echo "\n== Lead sources that look like a form but match no form slug ==\n";
// e.g. 'form_megaitplacementdrive2026' while the form's slug is 'mega-it-placement-drive-2026':
// such leads show as a second raw card next to the real form. --fix-form-sources re-points
// them to the form whose slug matches once punctuation is ignored.
$norm = static fn(string $v): string => preg_replace('/[^a-z0-9]/', '', strtolower($v));
$forms = $db->query('SELECT slug, name, org_id FROM lead_forms WHERE slug IS NOT NULL AND slug <> ""')->fetchAll(PDO::FETCH_ASSOC) ?: [];
$slugSet = [];
$byNorm = [];
foreach ($forms as $fm) {
    $slugSet[(string) $fm['slug']] = true;
    $byNorm[$norm((string) $fm['slug'])][] = $fm;
}
$srcRows = $db->query("SELECT source, org_id, COUNT(*) AS c FROM leads WHERE source LIKE 'form\\_%' GROUP BY source, org_id")->fetchAll(PDO::FETCH_ASSOC) ?: [];
$fixFormSources = in_array('--fix-form-sources', $argv ?? [], true);
$found = 0;
foreach ($srcRows as $r) {
    $slug = substr((string) $r['source'], 5);
    if ($slug === '' || isset($slugSet[$slug])) {
        continue;
    }
    $cands = $byNorm[$norm($slug)] ?? [];
    // Prefer the form in the same organization as the leads.
    $match = null;
    foreach ($cands as $c) {
        if ((string) $c['org_id'] === (string) $r['org_id']) {
            $match = $c;
            break;
        }
    }
    if ($match === null && count($cands) === 1) {
        $match = $cands[0];
    }
    $found++;
    echo "  {$r['source']}  ({$r['c']} lead(s), org " . ($r['org_id'] ?? 'none') . ')  -> '
        . ($match ? "form_{$match['slug']} ({$match['name']})" : 'no matching form') . "\n";
    if ($fixFormSources && $match) {
        $up = $db->prepare('UPDATE leads SET source = ? WHERE source = ? AND org_id <=> ?');
        $up->execute(['form_' . $match['slug'], $r['source'], $r['org_id']]);
        echo "    re-pointed {$up->rowCount()} lead(s)\n";
    }
}
echo '  ' . $found . " unmatched form source(s)" . ($found && !$fixFormSources ? ' — pass --fix-form-sources to re-point the matched ones' : '') . "\n";

echo "\n== Invisible characters left in names/descriptions ==\n";
foreach ([['courses', 'name'], ['courses', 'description'], ['batches', 'name'], ['lead_forms', 'name']] as [$t, $col]) {
    try {
        // UTF-8 bytes of U+200B–U+200F (E2 80 8B–8F), U+2060 (E2 81 A0), U+FEFF (EF BB BF).
        $q = $db->query("SELECT COUNT(*) FROM `{$t}` WHERE HEX(`{$col}`) REGEXP 'E2808[B-F]|E281A0|EFBBBF'");
        $n = (int) $q->fetchColumn();
        echo "  {$t}.{$col}: {$n} row(s)" . ($n > 0 ? ' — run migrate_clean_names.php --apply' : '') . "\n";
    } catch (Throwable $e) {
        echo "  {$t}.{$col}: could not check ({$e->getMessage()})\n";
    }
}

echo "\n== Courses priced 0 (set real prices in Courses) ==\n";
try {
    $rows = $db->query("SELECT name FROM courses WHERE COALESCE(price, 0) <= 0 ORDER BY name")->fetchAll(PDO::FETCH_COLUMN) ?: [];
    echo '  ' . count($rows) . ' course(s)' . ($rows ? ': ' . implode(', ', array_slice($rows, 0, 40)) : '') . "\n";
} catch (Throwable $e) {
    echo '  could not read courses: ' . $e->getMessage() . "\n";
}

echo "\n== Coupons whose discount is not below the minimum order ==\n";
try {
    $rows = $db->query(
        "SELECT id, code, name, discount, min_amount, created_at FROM coupons
          WHERE min_amount > 0 AND discount >= min_amount ORDER BY created_at DESC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    foreach ($rows as $r) {
        echo "  {$r['code']}  {$r['name']}  discount={$r['discount']}  min={$r['min_amount']}  id={$r['id']}\n";
    }
    echo '  ' . count($rows) . " coupon(s) — edit or delete them on the Coupons page\n";
} catch (Throwable $e) {
    echo '  could not read coupons: ' . $e->getMessage() . "\n";
}
