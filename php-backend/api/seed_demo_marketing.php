<?php
/**
 * Demo top-up for the Marketing role (run AFTER seed_demo_org.php).
 *
 *   php seed_demo_marketing.php            dry run: prints what it would do, writes nothing
 *   php seed_demo_marketing.php --apply    writes it (all or nothing)
 *   --org=<slug or name>                   default: grootdigitals
 *
 * Gives the demo marketing member (first user with role "marketing" in the seeded team) their own data,
 * because marketing users only see what they created / what came in on their referral code:
 *  - ~150 existing seeded leads get referred_by = their referral code (form, Instagram, Google Ads,
 *    website leads that had no referrer) so Form Leads, Imported Leads and the dashboard fill in;
 *  - email drafts, email campaigns with per-recipient sends (sent / failed / one scheduled campaign);
 *  - WhatsApp drafts and campaigns with sends.
 * Every inserted row is recorded in demo_seed_registry (same batch as seed_demo_org.php), so
 * `php seed_demo_org.php --cleanup --apply` removes it together with the rest of the demo data.
 * Running it twice does nothing the second time.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/helpers.php';

while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

const MKT_SEED_BATCH = 'dummy_2026_11';

$argvList = array_slice($argv, 1);
$apply = in_array('--apply', $argvList, true);
$orgArg = 'grootdigitals';
foreach ($argvList as $a) {
    if (str_starts_with($a, '--org=')) {
        $orgArg = trim(substr($a, 6));
    }
}

date_default_timezone_set('Asia/Kolkata');
$db = (new Database())->getConnection();
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
mt_srand(20261120);

// ── Org ─────────────────────────────────────────────────────────────────
$needle = strtolower(preg_replace('/[^a-z0-9]/i', '', $orgArg) ?? '');
$orgRows = [];
foreach ($db->query('SELECT id, name, slug FROM organizations')->fetchAll(PDO::FETCH_ASSOC) ?: [] as $o) {
    $s = strtolower(preg_replace('/[^a-z0-9]/i', '', (string) $o['slug']) ?? '');
    $n = strtolower(preg_replace('/[^a-z0-9]/i', '', (string) $o['name']) ?? '');
    if ($needle !== '' && ($s === $needle || $n === $needle)) {
        $orgRows[] = $o;
    }
}
if (count($orgRows) !== 1) {
    fwrite(STDERR, 'Expected exactly one organization matching "' . $orgArg . '", found ' . count($orgRows) . ".\n");
    exit(1);
}
$ORG = (string) $orgRows[0]['id'];
echo "Organization: {$orgRows[0]['name']} ({$orgRows[0]['slug']})\n";

// ── Demo HR members: Form Management (HR forms) + Offer Letters ──────────
// Same as an admin ticking them in Team → Configure pages. Idempotent.
$hrSt = $db->prepare(
    "SELECT u.id, u.full_name, u.page_access_json
       FROM users u
       JOIN demo_seed_registry r ON r.tbl = 'users' AND r.row_id COLLATE utf8mb4_unicode_ci = u.id AND r.batch = ? AND r.org_id = ?
      WHERE u.role = 'hr'"
);
$hrSt->execute([MKT_SEED_BATCH, $ORG]);
$hrPages = [
    'dashboard' => true, 'my_leads' => true, 'assigned_leads' => true, 'tasks' => true, 'reports' => true,
    'notifications' => true, 'holidays' => true, 'settings' => true,
    'offer_letters' => true, 'form_management' => true, 'communications' => false,
];
foreach ($hrSt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $hr) {
    $cur = json_decode((string) ($hr['page_access_json'] ?? ''), true);
    if (is_array($cur) && !empty($cur['pages']['form_management']) && !empty($cur['pages']['offer_letters'])) {
        echo "HR {$hr['full_name']}: Form Management + Offer Letters already granted\n";
        continue;
    }
    if ($apply) {
        $db->prepare('UPDATE users SET page_access_json = ? WHERE id = ?')->execute([
            json_encode(['payments' => false, 'offer_letters' => true, 'pages' => $hrPages], JSON_UNESCAPED_UNICODE),
            $hr['id'],
        ]);
    }
    echo "HR {$hr['full_name']}: " . ($apply ? 'granted' : 'would grant') . " Form Management + Offer Letters\n";
}

// ── Seeded marketing member ─────────────────────────────────────────────
$st = $db->prepare(
    "SELECT u.id, u.full_name, u.email, u.referral_code
       FROM users u
       JOIN demo_seed_registry r ON r.tbl = 'users' AND r.row_id COLLATE utf8mb4_unicode_ci = u.id AND r.batch = ? AND r.org_id = ?
      WHERE u.role = 'marketing'
      ORDER BY u.created_at ASC LIMIT 1"
);
$st->execute([MKT_SEED_BATCH, $ORG]);
$mk = $st->fetch(PDO::FETCH_ASSOC);
if (!$mk) {
    fwrite(STDERR, "No seeded marketing member found. Run seed_demo_org.php --apply first.\n");
    exit(1);
}
$MK = (string) $mk['id'];
$code = trim((string) ($mk['referral_code'] ?? ''));
echo "Marketing member: {$mk['full_name']} <{$mk['email']}> referral code: " . ($code !== '' ? $code : '(none)') . "\n";

// Already done?
$chk = $db->prepare("SELECT COUNT(*) FROM demo_seed_registry r JOIN email_campaigns c ON c.id = r.row_id COLLATE utf8mb4_unicode_ci
                      WHERE r.batch = ? AND r.org_id = ? AND r.tbl = 'email_campaigns' AND c.created_by = ?");
try {
    $chk->execute([MKT_SEED_BATCH, $ORG, $MK]);
    if ((int) $chk->fetchColumn() > 0) {
        echo "Marketing demo data already present for this member. Nothing to do.\n";
        exit(0);
    }
} catch (Throwable $e) {
    // email_campaigns missing: created below by the marketing schema helper
}

// Columns the email dispatcher adds lazily (scheduled_at etc.).
if (is_file(__DIR__ . '/lib/MarketingEmailDispatch.php')) {
    require_once __DIR__ . '/lib/MarketingEmailDispatch.php';
    try {
        marketingEnsureEmailDispatchSchema($db);
    } catch (Throwable $e) {
    }
}
foreach (['email_drafts', 'email_campaigns', 'email_sends', 'whatsapp_drafts', 'whatsapp_campaigns', 'whatsapp_sends'] as $t) {
    $tq = $db->prepare('SHOW TABLES LIKE ?');
    $tq->execute([$t]);
    if (!$tq->fetchColumn()) {
        fwrite(STDERR, "Table {$t} does not exist yet. Open Marketing → Email/WhatsApp once in the app, then re-run.\n");
        exit(1);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────
$counts = [];
function mkCols(PDO $db, string $t): array
{
    static $cache = [];
    if (!isset($cache[$t])) {
        $cache[$t] = [];
        foreach ($db->query("SHOW COLUMNS FROM `{$t}`")->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $cache[$t][$c['Field']] = true;
        }
    }
    return $cache[$t];
}
function mkInsert(PDO $db, string $t, array $row): string
{
    global $counts, $ORG;
    $cols = mkCols($db, $t);
    $row = array_intersect_key($row, $cols);
    $names = array_keys($row);
    $db->prepare('INSERT INTO `' . $t . '` (`' . implode('`,`', $names) . '`) VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')')
        ->execute(array_values($row));
    $id = (string) $row['id'];
    $db->prepare('INSERT IGNORE INTO demo_seed_registry (batch, org_id, tbl, row_id) VALUES (?, ?, ?, ?)')
        ->execute([MKT_SEED_BATCH, $ORG, $t, $id]);
    $counts[$t] = ($counts[$t] ?? 0) + 1;
    return $id;
}
function mkAt(float $daysAgo, int $h1 = 10, int $h2 = 18): string
{
    $d = (new DateTimeImmutable('today'))->modify('-' . (int) floor($daysAgo) . ' days')
        ->setTime(mt_rand($h1, $h2), mt_rand(0, 59), mt_rand(0, 59));
    $now = new DateTimeImmutable('now');
    if ($d > $now) {
        $d = $now->modify('-' . mt_rand(10, 180) . ' minutes');
    }
    return $d->format('Y-m-d H:i:s');
}
function mkPlus(string $at, int $seconds): string
{
    return (new DateTimeImmutable($at))->modify("+{$seconds} seconds")->format('Y-m-d H:i:s');
}

$db->beginTransaction();
try {
    // ── 1. Referral code ────────────────────────────────────────────────
    if ($code === '') {
        $code = function_exists('referralCodeForNewOrgUser')
            ? referralCodeForNewOrgUser($db, $ORG, 'marketing', (string) $mk['full_name'])
            : 'MKT' . mt_rand(1000, 9999);
        $db->prepare('UPDATE users SET referral_code = ? WHERE id = ?')->execute([$code, $MK]);
        echo "  gave the marketing member referral code {$code}\n";
    }

    // ── 2. Leads that came in on the marketing member's links ───────────
    $leadSt = $db->prepare(
        "SELECT l.id, l.name, l.email, l.phone, l.source, l.created_at
           FROM leads l
           JOIN demo_seed_registry r ON r.tbl = 'leads' AND r.row_id COLLATE utf8mb4_unicode_ci = l.id AND r.batch = ? AND r.org_id = ?
          WHERE (l.referred_by IS NULL OR l.referred_by = '')
            AND (l.source LIKE 'form\\_%' OR l.source IN ('instagram', 'google_ads', 'website', 'facebook', 'youtube'))
            AND l.source NOT IN ('form_internship-application')
          ORDER BY l.created_at DESC
          LIMIT 150"
    );
    $leadSt->execute([MKT_SEED_BATCH, $ORG]);
    $myLeads = $leadSt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($myLeads !== []) {
        $upd = $db->prepare('UPDATE leads SET referred_by = ? WHERE id = ?');
        foreach ($myLeads as $l) {
            $upd->execute([$code, $l['id']]);
        }
    }
    echo '  leads credited to the marketing member: ' . count($myLeads) . "\n";

    $emails = array_values(array_filter(array_map(static fn($l) => trim((string) ($l['email'] ?? '')), $myLeads)));
    $phones = array_values(array_filter(array_map(static fn($l) => trim((string) ($l['phone'] ?? '')), $myLeads)));
    if (count($emails) < 40 || count($phones) < 40) {
        // Fall back to any seeded leads for recipients.
        $more = $db->prepare("SELECT l.email, l.phone FROM leads l JOIN demo_seed_registry r ON r.tbl = 'leads' AND r.row_id COLLATE utf8mb4_unicode_ci = l.id
                               AND r.batch = ? AND r.org_id = ? ORDER BY l.created_at DESC LIMIT 300");
        $more->execute([MKT_SEED_BATCH, $ORG]);
        foreach ($more->fetchAll(PDO::FETCH_ASSOC) ?: [] as $m) {
            if (!empty($m['email'])) {
                $emails[] = (string) $m['email'];
            }
            if (!empty($m['phone'])) {
                $phones[] = (string) $m['phone'];
            }
        }
        $emails = array_values(array_unique($emails));
        $phones = array_values(array_unique($phones));
    }

    // ── 3. Email drafts ─────────────────────────────────────────────────
    $brand = (string) $orgRows[0]['name'];
    $emailDrafts = [
        ['Weekend batch launch', 'New weekend batches start 6 December — seats filling fast',
            "<p>Hi {{name}},</p><p>Our new <b>weekend batches</b> for Full Stack, Data Science and Digital Marketing start on <b>6 December</b>. Classes run Saturday and Sunday, 10 am to 1 pm, online or at our centre.</p><p>Reply to this email or call us to block your seat.</p><p>Team {$brand}</p>"],
        ['Free demo invite', 'Join a free 60-minute demo class this Saturday',
            "<p>Hi {{name}},</p><p>See how our classes work before you decide. Join a <b>free live demo</b> this Saturday at 11 am — meet the trainer, try a mini project and ask about placements.</p><p>Team {$brand}</p>"],
        ['Early-bird fee offer', 'Save ₹5,000 with early-bird enrolment till 30 November',
            "<p>Hi {{name}},</p><p>Enrol before <b>30 November</b> and get ₹5,000 off the course fee, with easy installments.</p><p>Team {$brand}</p>"],
        ['Placement success stories', '42 of our learners got placed this quarter',
            "<p>Hi {{name}},</p><p>This quarter 42 learners joined companies like Infosys, Deloitte and Zoho. Read their stories and see the skills they built with us.</p><p>Team {$brand}</p>"],
    ];
    $draftIds = [];
    foreach ($emailDrafts as $i => [$name, $subject, $html]) {
        $at = mkAt(26 - $i * 6);
        $draftIds[] = mkInsert($db, 'email_drafts', [
            'id' => generateUUID(), 'name' => $name, 'subject' => $subject, 'html_body' => $html,
            'plain_text' => trim(strip_tags(str_replace('</p>', "\n", $html))), 'status' => 'draft',
            'created_by' => $MK, 'org_id' => $ORG, 'created_at' => $at, 'updated_at' => $at,
        ]);
    }

    // ── 4. Email campaigns + sends ──────────────────────────────────────
    // [draft index, days ago, recipients, failed, scheduled-in-future?]
    $emailPlan = [[0, 21, 48, 2, false], [1, 14, 62, 3, false], [3, 7, 55, 1, false], [2, 2, 40, 2, false], [1, -3, 35, 0, true]];
    $ePtr = 0;
    foreach ($emailPlan as [$di, $ago, $n, $failed, $future]) {
        $subject = $emailDrafts[$di][1];
        $createdAt = $future ? mkAt(0) : mkAt((float) $ago);
        $schedAt = $future ? (new DateTimeImmutable('today'))->modify('+3 days')->setTime(10, 0)->format('Y-m-d H:i:s') : null;
        $sent = $future ? 0 : $n - $failed;
        $cid = mkInsert($db, 'email_campaigns', [
            'id' => generateUUID(), 'subject' => $subject, 'draft_id' => $draftIds[$di],
            'recipient_count' => $n, 'sent_count' => $sent, 'failed_count' => $future ? 0 : $failed,
            'pending_count' => $future ? $n : 0, 'status' => $future ? 'scheduled' : ($failed > 0 ? 'partial' : 'completed'),
            'scheduled_at' => $schedAt, 'created_by' => $MK, 'org_id' => $ORG,
            'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]);
        for ($k = 0; $k < $n; $k++) {
            $to = $emails[($ePtr++) % max(1, count($emails))] ?? ('learner' . $k . '@example.com');
            $isFailed = !$future && $k >= $n - $failed;
            mkInsert($db, 'email_sends', [
                'id' => generateUUID(), 'campaign_id' => $cid, 'recipient_email' => $to,
                'status' => $future ? 'pending' : ($isFailed ? 'failed' : 'sent'),
                'sent_at' => ($future || $isFailed) ? null : mkPlus($createdAt, 20 + $k * 7),
                'scheduled_at' => $schedAt, 'sent_subject' => $subject,
                'error_message' => $isFailed ? 'Mailbox does not exist (550 5.1.1)' : null,
                'created_at' => $createdAt,
            ]);
        }
    }

    // ── 5. WhatsApp drafts + campaigns + sends ──────────────────────────
    $waDrafts = [
        ['Demo reminder', 'Demo reminder', "Hi {{1}}, this is a reminder for your free demo class tomorrow at 11 am. Reply YES to confirm your seat. – {$brand}"],
        ['Fee installment reminder', 'Installment reminder', "Hi {{1}}, your next course installment is due on {{2}}. Pay securely using the link we sent by email. – {$brand}"],
        ['Batch starting soon', 'Batch starting soon', "Hi {{1}}, the new weekend batch starts this Saturday. Reply to this message to reserve your seat. – {$brand}"],
    ];
    $waDraftIds = [];
    foreach ($waDrafts as $i => [$name, $subject, $body]) {
        $at = mkAt(18 - $i * 5);
        $waDraftIds[] = mkInsert($db, 'whatsapp_drafts', [
            'id' => generateUUID(), 'name' => $name, 'subject' => $subject, 'body' => $body, 'status' => 'draft',
            'created_by' => $MK, 'org_id' => $ORG, 'created_at' => $at, 'updated_at' => $at,
        ]);
    }
    $waPlan = [[0, 12, 38, 2], [2, 5, 52, 3], [0, 1, 30, 1]];
    $pPtr = 0;
    foreach ($waPlan as [$di, $ago, $n, $failed]) {
        $createdAt = mkAt((float) $ago);
        $cid = mkInsert($db, 'whatsapp_campaigns', [
            'id' => generateUUID(), 'subject' => $waDrafts[$di][1], 'draft_id' => $waDraftIds[$di],
            'recipient_count' => $n, 'sent_count' => $n - $failed, 'failed_count' => $failed, 'pending_count' => 0,
            'status' => 'completed', 'created_by' => $MK, 'org_id' => $ORG,
            'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]);
        for ($k = 0; $k < $n; $k++) {
            $isFailed = $k >= $n - $failed;
            mkInsert($db, 'whatsapp_sends', [
                'id' => generateUUID(), 'campaign_id' => $cid,
                'recipient_phone' => $phones[($pPtr++) % max(1, count($phones))] ?? ('+9190000' . str_pad((string) $k, 5, '0', STR_PAD_LEFT)),
                'status' => $isFailed ? 'failed' : 'sent',
                'sent_at' => $isFailed ? null : mkPlus($createdAt, 15 + $k * 5),
                'error_message' => $isFailed ? 'Number is not on WhatsApp' : null,
                'created_at' => $createdAt,
            ]);
        }
    }

    foreach ($counts as $t => $c) {
        printf("  %-20s %5d rows\n", $t, $c);
    }
    if ($apply) {
        $db->commit();
        echo "Done. Sign in as {$mk['email']} to see it.\n";
    } else {
        $db->rollBack();
        echo "Dry run — nothing written. Re-run with --apply.\n";
    }
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, 'Failed, nothing written: ' . $e->getMessage() . "\n");
    exit(1);
}
