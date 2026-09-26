<?php
/**
 * Syncpedia Basics — 30 MCQs in 20 minutes: 10 quantitative aptitude + 20 from the chosen domain.
 * Each domain bank is 40 medium / 30 hard / 15 expert / 15 scenario; aptitude is 40/30/30.
 * Attempts draw 5 medium + 5 hard aptitude, and 5 medium + 5 hard + 5 expert + 5 scenario domain.
 * Also seeds the older Syncpedia assignment paper.
 */

$syncpediaBasicsBanksFile = __DIR__ . '/SyncpediaBasicsBanks.php';
if (is_readable($syncpediaBasicsBanksFile)) {
    require_once $syncpediaBasicsBanksFile;
}

function syncpediaBasicsDurationMinutes(): int
{
    return 20;
}

function syncpediaBasicsPaperQuestionCount(): int
{
    return 30;
}

/** @return array<string,int> */
function syncpediaBasicsAptitudeQuotas(): array
{
    return ['medium' => 5, 'hard' => 5];
}

/** @return array<string,int> */
function syncpediaBasicsDomainQuotas(): array
{
    return ['medium' => 5, 'hard' => 5, 'expert' => 5, 'scenario' => 5];
}

function syncpediaBasicsAptitudePickCount(): int
{
    return array_sum(syncpediaBasicsAptitudeQuotas());
}

function syncpediaBasicsDomainPickCount(): int
{
    return array_sum(syncpediaBasicsDomainQuotas());
}

function syncpediaBasicsAptitudeDomainKey(): string
{
    return 'aptitude';
}

/** Last 10 digits so +91 / 0-prefix variants still match. */
function syncpediaBasicsPhoneKey(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($digits) >= 10) {
        return substr($digits, -10);
    }
    return $digits;
}

/**
 * Prior Basics attempt for the same email or mobile (any domain).
 * Prefers a started/finished row so a second identity cannot slip through.
 *
 * @return array<string,mixed>|null
 */
function syncpediaBasicsFindPriorAttempt(PDO $db, string $assessmentId, string $email, string $phone): ?array
{
    $email = strtolower(trim($email));
    $phoneKey = syncpediaBasicsPhoneKey($phone);
    $rows = [];
    if ($email !== '') {
        $st = $db->prepare(
            "SELECT id, public_token, status, created_at FROM peaklyy_attempts
             WHERE assessment_id = ? AND LOWER(TRIM(email)) = ?
               AND status IN ('registered','submitted','in_progress','expired')
             ORDER BY created_at DESC LIMIT 5"
        );
        $st->execute([$assessmentId, $email]);
        $rows = array_merge($rows, $st->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }
    if (strlen($phoneKey) >= 10) {
        $like = '%' . $phoneKey;
        try {
            $st = $db->prepare(
                "SELECT id, public_token, status, phone, created_at FROM peaklyy_attempts
                 WHERE assessment_id = ? AND IFNULL(phone,'') <> ''
                   AND status IN ('registered','submitted','in_progress','expired')
                   AND REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(phone,''), ' ', ''), '-', ''), '+', ''), '.', '') LIKE ?
                 ORDER BY created_at DESC LIMIT 20"
            );
            $st->execute([$assessmentId, $like]);
        } catch (Throwable $e) {
            $st = $db->prepare(
                "SELECT id, public_token, status, phone, created_at FROM peaklyy_attempts
                 WHERE assessment_id = ? AND IFNULL(phone,'') <> ''
                   AND status IN ('registered','submitted','in_progress','expired')
                   AND phone LIKE ?
                 ORDER BY created_at DESC LIMIT 20"
            );
            $st->execute([$assessmentId, $like]);
        }
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            if (syncpediaBasicsPhoneKey((string) ($row['phone'] ?? '')) === $phoneKey) {
                $rows[] = $row;
            }
        }
    }
    if (!$rows) {
        return null;
    }
    $byId = [];
    foreach ($rows as $row) {
        $byId[(string) ($row['id'] ?? '')] = $row;
    }
    $unique = array_values($byId);
    foreach ($unique as $row) {
        if (in_array((string) ($row['status'] ?? ''), ['submitted', 'in_progress', 'expired'], true)) {
            return $row;
        }
    }
    return $unique[0];
}

/** Candidate-facing instruction lines after the two fullscreen/keyboard rules. */
function syncpediaBasicsPublicInstructions(int $durationMinutes): array
{
    $out = [];
    if ($durationMinutes > 0) {
        $out[] = 'Duration: ' . $durationMinutes . ' minutes';
    } else {
        $out[] = 'No time limit — submit when you finish';
    }
    $out[] = '10 aptitude questions and 20 domain questions';
    $out[] = 'Stay on this page until you finish the test. You can navigate between questions before submitting. Tab switches are logged for review; leaving fullscreen auto-submits.';
    $out[] = 'Do not refresh the page during the test. The timer ends the test automatically when time is up.';
    $out[] = 'Single attempt only';
    return $out;
}

function syncpediaFresherBasicsSlug(): string
{
    return 'syncpedia-fresher-basics';
}

function syncpediaAssignmentSlug(): string
{
    return 'syncpedia-assignment';
}

function syncpediaFresherBasicsApiKey(): string
{
    return 'syncpedia_fresher_basics_v1';
}

function syncpediaAssignmentApiKey(): string
{
    return 'syncpedia_assignment_v1';
}

/** @return list<string> */
function syncpediaFresherInterestTopics(): array
{
    return [];
}

/** @return array<string,string> */
function syncpediaBasicsDomainCatalog(): array
{
    return [
        'cyber_sec' => 'Cyber Security & Ethical Hacking',
        'data_analytics' => 'Data Analytics (DA)',
        'ai' => 'Artificial Intelligence (AI)',
        'java_fullstack' => 'Java Fullstack',
        'python_fullstack' => 'Python Fullstack',
        'vlsi' => 'VLSI Design',
        'solidworks' => 'SolidWorks',
        'autocad' => 'AutoCAD',
        'embedded' => 'Embedded Systems',
        'finance' => 'Finance',
        'marketing' => 'Marketing',
        'hr' => 'HR',
    ];
}

function syncpediaResolveDomainLabel(?string $key): string
{
    $key = trim((string) $key);
    if ($key === '') {
        return '';
    }
    $catalog = syncpediaBasicsDomainCatalog();
    if (isset($catalog[$key])) {
        return $catalog[$key];
    }
    if (function_exists('peaklyyDomainCatalog')) {
        $peak = peaklyyDomainCatalog();
        if (isset($peak[$key])) {
            return $peak[$key];
        }
    }
    return $key;
}

function syncpediaBasicsMcq(string $domain, string $difficulty, string $prompt, string $a, string $b, string $c, string $d, string $correct): array
{
    $tagMap = [
        'medium' => 'Medium',
        'hard' => 'Hard',
        'expert' => 'Expert',
        'scenario' => 'Scenario',
        'easy' => 'Medium',
        'difficult' => 'Expert',
    ];
    $tag = $tagMap[$difficulty] ?? ucfirst($difficulty);
    return [
        'domain_key' => $domain,
        'difficulty' => $difficulty,
        'prompt' => '[' . $tag . '] ' . $prompt,
        'option_a' => $a,
        'option_b' => $b,
        'option_c' => $c,
        'option_d' => $d,
        'correct_option' => $correct,
        'points' => 1,
        'q_type' => 'mcq',
    ];
}

function syncpediaFresherBasicsQuestionDefs(): array
{
    return syncpediaBasicsQuestionDefs();
}

function syncpediaBasicsQuestionDifficulty(array $row): string
{
    $schema = $row['task_schema_json'] ?? null;
    if (is_string($schema)) {
        $schema = json_decode($schema, true);
    }
    $diff = is_array($schema) ? strtolower(trim((string) ($schema['difficulty'] ?? ''))) : '';
    if ($diff === 'easy') {
        return 'medium';
    }
    if ($diff === 'difficult') {
        return 'expert';
    }
    if (in_array($diff, ['medium', 'hard', 'expert', 'scenario'], true)) {
        return $diff;
    }
    return 'medium';
}

/**
 * Draw an exact quota from each difficulty bucket. Returns [] if any bucket is short.
 *
 * @param list<array<string,mixed>> $pool
 * @param array<string,int> $quotas
 * @return list<array<string,mixed>>
 */
function syncpediaBasicsPickByQuotas(array $pool, array $quotas): array
{
    $by = ['medium' => [], 'hard' => [], 'expert' => [], 'scenario' => []];
    foreach ($pool as $row) {
        if (!is_array($row)) {
            continue;
        }
        $k = syncpediaBasicsQuestionDifficulty($row);
        if (!isset($by[$k])) {
            $k = 'medium';
        }
        $by[$k][] = $row;
    }
    $out = [];
    foreach ($quotas as $k => $n) {
        $n = (int) $n;
        if ($n <= 0) {
            continue;
        }
        $slice = $by[$k] ?? [];
        shuffle($slice);
        if (count($slice) < $n) {
            return [];
        }
        foreach (array_slice($slice, 0, $n) as $row) {
            $out[] = $row;
        }
    }
    return $out;
}

/**
 * Random 10 aptitude (5 medium + 5 hard) + 20 domain
 * (5 medium + 5 hard + 5 expert + 5 scenario).
 *
 * @return list<array<string,mixed>>
 */
function syncpediaBasicsPickAttemptQuestions(PDO $db, string $assessmentId, string $domainKey): array
{
    $domainKey = trim($domainKey);
    $all = function_exists('peaklyyPickCustomQuestions')
        ? peaklyyPickCustomQuestions($db, $assessmentId, 0, null)
        : [];
    $aptKey = syncpediaBasicsAptitudeDomainKey();
    $apt = [];
    $dom = [];
    foreach ($all as $row) {
        if (!is_array($row)) {
            continue;
        }
        $dk = function_exists('peaklyyQuestionStoredDomainKey')
            ? peaklyyQuestionStoredDomainKey($row)
            : trim((string) ($row['domain_key'] ?? ''));
        if ($dk === $aptKey) {
            $apt[] = $row;
        } elseif ($domainKey !== '' && $dk === $domainKey) {
            $dom[] = $row;
        }
    }
    $pickedApt = syncpediaBasicsPickByQuotas($apt, syncpediaBasicsAptitudeQuotas());
    $pickedDom = syncpediaBasicsPickByQuotas($dom, syncpediaBasicsDomainQuotas());
    if (count($pickedApt) < syncpediaBasicsAptitudePickCount() || count($pickedDom) < syncpediaBasicsDomainPickCount()) {
        return [];
    }
    return array_merge($pickedApt, $pickedDom);
}

function syncpediaBasicsSeedInt(string $seed, string $salt, int $min, int $max): int
{
    if ($max < $min) {
        return $min;
    }
    $n = hexdec(substr(hash('sha256', $seed . '|' . $salt), 0, 8));
    return $min + (int) ($n % ($max - $min + 1));
}

/**
 * @param list<string|int|float> $choices
 * @return array{options: array<string,string>, correct: string}
 */
function syncpediaBasicsPackMcqChoices($answer, array $distractors): array
{
    $ans = (string) $answer;
    $uniq = [$ans];
    foreach ($distractors as $d) {
        $s = (string) $d;
        if ($s === '' || in_array($s, $uniq, true)) {
            continue;
        }
        $uniq[] = $s;
        if (count($uniq) >= 4) {
            break;
        }
    }
    $i = 1;
    while (count($uniq) < 4) {
        $extra = is_numeric($ans) ? (string) ((float) $ans + $i) : $ans . '-' . $i;
        if (!in_array($extra, $uniq, true)) {
            $uniq[] = $extra;
        }
        $i++;
        if ($i > 20) {
            break;
        }
    }
    $rest = array_slice($uniq, 1);
    shuffle($rest);
    $texts = array_merge([$ans], $rest);
    shuffle($texts);
    $options = [];
    $correct = 'a';
    $letters = ['a', 'b', 'c', 'd'];
    foreach ($letters as $idx => $letter) {
        $options[$letter] = (string) ($texts[$idx] ?? '');
        if ($options[$letter] === $ans) {
            $correct = $letter;
        }
    }
    return ['options' => $options, 'correct' => $correct];
}

function syncpediaBasicsWriteMcqRow(array $row, string $prompt, array $packed): array
{
    $row['prompt'] = $prompt;
    $row['options_json'] = json_encode($packed['options'], JSON_UNESCAPED_UNICODE);
    $row['correct_option'] = $packed['correct'];
    $row['option_a'] = $packed['options']['a'] ?? '';
    $row['option_b'] = $packed['options']['b'] ?? '';
    $row['option_c'] = $packed['options']['c'] ?? '';
    $row['option_d'] = $packed['options']['d'] ?? '';
    return $row;
}

function syncpediaBasicsRowDomainKey(array $row): string
{
    if (function_exists('peaklyyQuestionStoredDomainKey')) {
        return peaklyyQuestionStoredDomainKey($row);
    }
    return trim((string) ($row['domain_key'] ?? ''));
}

function syncpediaBasicsRowPrompt(array $row): string
{
    return trim((string) ($row['prompt'] ?? ''));
}

/**
 * Re-number computational aptitude items so leaked keys do not match this paper.
 * Conceptual "nearest meaning" stems are left unchanged. No canvas / class obfuscation.
 *
 * @param list<array<string,mixed>> $picked
 * @return list<array<string,mixed>>
 */
function syncpediaBasicsParameterizePickedQuestions(array $picked, string $seed): array
{
    $aptKey = syncpediaBasicsAptitudeDomainKey();
    $out = [];
    foreach ($picked as $i => $row) {
        if (!is_array($row)) {
            continue;
        }
        if (syncpediaBasicsRowDomainKey($row) !== $aptKey) {
            $out[] = $row;
            continue;
        }
        $variant = syncpediaBasicsParameterizeAptitudeRow($row, $seed . ':' . $i);
        $out[] = $variant ?: $row;
    }
    return $out;
}

function syncpediaBasicsParameterizeAptitudeRow(array $row, string $seed): ?array
{
    $prompt = syncpediaBasicsRowPrompt($row);
    $plain = preg_replace('/^\s*\[[^\]]+\]\s*/u', '', $prompt) ?? $prompt;
    $prefix = '';
    if (preg_match('/^(\s*\[[^\]]+\]\s*)/u', $prompt, $m)) {
        $prefix = $m[1];
    }

    if (preg_match('/^What is (\d+(?:\.\d+)?)% of (\d+)\?$/u', $plain, $m)) {
        $p = syncpediaBasicsSeedInt($seed, 'p', 8, 40);
        $n = syncpediaBasicsSeedInt($seed, 'n', 80, 480);
        if ($n % 4 !== 0) {
            $n += 4 - ($n % 4);
        }
        $ans = $p * $n / 100;
        $ansStr = abs($ans - round($ans)) < 0.001 ? (string) (int) round($ans) : rtrim(rtrim(sprintf('%.2f', $ans), '0'), '.');
        $packed = syncpediaBasicsPackMcqChoices($ansStr, [
            (string) (int) round($ans + $p),
            (string) (int) round($n * ($p + 5) / 100),
            (string) (int) round($n * max(1, $p - 5) / 100),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "What is {$p}% of {$n}?", $packed);
    }

    if (preg_match('/^A number increased by (\d+)% becomes (\d+)\./u', $plain, $m)) {
        $p = syncpediaBasicsSeedInt($seed, 'p', 10, 40);
        $orig = syncpediaBasicsSeedInt($seed, 'o', 80, 240);
        $becomes = (int) round($orig * (100 + $p) / 100);
        $packed = syncpediaBasicsPackMcqChoices((string) $orig, [
            (string) (int) round($becomes * 100 / max(1, 100 - $p)),
            (string) (int) round($becomes - $p),
            (string) (int) round($orig + $p),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A number increased by {$p}% becomes {$becomes}. The original number is:", $packed);
    }

    if (preg_match('/^A number decreased by (\d+)% becomes (\d+)\./u', $plain, $m)) {
        $p = syncpediaBasicsSeedInt($seed, 'p', 10, 40);
        $orig = syncpediaBasicsSeedInt($seed, 'o', 80, 240);
        $becomes = (int) round($orig * (100 - $p) / 100);
        $packed = syncpediaBasicsPackMcqChoices((string) $orig, [
            (string) (int) round($becomes * 100 / max(1, 100 + $p)),
            (string) (int) round($becomes + $p),
            (string) (int) round($orig - $p),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A number decreased by {$p}% becomes {$becomes}. The original number is:", $packed);
    }

    if (preg_match('/^Divide ₹(\d+) in the ratio (\d+):(\d+)\./u', $plain, $m)) {
        $a = syncpediaBasicsSeedInt($seed, 'a', 2, 7);
        $b = syncpediaBasicsSeedInt($seed, 'b', 2, 7);
        if ($a === $b) {
            $b++;
        }
        $unit = syncpediaBasicsSeedInt($seed, 'u', 80, 200);
        $total = ($a + $b) * $unit;
        $larger = max($a, $b) * $unit;
        $packed = syncpediaBasicsPackMcqChoices((string) $larger, [
            (string) (min($a, $b) * $unit),
            (string) (int) round($total / 2),
            (string) ($a * $unit),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "Divide ₹{$total} in the ratio {$a}:{$b}. The larger share is:", $packed);
    }

    if (preg_match('/^The average of (\d+), (\d+), (\d+) and (\d+) is:/u', $plain, $m)) {
        $base = syncpediaBasicsSeedInt($seed, 'b', 8, 24);
        $nums = [$base, $base + 6, $base + 12, $base + 18];
        $avg = (int) (array_sum($nums) / 4);
        $packed = syncpediaBasicsPackMcqChoices((string) $avg, [
            (string) ($avg + 2),
            (string) ($avg - 1),
            (string) ($nums[3]),
        ]);
        $list = implode(', ', $nums);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "The average of {$list} is:", $packed);
    }

    if (preg_match('/^CP = ₹(\d+), SP = ₹(\d+)\. Profit percent is:/u', $plain, $m)) {
        $cp = syncpediaBasicsSeedInt($seed, 'cp', 200, 600);
        $cp -= $cp % 20;
        $pct = syncpediaBasicsSeedInt($seed, 'pct', 8, 25);
        $sp = (int) round($cp * (100 + $pct) / 100);
        $packed = syncpediaBasicsPackMcqChoices($pct . '%', [
            ($pct + 5) . '%',
            ($pct - 3) . '%',
            (int) round(($sp - $cp) * 100 / max(1, $sp)) . '%',
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "CP = ₹{$cp}, SP = ₹{$sp}. Profit percent is:", $packed);
    }

    if (preg_match('/^SI on ₹(\d+) at (\d+)% p\.a\. for (\d+) years is:/u', $plain, $m)) {
        $p = syncpediaBasicsSeedInt($seed, 'p', 1000, 5000);
        $p -= $p % 100;
        $r = syncpediaBasicsSeedInt($seed, 'r', 6, 12);
        $t = syncpediaBasicsSeedInt($seed, 't', 2, 5);
        $si = (int) round($p * $r * $t / 100);
        $packed = syncpediaBasicsPackMcqChoices((string) $si, [
            (string) ($si + 50),
            (string) ($p * $r / 100),
            (string) ($si - 100),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "SI on ₹{$p} at {$r}% p.a. for {$t} years is:", $packed);
    }

    if (preg_match('/^A car covers (\d+) km in (\d+) hours\. Average speed is:/u', $plain, $m)) {
        $h = syncpediaBasicsSeedInt($seed, 'h', 2, 6);
        $spd = syncpediaBasicsSeedInt($seed, 's', 40, 90);
        $d = $spd * $h;
        $packed = syncpediaBasicsPackMcqChoices($spd . ' km/h', [
            ($spd + 10) . ' km/h',
            ($spd - 6) . ' km/h',
            (int) round($d / max(1, $h + 1)) . ' km/h',
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A car covers {$d} km in {$h} hours. Average speed is:", $packed);
    }

    if (preg_match('/^A man walks (\d+) km\/h for ([\d.]+) hours\. Distance is:/u', $plain, $m)) {
        $spd = syncpediaBasicsSeedInt($seed, 's', 3, 8);
        $hoursTenths = syncpediaBasicsSeedInt($seed, 'h', 15, 40);
        $hours = $hoursTenths / 10;
        $dist = $spd * $hours;
        $distStr = abs($dist - round($dist)) < 0.001 ? ((int) round($dist)) . ' km' : rtrim(rtrim(sprintf('%.1f', $dist), '0'), '.') . ' km';
        $packed = syncpediaBasicsPackMcqChoices($distStr, [
            ($spd * 2) . ' km',
            ((int) round($dist + 2)) . ' km',
            ((int) round($hours * 10)) . ' km',
        ]);
        $hLabel = rtrim(rtrim(sprintf('%.1f', $hours), '0'), '.');
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A man walks {$spd} km/h for {$hLabel} hours. Distance is:", $packed);
    }

    if (preg_match('/^(\d+)% of (\d+)% of (\d+) is:/u', $plain, $m)) {
        $p1 = syncpediaBasicsSeedInt($seed, 'p1', 10, 30);
        $p2 = syncpediaBasicsSeedInt($seed, 'p2', 10, 30);
        $n = syncpediaBasicsSeedInt($seed, 'n', 200, 800);
        $n -= $n % 50;
        $ans = $p1 / 100 * $p2 / 100 * $n;
        $ansStr = abs($ans - round($ans)) < 0.001 ? (string) (int) round($ans) : rtrim(rtrim(sprintf('%.2f', $ans), '0'), '.');
        $packed = syncpediaBasicsPackMcqChoices($ansStr, [
            (string) (int) round($n * $p1 / 100),
            (string) (int) round($ans + 10),
            (string) (int) round($n * $p2 / 100),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "{$p1}% of {$p2}% of {$n} is:", $packed);
    }

    if (preg_match('/^A successive \+(\d+)% then −\1% on (\d+) yields:/u', $plain, $m)
        || preg_match('/^A successive \+(\d+)% then −(\d+)% on (\d+) yields:/u', $plain, $m)) {
        $x = syncpediaBasicsSeedInt($seed, 'x', 10, 30);
        $base = 100;
        $ans = (int) round($base * (1 + $x / 100) * (1 - $x / 100));
        $packed = syncpediaBasicsPackMcqChoices((string) $ans, [
            '100',
            (string) ($base + $x),
            (string) ($base - $x),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A successive +{$x}% then −{$x}% on {$base} yields:", $packed);
    }

    if (preg_match('/^Marked price ₹(\d+), discount (\d+)%\. SP is:/u', $plain, $m)) {
        $mp = syncpediaBasicsSeedInt($seed, 'mp', 400, 1200);
        $mp -= $mp % 50;
        $d = syncpediaBasicsSeedInt($seed, 'd', 8, 25);
        $sp = (int) round($mp * (100 - $d) / 100);
        $packed = syncpediaBasicsPackMcqChoices((string) $sp, [
            (string) ($mp - $d * 10),
            (string) (int) round($mp * (100 - $d + 5) / 100),
            (string) ($mp),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "Marked price ₹{$mp}, discount {$d}%. SP is:", $packed);
    }

    if (preg_match('/^A can do a job in (\d+) days, B in (\d+)\. Together they finish in:/u', $plain, $m)) {
        $a = syncpediaBasicsSeedInt($seed, 'a', 8, 18);
        $b = syncpediaBasicsSeedInt($seed, 'b', 10, 24);
        if ($a === $b) {
            $b += 6;
        }
        $together = $a * $b / ($a + $b);
        $togetherStr = abs($together - round($together)) < 0.001
            ? ((int) round($together)) . ' days'
            : rtrim(rtrim(sprintf('%.1f', $together), '0'), '.') . ' days';
        $packed = syncpediaBasicsPackMcqChoices($togetherStr, [
            ((int) round(($a + $b) / 2)) . ' days',
            ((int) min($a, $b)) . ' days',
            ((int) round($together + 3)) . ' days',
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A can do a job in {$a} days, B in {$b}. Together they finish in:", $packed);
    }

    if (preg_match('/^A 150 m train at (\d+) km\/h crosses a pole in:/u', $plain)
        || preg_match('/^A (\d+) m train at (\d+) km\/h crosses a pole in:/u', $plain, $m)) {
        $len = syncpediaBasicsSeedInt($seed, 'l', 100, 240);
        $len -= $len % 10;
        $kmh = [36, 54, 72, 90][syncpediaBasicsSeedInt($seed, 'k', 0, 3)];
        $sec = (int) round($len / ($kmh * 1000 / 3600));
        $packed = syncpediaBasicsPackMcqChoices($sec . ' s', [
            ($sec + 5) . ' s',
            ($sec - 2 > 0 ? $sec - 2 : $sec + 3) . ' s',
            ((int) round($len / $kmh)) . ' s',
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "A {$len} m train at {$kmh} km/h crosses a pole in:", $packed);
    }

    if (preg_match('/^HCF of (\d+) and (\d+) is:/u', $plain, $m)) {
        $g = [6, 8, 12, 15][syncpediaBasicsSeedInt($seed, 'g', 0, 3)];
        $x = $g * syncpediaBasicsSeedInt($seed, 'x', 2, 6);
        $y = $g * syncpediaBasicsSeedInt($seed, 'y', 3, 8);
        if ($x === $y) {
            $y += $g;
        }
        $aa = $x;
        $bb = $y;
        while ($bb) {
            $t = $aa % $bb;
            $aa = $bb;
            $bb = $t;
        }
        $h = $aa;
        $packed = syncpediaBasicsPackMcqChoices((string) $h, [
            (string) ($h * 2),
            (string) min($x, $y),
            (string) ($g === $h ? $g + 2 : $g),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "HCF of {$x} and {$y} is:", $packed);
    }

    if (preg_match('/^If (\d+)x = (\d+), x equals:/u', $plain, $m)) {
        $c = syncpediaBasicsSeedInt($seed, 'c', 4, 12);
        $x = syncpediaBasicsSeedInt($seed, 'x', 5, 15);
        $rhs = $c * $x;
        $packed = syncpediaBasicsPackMcqChoices((string) $x, [
            (string) ($x + 1),
            (string) ($rhs - $c),
            (string) ($c),
        ]);
        return syncpediaBasicsWriteMcqRow($row, $prefix . "If {$c}x = {$rhs}, x equals:", $packed);
    }

    return null;
}

/**
 * Full Syncpedia Basics bank (aptitude + 12 domains), not the 30-question attempt paper.
 * @return list<array<string,mixed>>
 */
function syncpediaBasicsQuestionDefs(): array
{
    if (function_exists('syncpediaBasicsBankDefs')) {
        return syncpediaBasicsBankDefs();
    }
    return [];
}

/** Older mixed 15-question paper for /assessment/syncpedia-assignment */
function syncpediaAssignmentQuestionDefs(): array
{
    $qs = [];

    // =========================================================================
    // —— CATEGORY 1: ARTIFICIAL INTELLIGENCE (5 Questions: 2 Easy, 2 Med, 1 Diff) ——
    // =========================================================================

    // Q1 [AI - Easy]
    $qs[] = [
        'prompt' => 'What is the primary purpose of Artificial Intelligence (AI)?',
        'option_a' => 'Enabling machines to perform tasks that typically require human intelligence',
        'option_b' => 'Increasing the physical hardware clock speed of computer monitors',
        'option_c' => 'Replacing the need for internet connectivity in computers',
        'option_d' => 'Writing manual spreadsheet formulas for simple calculations only',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q2 [AI - Easy]
    $qs[] = [
        'prompt' => 'Which of the following is a common real-world application of Natural Language Processing (NLP) in AI?',
        'option_a' => 'A cooling fan adjusting rotational speed when CPU temperature rises',
        'option_b' => 'A virtual assistant or chatbot that understands and responds to human language queries',
        'option_c' => 'A computer power supply regulating electrical voltage to a graphics card',
        'option_d' => 'Formatting an external storage drive with a new file system',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q3 [AI - Medium]
    $qs[] = [
        'prompt' => 'In Machine Learning, what is the fundamental difference between "Supervised Learning" and "Unsupervised Learning"?',
        'option_a' => 'Supervised learning requires no mathematical algorithms, while unsupervised learning uses only spreadsheets',
        'option_b' => 'Supervised learning trains models on labeled data with known target outcomes, while unsupervised learning discovers patterns in unlabeled data',
        'option_c' => 'Supervised learning runs only on mobile phones, while unsupervised learning requires supercomputers',
        'option_d' => 'Supervised learning requires humans to hard-code every rule manually, while unsupervised learning does not',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q4 [AI - Medium]
    $qs[] = [
        'prompt' => 'In machine learning model training, what is "Overfitting"?',
        'option_a' => 'When a model is too simple to capture patterns in the training data (high bias)',
        'option_b' => 'When the dataset contains too many rows to fit into CPU memory',
        'option_c' => 'When a model learns the training data and noise too closely, failing to generalize to new, unseen data',
        'option_d' => 'When an algorithm runs indefinitely without producing an output score',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q5 [AI - Difficult]
    $qs[] = [
        'prompt' => 'In the context of Large Language Models (LLMs) and Generative AI, what is a "Hallucination", and which technique is commonly used to mitigate it?',
        'option_a' => 'A hardware GPU malfunction causing graphical artifacts; mitigated by replacing thermal paste',
        'option_b' => 'The model translating input queries into binary machine code; mitigated by retraining on assembly language',
        'option_c' => 'The model running out of memory context window; mitigated by lowering the screen refresh rate',
        'option_d' => 'Generating factually incorrect or unsupported claims with high linguistic confidence; mitigated by Retrieval-Augmented Generation (RAG) and ground-truth citations',
        'correct_option' => 'd',
        'points' => 1,
    ];

    // ==============================================================================
    // —— CATEGORY 2: CYBER SECURITY & ETHICAL HACKING (5 Questions: 1 Easy, 2 Med, 2 Diff) ——
    // ==============================================================================

    // Q6 [Cyber - Easy]
    $qs[] = [
        'prompt' => 'What is a "Phishing" attack in cybersecurity?',
        'option_a' => 'A deceptive email or message designed to trick users into revealing sensitive credentials or downloading malware',
        'option_b' => 'An automated scanner that cleans temporary files from a PC',
        'option_c' => 'An operating system update that patches software vulnerabilities',
        'option_d' => 'A hardware device used to test network cable connectivity',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q7 [Cyber - Medium]
    $qs[] = [
        'prompt' => 'In web security and networking, what is the primary security advantage of HTTPS over HTTP?',
        'option_a' => 'HTTPS operates without requiring any DNS lookup',
        'option_b' => 'HTTPS works offline without an active internet connection',
        'option_c' => 'HTTPS encrypts communications between client and server using SSL/TLS to prevent eavesdropping and tampering',
        'option_d' => 'HTTPS automatically eliminates all client-side JavaScript bugs',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q8 [Cyber - Medium]
    $qs[] = [
        'prompt' => 'What is the primary role of an Ethical Hacker (White Hat hacker) in an organization?',
        'option_a' => 'Disabling company firewalls secretly without management approval',
        'option_b' => 'Testing systems and applications with authorization to discover and fix security vulnerabilities',
        'option_c' => 'Writing and selling ransomware on unauthorized dark web forums',
        'option_d' => 'Deleting system audit logs to conceal unauthorized employee network activity',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q9 [Cyber - Difficult]
    $qs[] = [
        'prompt' => 'In web application security, how does a SQL Injection (SQLi) attack occur, and what is the standard industry defense against it?',
        'option_a' => 'Attackers overload database memory buffers with large media files; defense is increasing server swap space',
        'option_b' => 'Attackers inject malicious SQL statements through unsanitized user inputs; defense is using Parameterized Queries (Prepared Statements)',
        'option_c' => 'Attackers sniff database passwords on unencrypted local Wi-Fi; defense is using optical fiber connections',
        'option_d' => 'Attackers corrupt disk sectors storing database tables; defense is running disk defragmentation nightly',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q10 [Cyber - Difficult]
    $qs[] = [
        'prompt' => 'In web application penetration testing, what fundamental difference distinguishes Cross-Site Scripting (XSS) from Cross-Site Request Forgery (CSRF)?',
        'option_a' => 'XSS affects only SQL databases, whereas CSRF affects only NoSQL document stores',
        'option_b' => 'CSRF runs arbitrary JavaScript in the victim\'s browser, whereas XSS relies solely on sending emails',
        'option_c' => 'XSS exploits trusting the user\'s browser by executing malicious scripts in the application context, whereas CSRF exploits a web app\'s trust in the victim\'s authenticated browser session to execute unauthorized actions',
        'option_d' => 'XSS is an attack against server hardware CPU instructions, whereas CSRF is a physical hardware sniffing technique',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // =====================================================================================
    // —— CATEGORY 3: COMMUNICATION FOR TECH & ENGINEERING (5 Questions: 2 Easy, 1 Med, 2 Diff) ——
    // =====================================================================================

    // Q11 [Communication - Easy]
    $qs[] = [
        'prompt' => 'In an agile software development team, what is the primary purpose of a Daily Standup meeting?',
        'option_a' => 'Conducting multi-hour exhaustive code debugging sessions with the whole company',
        'option_b' => 'Delivering formal sales and marketing presentations to external venture investors',
        'option_c' => 'Briefly sharing what was completed, what is planned next, and any blockers with teammates',
        'option_d' => 'Assigning blame to individual developers for unresolved software bugs',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q12 [Communication - Easy]
    $qs[] = [
        'prompt' => 'When writing technical documentation (such as an API guide or project setup manual), what is the key priority?',
        'option_a' => 'Clarity, accuracy, practical code examples, and keeping instructions up to date',
        'option_b' => 'Using elaborate poetic vocabulary with minimal actual code examples',
        'option_c' => 'Omitting prerequisite installation steps so users have to troubleshoot alone',
        'option_d' => 'Writing documentation once and never updating it as the system changes',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q13 [Communication - Medium]
    $qs[] = [
        'prompt' => 'When explaining a technical production outage or bug to non-technical business stakeholders, what is the best communication strategy?',
        'option_a' => 'Send raw server stack traces and terminal error dumps directly to the stakeholders',
        'option_b' => 'Use clear, plain language focusing on business impact, current status, and resolution steps rather than deep technical jargon',
        'option_c' => 'Use complex engineering acronyms to sound authoritative and dismiss further questions quickly',
        'option_d' => 'Avoid giving any explanation and ask them to inspect the code repository themselves',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q14 [Communication - Difficult]
    $qs[] = [
        'prompt' => 'During an asynchronous code review or architectural debate, a senior engineer sharply criticizes your design pattern. What is the most constructive professional response?',
        'option_a' => 'Take the critique personally, withdraw the pull request, and avoid collaborating with that engineer in future sprints',
        'option_b' => 'Publicly argue on company chat channels to prove your pattern is superior before reviewing their feedback',
        'option_c' => 'Acknowledge the feedback objectively, ask targeted questions to understand trade-offs, and suggest a follow-up discussion with code alternatives',
        'option_d' => 'Silently accept all requested changes without understanding why or verifying if they break existing system constraints',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q15 [Communication - Difficult]
    $qs[] = [
        'prompt' => 'When leading an incident post-mortem (root cause analysis) after a severe security breach or service downtime, which principle is essential for fostering long-term engineering reliability?',
        'option_a' => 'A Blameless Post-Mortem culture that investigates systemic vulnerabilities, process gaps, and automated safeguards rather than penalizing individuals',
        'option_b' => 'Identifying and publicly penalizing the specific engineer who committed the flawed code to prevent future mistakes',
        'option_c' => 'Restricting post-mortem meeting access only to executive leadership to prevent team embarrassment',
        'option_d' => 'Closing the incident ticket immediately without documenting why the failure occurred to save developer time',
        'correct_option' => 'a',
        'points' => 1,
    ];

    return $qs;
}

/**
 * Ensure Syncpedia fresher assessment exists (idempotent).
 */
function syncpediaEnsureFresherBasicsAssessment(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $db->exec("ALTER TABLE peaklyy_assessments ADD COLUMN ui_theme VARCHAR(32) NOT NULL DEFAULT 'peaklyy'");
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessments ADD COLUMN interest_options_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN interest_selected_json JSON NULL');
    } catch (Throwable $e) {
    }

    $assessmentsToEnsure = [
        [
            'slug' => syncpediaFresherBasicsSlug(),
            'title' => 'Syncpedia Basics',
            'brand_name' => 'Syncpedia',
            'brand_tagline' => 'Pick a domain · 10 aptitude + 20 domain · 20 minutes',
            'api_key' => syncpediaFresherBasicsApiKey(),
        ],
        [
            'slug' => syncpediaAssignmentSlug(),
            'title' => 'Syncpedia',
            'brand_name' => 'Syncpedia',
            'brand_tagline' => 'Cybersecurity · Ethical Hacking · AI — basics',
            'api_key' => syncpediaAssignmentApiKey(),
        ],
    ];

    foreach ($assessmentsToEnsure as $spec) {
        $slug = $spec['slug'];
        $title = $spec['title'];
        $brandName = $spec['brand_name'];
        $brandTagline = $spec['brand_tagline'];
        $apiKey = $spec['api_key'];
        $isBasics = ($slug === syncpediaFresherBasicsSlug());
        $defs = $isBasics ? syncpediaBasicsQuestionDefs() : syncpediaAssignmentQuestionDefs();
        $storedCount = $isBasics
            ? (function_exists('syncpediaBasicsPaperQuestionCount') ? syncpediaBasicsPaperQuestionCount() : 30)
            : count($defs);
        $duration = $isBasics
            ? (function_exists('syncpediaBasicsDurationMinutes') ? syncpediaBasicsDurationMinutes() : 20)
            : 9;
        $oncePer = $isBasics ? 1 : 0;

        $st = $db->prepare('SELECT id FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
        $st->execute([$slug]);
        $existingId = $st->fetchColumn();

        if ($existingId) {
            try {
                $db->prepare(
                    "UPDATE peaklyy_assessments SET
                        title = ?, brand_name = ?, brand_tagline = ?,
                        duration_minutes = ?, question_count = ?, source_mode = 'custom',
                        pass_score = 60, once_per_candidate = ?, anti_cheat = 0, is_active = 1,
                        ui_theme = 'syncpedia', interest_options_json = NULL,
                        result_api_key = COALESCE(NULLIF(result_api_key,''), ?)
                     WHERE id = ?"
                )->execute([
                    $title,
                    $brandName,
                    $brandTagline,
                    $duration,
                    $storedCount,
                    $oncePer,
                    $apiKey,
                    $existingId,
                ]);
            } catch (Throwable $e) {
                try {
                    $db->prepare(
                        "UPDATE peaklyy_assessments SET title = ?, brand_name = ?, brand_tagline = ?,
                         duration_minutes = ?, question_count = ?, once_per_candidate = ?, is_active = 1 WHERE id = ?"
                    )->execute([
                        $title,
                        $brandName,
                        $brandTagline,
                        $duration,
                        $storedCount,
                        $oncePer,
                        $existingId,
                    ]);
                } catch (Throwable $e2) {
                }
            }
            // Refresh questions if definition changed or empty
            try {
                $firstPrompt = $defs[0]['prompt'] ?? '';
                $cntQ = $db->prepare('SELECT COUNT(*) FROM peaklyy_assessment_questions WHERE assessment_id = ? AND is_active = 1');
                $cntQ->execute([$existingId]);
                $liveQ = (int) $cntQ->fetchColumn();
                $chk = $db->prepare('SELECT prompt FROM peaklyy_assessment_questions WHERE assessment_id = ? AND is_active = 1 ORDER BY sort_order ASC LIMIT 1');
                $chk->execute([$existingId]);
                $currentFirstPrompt = (string) $chk->fetchColumn();
                $needRefresh = $liveQ !== count($defs) || $currentFirstPrompt !== $firstPrompt;
                if ($needRefresh && function_exists('peaklyyInsertCustomQuestions')) {
                    $db->prepare('UPDATE peaklyy_assessment_questions SET is_active = 0 WHERE assessment_id = ?')->execute([$existingId]);
                    peaklyyInsertCustomQuestions($db, (string) $existingId, $defs);
                }
            } catch (Throwable $e) {
            }
            continue;
        }

        $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
        try {
            $db->prepare(
                "INSERT INTO peaklyy_assessments
                 (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
                  pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by,
                  ui_theme, interest_options_json)
                 VALUES (?,?,?,?,?,?,?, 'custom', 60, ?, 0, NULL, ?, 1, NULL, 'syncpedia', NULL)"
            )->execute([
                $id,
                $slug,
                $title,
                $brandName,
                $brandTagline,
                $duration,
                $storedCount,
                $oncePer,
                $apiKey,
            ]);
        } catch (Throwable $e) {
            try {
                $db->prepare(
                    "INSERT INTO peaklyy_assessments
                     (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
                      pass_score, once_per_candidate, anti_cheat, result_api_key, is_active)
                     VALUES (?,?,?,?,?,?,?, 'custom', 60, ?, 0, ?, 1)"
                )->execute([
                    $id,
                    $slug,
                    $title,
                    $brandName,
                    $brandTagline,
                    $duration,
                    $storedCount,
                    $oncePer,
                    $apiKey,
                ]);
            } catch (Throwable $e3) {
                error_log('[syncpedia] create assessment (' . $slug . '): ' . $e3->getMessage());
                continue;
            }
        }

        if (function_exists('peaklyyInsertCustomQuestions')) {
            peaklyyInsertCustomQuestions($db, $id, $defs);
                try {
                $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')->execute([$storedCount, $id]);
                } catch (Throwable $e) {
            }
        }
    }
}
