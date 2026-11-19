<?php
/**
 * Demo data for ONE organization (default "grootdigitals"), so every CRM page has something
 * meaningful to show in a sales demo. CLI only.
 *
 *   php seed_demo_org.php                     dry run: builds everything inside one transaction,
 *                                             prints what it would create, then rolls back
 *   php seed_demo_org.php --apply             writes it (all or nothing)
 *   php seed_demo_org.php --cleanup           dry run of the cleanup
 *   php seed_demo_org.php --cleanup --apply   deletes ONLY rows this script created
 *   --org=<slug or name>                      default: grootdigitals
 *
 * Safety:
 *  - Everything is scoped to the one org found by --org; the script stops unless exactly one matches.
 *  - Every row it creates is recorded in `demo_seed_registry` (batch dummy_2026_11). Cleanup deletes
 *    exactly those rows and nothing else. People get @example.com emails.
 *  - Rows are written straight to the database, the same way the API stores them, so no emails,
 *    SMS, WhatsApp, push notifications, webhooks or Razorpay calls happen. Payment links get
 *    reconcile_needed = 0 and enrollment_applied_at set, so the reconcile cron and the
 *    enrollment fulfilment never pick them up. Lead forms get no auto-document settings, so the
 *    certificate cron ignores them.
 *  - Re-running after a successful seed does nothing (it reports the existing batch).
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/CallLogDailyReportSync.php';
require_once __DIR__ . '/lib/Timetables.php';
require_once __DIR__ . '/lib/PaymentCandidates.php';
require_once __DIR__ . '/payment_link_store.php';

// helpers.php buffers output for JSON APIs; print progress straight to the terminal instead.
while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

const SEED_BATCH = 'dummy_2026_11';

function seedStep(string $msg): void
{
    echo '[' . date('H:i:s') . "] {$msg}\n";
}

$argvList = array_slice($argv, 1);
$apply = in_array('--apply', $argvList, true);
$cleanup = in_array('--cleanup', $argvList, true);
$orgArg = 'grootdigitals';
foreach ($argvList as $a) {
    if (str_starts_with($a, '--org=')) {
        $orgArg = trim(substr($a, 6));
    }
}

date_default_timezone_set('Asia/Kolkata');
$db = (new Database())->getConnection();
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// ── Registry of seeded rows ─────────────────────────────────────────────
$db->exec(
    'CREATE TABLE IF NOT EXISTS demo_seed_registry (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        batch VARCHAR(40) NOT NULL,
        org_id CHAR(36) NOT NULL,
        tbl VARCHAR(64) NOT NULL,
        row_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_seed_row (batch, tbl, row_id),
        INDEX idx_seed_batch (batch, tbl)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

// ── Find the org ────────────────────────────────────────────────────────
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
    foreach ($orgRows as $o) {
        fwrite(STDERR, "  {$o['id']}  {$o['name']}  ({$o['slug']})\n");
    }
    exit(1);
}
$ORG = (string) $orgRows[0]['id'];
echo "Organization: {$orgRows[0]['name']} ({$orgRows[0]['slug']}) id={$ORG}\n";

// ═══════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════
if ($cleanup) {
    // Children before parents. Seeded users go last; their remaining child rows cascade.
    $order = [
        'payment_candidate_link_payments', 'payment_links', 'manual_payments', 'payment_candidates',
        'payments', 'coupons', 'daily_reports', 'call_logs', 'tasks', 'notifications', 'audit_log',
        'activities', 'lead_activities', 'timetable_sessions', 'timetables', 'students', 'hr_leads',
        'lead_form_assignments', 'leads', 'lead_forms', 'holidays', 'batches', 'courses',
        'marketing_members', 'users',
    ];
    $st = $db->prepare('SELECT tbl, row_id FROM demo_seed_registry WHERE batch = ? AND org_id = ?');
    $st->execute([SEED_BATCH, $ORG]);
    $byTable = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
        $byTable[$r['tbl']][] = $r['row_id'];
    }
    if ($byTable === []) {
        echo "Nothing to clean up: no rows recorded for batch " . SEED_BATCH . " in this org.\n";
        exit(0);
    }
    foreach (array_keys($byTable) as $t) {
        if (!in_array($t, $order, true)) {
            $order[] = $t;
        }
    }
    $db->beginTransaction();
    try {
        foreach ($order as $t) {
            $ids = $byTable[$t] ?? [];
            if ($ids === []) {
                continue;
            }
            $deleted = 0;
            foreach (array_chunk($ids, 200) as $chunk) {
                $ph = implode(',', array_fill(0, count($chunk), '?'));
                $del = $db->prepare("DELETE FROM `{$t}` WHERE id IN ({$ph})");
                $del->execute($chunk);
                $deleted += $del->rowCount();
            }
            printf("  %-34s %6d recorded, %6d deleted\n", $t, count($ids), $deleted);
        }
        if ($apply) {
            $db->prepare('DELETE FROM demo_seed_registry WHERE batch = ? AND org_id = ?')->execute([SEED_BATCH, $ORG]);
            $db->commit();
            echo "Cleanup done.\n";
        } else {
            $db->rollBack();
            echo "Dry run — nothing deleted. Re-run with --cleanup --apply to delete.\n";
        }
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        fwrite(STDERR, 'Cleanup failed, nothing deleted: ' . $e->getMessage() . "\n");
        exit(1);
    }
    exit(0);
}

// ═══════════════════════════════════════════════════════════════════════
// SEED
// ═══════════════════════════════════════════════════════════════════════
$already = $db->prepare('SELECT COUNT(*) FROM demo_seed_registry WHERE batch = ? AND org_id = ?');
$already->execute([SEED_BATCH, $ORG]);
if ((int) $already->fetchColumn() > 0) {
    echo "Already seeded (batch " . SEED_BATCH . "). Nothing to do.\n";
    echo "To reseed: php " . basename(__FILE__) . " --cleanup --apply, then run this again.\n";
    exit(0);
}

// Schema helpers the app uses; they create/upgrade tables. Run before the transaction because
// MySQL commits implicitly on DDL.
foreach ([
    'ensureAuditLogTable', 'ensureLeadFormsTables', 'ensureLeadFormAssignmentsTable', 'ensureHrLeadsTableExists',
    'ensureStudentsLeadIdUnique', 'ensureStudentsEnrolledByColumn', 'timetablesEnsureSchema',
    'paymentCandidatesEnsureSchema', 'paymentLinkEnsureSchema', 'syncpediaEnsureDailyReportsLostColumn',
    'ensureLeadsSourceColumnVarchar', 'ensureLeadsCreatedByColumn',
] as $fn) {
    if (function_exists($fn)) {
        try {
            $fn($db);
        } catch (Throwable $e) {
            echo "  note: {$fn}: {$e->getMessage()}\n";
        }
    }
}
if (function_exists('ensureLeadsStatusColumn')) {
    try {
        ensureLeadsStatusColumn($db);
    } catch (Throwable $e) {
    }
}

mt_srand(20261119);

/** @var array<string, array<string, array{nullable:bool, default:mixed, extra:string, type:string}>> */
$COLS = [];
function seedCols(PDO $db, string $t): array
{
    global $COLS;
    if (!array_key_exists($t, $COLS)) {
        $st = $db->prepare(
            'SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_TYPE
               FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
        );
        $st->execute([$t]);
        $cols = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $c) {
            $cols[$c['COLUMN_NAME']] = [
                'nullable' => $c['IS_NULLABLE'] === 'YES',
                'default' => $c['COLUMN_DEFAULT'],
                'extra' => strtolower((string) $c['EXTRA']),
                'type' => strtolower((string) $c['COLUMN_TYPE']),
            ];
        }
        $COLS[$t] = $cols;
    }
    return $COLS[$t];
}

function seedHasTable(PDO $db, string $t): bool
{
    return seedCols($db, $t) !== [];
}

/** @var array<string,int> */
$STATS = [];
/** @var array<string, list<string>> */
$SKIPPED_COLS = [];

/**
 * Insert one row (only columns that exist), record it in the registry, return its id.
 * Fails loudly when a required column has no value.
 */
function seedInsert(PDO $db, string $t, array $row): string
{
    global $STATS, $SKIPPED_COLS, $ORG;
    $cols = seedCols($db, $t);
    if ($cols === []) {
        throw new RuntimeException("table {$t} does not exist");
    }
    $data = [];
    foreach ($row as $k => $v) {
        if (array_key_exists($k, $cols)) {
            $data[$k] = $v;
        } elseif (!in_array($k, $SKIPPED_COLS[$t] ?? [], true)) {
            $SKIPPED_COLS[$t][] = $k;
        }
    }
    foreach ($cols as $name => $c) {
        if (!$c['nullable'] && $c['default'] === null && !str_contains($c['extra'], 'auto_increment')
            && !str_contains($c['extra'], 'generated') && !array_key_exists($name, $data)) {
            throw new RuntimeException("{$t}.{$name} is required but the seed has no value for it");
        }
    }
    static $stmts = [];
    $names = array_keys($data);
    $sql = 'INSERT INTO `' . $t . '` (`' . implode('`,`', $names) . '`) VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')';
    $stmts[$sql] ??= $db->prepare($sql);
    $stmts[$sql]->execute(array_values($data));
    $id = array_key_exists('id', $data) ? (string) $data['id'] : (string) $db->lastInsertId();
    $stmts['__reg'] ??= $db->prepare('INSERT INTO demo_seed_registry (batch, org_id, tbl, row_id) VALUES (?, ?, ?, ?)');
    $stmts['__reg']->execute([SEED_BATCH, $ORG, $t, $id]);
    $STATS[$t] = ($STATS[$t] ?? 0) + 1;
    return $id;
}

function seedRegister(PDO $db, string $t, string $id): void
{
    global $STATS, $ORG;
    $db->prepare('INSERT IGNORE INTO demo_seed_registry (batch, org_id, tbl, row_id) VALUES (?, ?, ?, ?)')
        ->execute([SEED_BATCH, $ORG, $t, $id]);
    $STATS[$t] = ($STATS[$t] ?? 0) + 1;
}

// ── Small random helpers ────────────────────────────────────────────────
function r01(): float
{
    return mt_rand() / mt_getrandmax();
}
function pick(array $a)
{
    return $a[array_rand($a)];
}
function pickW(array $weights)
{
    $sum = array_sum($weights);
    $x = r01() * $sum;
    foreach ($weights as $k => $w) {
        $x -= $w;
        if ($x <= 0) {
            return $k;
        }
    }
    return array_key_last($weights);
}
function uuid(): string
{
    return generateUUID();
}
$NOW = new DateTimeImmutable('now');
$TODAY = new DateTimeImmutable('today');
function ts(DateTimeImmutable $d): string
{
    return $d->format('Y-m-d H:i:s');
}
function ymd(DateTimeImmutable $d): string
{
    return $d->format('Y-m-d');
}
/** A working-hours moment $days days ago. */
function daysAgo(float $days): DateTimeImmutable
{
    global $TODAY;
    $d = $TODAY->modify('-' . (int) floor($days) . ' days');
    return $d->setTime(mt_rand(9, 19), mt_rand(0, 59), mt_rand(0, 59));
}
/** Random moment between $a and $b. */
function between(DateTimeImmutable $a, DateTimeImmutable $b): DateTimeImmutable
{
    $x = $a->getTimestamp();
    $y = max($x, $b->getTimestamp());
    return (new DateTimeImmutable('@' . mt_rand($x, $y)))->setTimezone(new DateTimeZone('Asia/Kolkata'));
}

$FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Sai', 'Arjun', 'Rohan', 'Karthik', 'Rahul', 'Vikram', 'Nikhil', 'Harsha', 'Manoj', 'Pranav', 'Siddharth', 'Varun', 'Akhil', 'Tarun', 'Charan', 'Abhishek', 'Kiran', 'Rakesh', 'Naveen', 'Suresh', 'Ganesh', 'Teja', 'Mahesh', 'Ajay', 'Yash', 'Dhruv', 'Ishaan', 'Krishna', 'Srinivas', 'Venkat', 'Anil', 'Ravi', 'Deepak', 'Gautham', 'Hemanth', 'Lokesh', 'Pavan'];
$FIRST_F = ['Ananya', 'Diya', 'Saanvi', 'Aishwarya', 'Priya', 'Sneha', 'Keerthi', 'Divya', 'Pooja', 'Meghana', 'Lakshmi', 'Swathi', 'Harika', 'Bhavana', 'Sravani', 'Nandini', 'Kavya', 'Ishita', 'Riya', 'Shruti', 'Anusha', 'Deepika', 'Sahithi', 'Tejaswini', 'Manasa', 'Ramya', 'Neha', 'Pallavi', 'Varsha', 'Akshara', 'Gayathri', 'Sindhu', 'Mounika', 'Haritha', 'Vaishnavi'];
$LAST = ['Reddy', 'Rao', 'Naidu', 'Sharma', 'Verma', 'Iyer', 'Nair', 'Menon', 'Kumar', 'Patel', 'Gupta', 'Chowdary', 'Varma', 'Pillai', 'Krishnan', 'Joshi', 'Kulkarni', 'Deshmukh', 'Agarwal', 'Bhat', 'Shetty', 'Goud', 'Yadav', 'Mishra', 'Banerjee', 'Das', 'Singh', 'Mehta', 'Kapoor', 'Srinivasan', 'Subramanian', 'Raju', 'Prasad', 'Murthy', 'Hegde'];
$COLLEGES = [
    'JNTU Hyderabad', 'Osmania University', 'CBIT Hyderabad', 'VNR VJIET', 'Vasavi College of Engineering', 'MGIT Hyderabad',
    'GITAM Visakhapatnam', 'Andhra University', 'VR Siddhartha Engineering College', 'KL University', 'Anna University',
    'SRM Institute of Science and Technology', 'VIT Vellore', 'PSG College of Technology', 'RV College of Engineering',
    'BMS College of Engineering', 'PES University', 'Christ University', 'COEP Pune', 'MIT World Peace University',
    'Symbiosis Institute of Technology', 'Delhi Technological University', 'NSUT Delhi', 'Amity University Noida',
    'Mumbai University', 'VJTI Mumbai', 'St. Joseph\'s College Bengaluru', 'Loyola College Chennai', 'Gayatri Vidya Parishad Vizag',
    'Sreenidhi Institute of Science and Technology',
];
$CITIES = ['Hyderabad', 'Bengaluru', 'Chennai', 'Pune', 'Delhi', 'Mumbai', 'Vizag', 'Vijayawada', 'Warangal', 'Guntur', 'Coimbatore', 'Noida'];
$YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Graduated'];
$YEAR_W = ['1st Year' => 8, '2nd Year' => 16, '3rd Year' => 28, '4th Year' => 30, 'Graduated' => 18];

$usedPhones = [];
function newPhone(): string
{
    global $usedPhones;
    do {
        $p = '+91' . pick(['6', '7', '8', '9']) . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT);
    } while (isset($usedPhones[$p]));
    $usedPhones[$p] = true;
    return $p;
}
$usedEmails = [];
function newEmail(string $first, string $last): string
{
    global $usedEmails;
    $base = strtolower(preg_replace('/[^a-z]/i', '', $first) . '.' . preg_replace('/[^a-z]/i', '', $last));
    $e = $base . '@example.com';
    $n = 1;
    while (isset($usedEmails[$e])) {
        $n++;
        $e = $base . $n . '@example.com';
    }
    $usedEmails[$e] = true;
    return $e;
}
function personName(): array
{
    global $FIRST_M, $FIRST_F, $LAST;
    $first = r01() < 0.55 ? pick($FIRST_M) : pick($FIRST_F);
    return [$first, pick($LAST)];
}

// ── Existing org admin (used as "created by" / approver) ───────────────
$adminSt = $db->prepare("SELECT id, full_name FROM users WHERE org_id = ? AND LOWER(role) IN ('org','admin') AND is_active = 1 ORDER BY created_at ASC LIMIT 1");
$adminSt->execute([$ORG]);
$admin = $adminSt->fetch(PDO::FETCH_ASSOC) ?: null;
$ADMIN_ID = $admin ? (string) $admin['id'] : null;
echo 'Org admin: ' . ($admin ? $admin['full_name'] : 'none found — seeded managers act as admin') . "\n";

$demoEmails = [];
$db->beginTransaction();
try {
    // ═══ 1. Team ════════════════════════════════════════════════════════
    seedStep("1. Team");
    $teamPlan = [
        ['Ravi Teja', 'Kondapalli', 'manager'],
        ['Sneha', 'Reddy', 'manager'],
        ['Harsha', 'Vardhan', 'operational_manager'],
        ['Karthik', 'Varma', 'sales_representative'],
        ['Priya', 'Nair', 'sales_representative'],
        ['Lakshmi', 'Menon', 'hr'],
        ['Arjun', 'Patel', 'hr'],
        ['Kavya', 'Joshi', 'marketing'],
    ];
    $chk = $db->prepare('SELECT COUNT(*) FROM users WHERE email = ?');
    foreach ($teamPlan as [$f, $l]) {
        $e = strtolower(str_replace(' ', '', $f) . '.' . $l) . '.demo@example.com';
        $chk->execute([$e]);
        if ((int) $chk->fetchColumn() > 0) {
            throw new RuntimeException("user {$e} already exists — this org looks seeded already (registry missing?)");
        }
    }
    $demoPassword = 'Demo@' . substr(bin2hex(random_bytes(6)), 0, 8);
    $hash = password_hash($demoPassword, PASSWORD_DEFAULT);
    $team = [];
    $managers = [];
    $reps = [];
    $hrs = [];
    $marketing = [];
    $oms = [];
    foreach ($teamPlan as $i => [$f, $l, $role]) {
        $id = uuid();
        $name = $f . ' ' . $l;
        $email = strtolower(str_replace(' ', '', $f) . '.' . $l) . '.demo@example.com';
        $usedEmails[$email] = true;
        // Managers and the operational manager report to the org admin; everyone else to a manager.
        $reportsTo = ($role === 'manager' || $role === 'operational_manager') ? $ADMIN_ID : null;
        if ($role === 'sales_representative' || $role === 'hr' || $role === 'marketing') {
            $reportsTo = $managers[count($reps) % 2]['id'] ?? null;
        }
        $joined = daysAgo(200 - $i * 4);
        seedInsert($db, 'users', [
            'id' => $id,
            'email' => $email,
            'password_hash' => $hash,
            'full_name' => $name,
            'phone' => newPhone(),
            'role' => $role,
            'org_id' => $ORG,
            'created_by' => $ADMIN_ID,
            'reports_to_id' => $reportsTo,
            'referral_code' => referralCodeForNewOrgUser($db, $ORG, $role, $name),
            'is_active' => 1,
            'created_at' => ts($joined),
        ]);
        $u = ['id' => $id, 'name' => $name, 'email' => $email, 'role' => $role];
        $refSt = $db->prepare('SELECT referral_code FROM users WHERE id = ?');
        $refSt->execute([$id]);
        $u['ref'] = (string) ($refSt->fetchColumn() ?: '');
        $team[] = $u;
        $demoEmails[] = "{$name} ({$role}): {$email}";
        if ($role === 'manager') {
            $managers[] = $u;
        } elseif ($role === 'sales_representative') {
            $reps[] = $u;
        } elseif ($role === 'hr') {
            $hrs[] = $u;
        } elseif ($role === 'operational_manager') {
            $oms[] = $u;
        } else {
            $marketing[] = $u;
        }
        if ($role === 'marketing' && seedHasTable($db, 'marketing_members')) {
            seedInsert($db, 'marketing_members', [
                'id' => uuid(), 'user_id' => $id, 'name' => $name, 'email' => $email, 'phone' => null,
                'status' => 'active', 'created_by' => $ADMIN_ID, 'org_id' => $ORG,
            ]);
        }
        if (seedHasTable($db, 'audit_log')) {
            seedInsert($db, 'audit_log', [
                'id' => uuid(), 'org_id' => $ORG, 'user_id' => $ADMIN_ID, 'user_name' => $admin['full_name'] ?? 'Org Admin',
                'action' => 'created', 'entity_type' => 'team_member', 'entity_id' => $id,
                'details' => "Created team member: {$name} ({$role})", 'created_at' => ts($joined),
            ]);
        }
    }
    $APPROVER = $ADMIN_ID ?? $managers[0]['id'];
    $repById = [];
    foreach ($team as $u) {
        $repById[$u['id']] = $u;
    }

    // ═══ 2. Courses ═════════════════════════════════════════════════════
    seedStep("2. Courses");
    $coursePlan = [
        ['Full Stack Development (MERN)', 65000, 24, 'HTML, CSS, JavaScript, React, Node.js, Express and MongoDB with three portfolio projects and placement prep.'],
        ['Data Science & AI', 85000, 26, 'Python, statistics, machine learning, deep learning and generative AI, ending in an industry capstone.'],
        ['Python Programming', 18000, 8, 'Core Python from basics to OOP, files, APIs and automation scripts. Ideal first course.'],
        ['Java Full Stack', 55000, 20, 'Core Java, Spring Boot, REST APIs, Hibernate, React front end and SQL.'],
        ['Digital Marketing', 25000, 12, 'SEO, Google Ads, Meta Ads, content and email marketing, analytics and live campaigns.'],
        ['UI/UX Design', 40000, 14, 'Design thinking, Figma, wireframes, prototyping, usability testing and a case-study portfolio.'],
        ['Cloud & DevOps (AWS)', 60000, 18, 'Linux, AWS core services, Docker, Kubernetes, CI/CD with GitHub Actions and Terraform.'],
        ['Cyber Security', 70000, 20, 'Networking, ethical hacking, VAPT, SOC operations and preparation for CEH-style exams.'],
        ['Data Analytics', 30000, 12, 'Excel, SQL, Power BI and Python for analysis, with dashboards built on real datasets.'],
    ];
    $courses = [];
    foreach ($coursePlan as $i => [$cname, $price, $weeks, $desc]) {
        $cid = uuid();
        seedInsert($db, 'courses', [
            'id' => $cid, 'name' => $cname, 'description' => $desc, 'price' => $price, 'duration_weeks' => $weeks,
            'is_active' => 1, 'org_id' => $ORG, 'created_at' => ts(daysAgo(190 - $i)),
        ]);
        $courses[] = ['id' => $cid, 'name' => $cname, 'price' => $price, 'weeks' => $weeks];
    }
    $COURSE_W = [14, 13, 12, 10, 11, 9, 10, 8, 13]; // interest weights, same order as $courses

    // ═══ 3. Batches + timetables ════════════════════════════════════════
    seedStep("3. Batches + timetables");
    $trainers = [$managers[0], $managers[1], $oms[0]];
    $batches = [];
    $trainerSlots = [];
    $slotTimes = [['07:00:00', '09:00:00'], ['09:30:00', '11:30:00'], ['12:00:00', '14:00:00'], ['14:30:00', '16:30:00'], ['17:00:00', '19:00:00'], ['19:30:00', '21:30:00']];
    $bi = 0;
    foreach ($courses as $ci => $c) {
        $n = $ci % 3 === 0 ? 3 : 2;
        // completed → ongoing → upcoming
        $offsets = $n === 3 ? [-210, -40, 25] : ($ci % 2 === 0 ? [-160, 12] : [-45, 30]);
        foreach ($offsets as $k => $startOffset) {
            $start = $TODAY->modify(($startOffset >= 0 ? '+' : '') . $startOffset . ' days');
            $end = $start->modify('+' . ($c['weeks'] * 7) . ' days');
            $bid = uuid();
            $mode = ($bi % 3 === 1) ? 'Offline' : 'Online';
            $label = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $c['name']) ?? 'BAT', 0, 3));
            $trainer = $trainers[$bi % count($trainers)];
            seedInsert($db, 'batches', [
                'id' => $bid,
                'name' => $label . '-' . $start->format('M y') . ' ' . $mode . ' Batch ' . ($k + 1),
                'course_id' => $c['id'],
                'trainer_id' => $trainer['id'],
                'start_date' => ymd($start),
                'end_date' => ymd($end),
                'seat_limit' => mt_rand(25, 40),
                'status' => batchScheduleStatus(ymd($start), ymd($end)),
                'mode' => strtolower($mode),
                'org_id' => $ORG,
                'created_at' => ts($start->modify('-20 days')->setTime(11, 0)),
            ]);
            $batches[] = ['id' => $bid, 'course' => $ci, 'start' => $start, 'end' => $end, 'trainer' => $trainer['id'],
                'status' => batchScheduleStatus(ymd($start), ymd($end)), 'seats' => 0, 'mode' => $mode];
            $bi++;
        }
    }
    // Weekly timetables for ongoing and upcoming batches; a trainer never gets the same slot twice.
    if (seedHasTable($db, 'timetables') && seedHasTable($db, 'timetable_sessions')) {
        $monday = $TODAY->modify('monday this week');
        foreach ($batches as $b) {
            if ($b['status'] === 'completed') {
                continue;
            }
            $slotIdx = null;
            for ($s = 0; $s < count($slotTimes); $s++) {
                if (empty($trainerSlots[$b['trainer']][$s])) {
                    $slotIdx = $s;
                    break;
                }
            }
            if ($slotIdx === null) {
                continue; // trainer fully booked — no clash
            }
            $trainerSlots[$b['trainer']][$slotIdx] = true;
            $days = $b['mode'] === 'Offline' ? [5, 6] : [0, 2, 4]; // weekend offline, Mon/Wed/Fri online
            $weekStart = $b['start'] > $monday ? $b['start']->modify('monday this week') : $monday;
            foreach ([0, 7] as $wk) {
                $ws = $weekStart->modify("+{$wk} days");
                $ttId = uuid();
                seedInsert($db, 'timetables', [
                    'id' => $ttId, 'org_id' => $ORG, 'title' => $courses[$b['course']]['name'] . ' — weekly timetable',
                    'period_type' => 'week', 'period_start' => ymd($ws), 'period_end' => ymd($ws->modify('+6 days')),
                    'batch_id' => $b['id'], 'course_id' => $courses[$b['course']]['id'], 'created_by' => $b['trainer'],
                ]);
                foreach ($days as $sortIdx => $dOff) {
                    $date = $ws->modify("+{$dOff} days");
                    if ($date < $b['start'] || $date > $b['end']) {
                        continue;
                    }
                    seedInsert($db, 'timetable_sessions', [
                        'id' => uuid(), 'timetable_id' => $ttId, 'session_date' => ymd($date),
                        'course_id' => $courses[$b['course']]['id'], 'course_name' => $courses[$b['course']]['name'],
                        'start_time' => $slotTimes[$slotIdx][0], 'end_time' => $slotTimes[$slotIdx][1], 'sort_order' => $sortIdx,
                    ]);
                }
            }
        }
    } else {
        echo "  skip: timetables tables not found\n";
    }

    // ═══ 5. Lead forms (before leads, which point at them) ══════════════
    seedStep("5. Lead forms (before leads, which point at them)");
    $formPlan = [
        ['Free Demo Registration', 'Book a free live demo class with our trainers.'],
        ['Workshop Signup', 'Register for the weekend hands-on workshop.'],
        ['Internship Application', 'Apply for a 3-month project internship.'],
        ['Brochure Download', 'Get the full course brochure and fee details.'],
        ['Seminar – CBIT College', 'Career guidance seminar registration at CBIT, Hyderabad.'],
        ['Contact Us', 'Questions about courses, fees or placements.'],
    ];
    $forms = [];
    $slugChk = $db->prepare('SELECT COUNT(*) FROM lead_forms WHERE slug = ? AND org_id = ?');
    foreach ($formPlan as $i => [$fname, $fdesc]) {
        $slug = trim(strtolower(preg_replace('/[^a-z0-9]+/i', '-', $fname) ?? ''), '-');
        $slugChk->execute([$slug, $ORG]);
        if ((int) $slugChk->fetchColumn() > 0) {
            $slug .= '-demo';
        }
        $fields = [
            ['id' => 'f1', 'key' => 'name', 'label' => 'Full Name', 'type' => 'text', 'required' => true],
            ['id' => 'f2', 'key' => 'phone', 'label' => 'Mobile Number', 'type' => 'phone', 'required' => true],
            ['id' => 'f3', 'key' => 'email', 'label' => 'Email', 'type' => 'email', 'required' => true],
            ['id' => 'f4', 'key' => 'college', 'label' => 'College', 'type' => 'text', 'required' => false],
            ['id' => 'f5', 'key' => 'year_of_study', 'label' => 'Year of Study', 'type' => 'select', 'required' => false, 'options' => $YEARS],
            ['id' => 'f6', 'key' => 'course_interest', 'label' => 'Course you are interested in', 'type' => 'select', 'required' => false,
                'options' => array_map(static fn($c) => $c['name'], $courses)],
        ];
        $fid = uuid();
        seedInsert($db, 'lead_forms', [
            'id' => $fid, 'name' => $fname, 'slug' => $slug, 'description' => $fdesc,
            'fields_json' => json_encode($fields), 'is_active' => 1,
            'created_by' => $ADMIN_ID ?? $marketing[0]['id'], 'org_id' => $ORG,
            'created_at' => ts(daysAgo(170 - $i * 20)),
        ]);
        $forms[] = ['id' => $fid, 'slug' => $slug, 'name' => $fname];
        if (seedHasTable($db, 'lead_form_assignments')) {
            foreach ([$reps[$i % count($reps)], $reps[($i + 3) % count($reps)]] as $m) {
                seedInsert($db, 'lead_form_assignments', [
                    'id' => uuid(), 'form_id' => $fid, 'member_id' => $m['id'],
                    'assigned_by' => $ADMIN_ID ?? $managers[0]['id'], 'org_id' => $ORG,
                ]);
            }
        }
    }

    // ═══ 4. Leads (exactly 2,000) ═══════════════════════════════════════
    seedStep("4. Leads (exactly 2,000)");
    $TOTAL = 2000;
    $sourceMix = ['google_ads' => 18, 'instagram' => 16, 'facebook' => 10, 'website' => 12, 'youtube' => 6, 'whatsapp' => 8,
        'referral' => 8, 'normal_form' => 6, 'google_forms' => 6, 'walkin' => 4, 'college_seminar' => 4, 'other' => 2];
    $sources = [];
    foreach ($sourceMix as $s => $pct) {
        for ($k = 0; $k < (int) round($TOTAL * $pct / 100); $k++) {
            $sources[] = $s;
        }
    }
    while (count($sources) < $TOTAL) {
        $sources[] = 'other';
    }
    $sources = array_slice($sources, 0, $TOTAL);
    shuffle($sources);

    $pipeline = ['contacted' => 160, 'not_answered' => 120, 'messaged' => 80, 'qualified' => 90, 'interested' => 110,
        'demo_scheduled' => 70, 'demo_attended' => 70];
    $statusCounts = array_merge(['new' => 600], $pipeline, ['registered' => 160, 'enrolled' => 240, 'lost' => 300]);
    // Creation dates: last 180 days, weighted toward recent weeks; newest first.
    $dates = [];
    for ($k = 0; $k < $TOTAL; $k++) {
        $dates[] = daysAgo(pow(r01(), 1.7) * 180);
    }
    usort($dates, static fn($a, $b) => $b <=> $a);
    // "New" leads mostly come from the newest 900; students from older ones.
    $statuses = array_fill(0, $TOTAL, null);
    $newPool = range(0, 899);
    shuffle($newPool);
    foreach (array_slice($newPool, 0, 600) as $ix) {
        $statuses[$ix] = 'new';
    }
    $rest = [];
    foreach ($statusCounts as $s => $cnt) {
        if ($s !== 'new') {
            $rest = array_merge($rest, array_fill(0, $cnt, $s));
        }
    }
    shuffle($rest);
    // Students need a few days of history: put them on leads at least 5 days old where possible.
    $olderIdx = [];
    $freeIdx = [];
    for ($k = 0; $k < $TOTAL; $k++) {
        if ($statuses[$k] === null) {
            $freeIdx[] = $k;
            if ($dates[$k] < $TODAY->modify('-5 days')) {
                $olderIdx[] = $k;
            }
        }
    }
    $studentStatuses = array_values(array_filter($rest, static fn($s) => $s === 'registered' || $s === 'enrolled'));
    $otherStatuses = array_values(array_filter($rest, static fn($s) => $s !== 'registered' && $s !== 'enrolled'));
    shuffle($olderIdx);
    $taken = [];
    foreach ($studentStatuses as $j => $s) {
        $ix = $olderIdx[$j] ?? null;
        if ($ix === null) {
            break;
        }
        $statuses[$ix] = $s;
        $taken[$ix] = true;
    }
    $oi = 0;
    foreach ($freeIdx as $ix) {
        if (!isset($taken[$ix])) {
            $statuses[$ix] = $otherStatuses[$oi++] ?? 'contacted';
        }
    }

    $owners = [$reps[0], $reps[1], $managers[0], $managers[1]];
    $ownerWeights = [38, 34, 16, 12];
    $leadIns = [];
    $leads = [];
    $notesByStatus = [
        'new' => ['Enquired through ad, wants fee details.', 'Asked for weekend batch timings.', 'Interested, call after 6 pm.', ''],
        'contacted' => ['Spoke briefly, sharing brochure on WhatsApp.', 'Parent will decide; follow up next week.', 'Asked about placement support.'],
        'not_answered' => ['Called twice, no answer.', 'Phone switched off, try tomorrow.', 'Ringing, not picked up.'],
        'messaged' => ['Sent course details on WhatsApp.', 'Shared syllabus PDF and fee structure.'],
        'qualified' => ['Final-year student, budget fits, wants placement track.', 'Working professional, looking to switch to IT.'],
        'interested' => ['Very interested in weekend batch; comparing with one other institute.', 'Wants EMI option; sent details.'],
        'demo_scheduled' => ['Demo booked for Saturday 11 am.', 'Joining the online demo on Thursday evening.'],
        'demo_attended' => ['Attended demo, liked the trainer. Discussing fee with parents.', 'Attended demo, asked for discount.'],
        'registered' => ['Paid registration fee, will pick a batch next month.', 'Registered; waiting for semester exams to finish.'],
        'enrolled' => ['Enrolled and attending classes.', 'Enrolled with installment plan.'],
        'lost' => ['Joined another institute.', 'Budget issue, not interested now.', 'Wrong number / not interested.', 'Going for higher studies.'],
    ];
    for ($k = 0; $k < $TOTAL; $k++) {
        [$f, $l] = personName();
        $status = $statuses[$k];
        $source = $sources[$k];
        $created = $dates[$k];
        $unassigned = ($status === 'new' || $status === 'lost') && r01() < 0.22; // ≈10% of all leads
        $assignee = $unassigned ? null : $owners[pickW($ownerWeights)]['id'];
        $courseIx = pickW($COURSE_W);
        $tags = null;
        if ($source === 'normal_form') {
            // Stored exactly like a real submission (public-lead.php): source form_<slug> + form tags,
            // so Form Management counts them and Form Leads shows one card per form.
            $form = $forms[$k % count($forms)];
            $tags = json_encode(['form_slug' => $form['slug'], 'form_id' => $form['id']]);
            $source = 'form_' . $form['slug'];
        }
        $nextFollow = null;
        if (isset($pipeline[$status]) || $status === 'new') {
            if (r01() < 0.6) {
                $nextFollow = ts($TODAY->modify('+' . mt_rand(-3, 10) . ' days')->setTime(mt_rand(10, 18), 0));
            }
        }
        $lead = [
            'id' => uuid(),
            'name' => $f . ' ' . $l,
            'email' => newEmail($f, $l),
            'phone' => newPhone(),
            'college' => pick($COLLEGES),
            'year_of_study' => pickW($YEAR_W),
            'course_interest' => $courses[$courseIx]['name'],
            'referred_by' => $source === 'referral' ? $reps[mt_rand(0, count($reps) - 1)]['ref'] : null,
            'source' => $source,
            'status' => $status,
            'score' => mt_rand(10, 95),
            'assigned_to' => $assignee,
            'notes' => pick($notesByStatus[$status]) . (r01() < 0.3 ? ' City: ' . pick($CITIES) . '.' : ''),
            'tags' => $tags,
            'next_follow_up' => $nextFollow,
            'org_id' => $ORG,
            'created_by' => $assignee ?? ($ADMIN_ID ?? $managers[0]['id']),
            'created_at' => ts($created),
            'updated_at' => ts($created),
            '_course' => $courseIx,
        ];
        $leads[] = $lead;
    }
    // ~30 near-duplicates: same phone with a different spelling/email, or the same email in another case.
    $dupDone = [];
    for ($d = 0, $guard = 0; $d < 30 && $guard < 5000; $guard++) {
        $a = mt_rand(0, $TOTAL - 1);
        $b = mt_rand(0, $TOTAL - 1);
        if ($a === $b || $leads[$b]['status'] !== 'new' || isset($dupDone[$a]) || isset($dupDone[$b])) {
            continue;
        }
        $dupDone[$a] = $dupDone[$b] = true;
        $d++;
        if ($d % 2 === 0) {
            $leads[$b]['phone'] = $leads[$a]['phone'];
            $leads[$b]['name'] = explode(' ', $leads[$a]['name'])[0] . ' ' . substr(explode(' ', $leads[$a]['name'])[1] ?? 'K', 0, 1);
        } else {
            $leads[$b]['email'] = strtoupper(substr($leads[$a]['email'], 0, 1)) . substr($leads[$a]['email'], 1);
            $leads[$b]['name'] = $leads[$a]['name'];
        }
        $leads[$b]['notes'] = 'Possible duplicate of an earlier enquiry.';
    }
    foreach ($leads as $ix => $lead) {
        $row = $lead;
        unset($row['_course']);
        seedInsert($db, 'leads', $row);
    }

    // Follow-up history + status-change logs for 60% of leads (all non-"new" first).
    seedStep("Lead history and follow-ups");
    $nonNew = [];
    foreach ($leads as $ix => $lead) {
        if ($lead['status'] !== 'new') {
            $nonNew[] = $ix;
        }
    }
    shuffle($nonNew);
    $withHistory = array_slice($nonNew, 0, (int) round($TOTAL * 0.6));
    $historySet = array_fill_keys($withHistory, true);
    $paths = [
        'contacted' => ['contacted'],
        'not_answered' => ['not_answered'],
        'messaged' => ['contacted', 'messaged'],
        'qualified' => ['contacted', 'qualified'],
        'interested' => ['contacted', 'interested'],
        'demo_scheduled' => ['contacted', 'interested', 'demo_scheduled'],
        'demo_attended' => ['contacted', 'interested', 'demo_scheduled', 'demo_attended'],
        'registered' => ['contacted', 'interested', 'registered'],
        'enrolled' => ['contacted', 'interested', 'demo_attended', 'enrolled'],
        'lost' => ['contacted', 'lost'],
    ];
    $followUps = [
        'Called and explained the course curriculum.', 'Shared fee structure and EMI options on WhatsApp.',
        'Discussed batch timings; prefers evening slot.', 'Parent call done, positive response.',
        'Sent demo class link.', 'Asked to call back after exams.', 'Explained placement assistance process.',
    ];
    $hasActivities = seedHasTable($db, 'activities');
    $hasAudit = seedHasTable($db, 'audit_log');
    $lastStatusAt = [];
    foreach ($leads as $ix => $lead) {
        $status = $lead['status'];
        $actor = $lead['assigned_to'] ?? $managers[0]['id'];
        $created = new DateTimeImmutable($lead['created_at']);
        $steps = isset($historySet[$ix]) ? ($paths[$status] ?? []) : [];
        // Everyone not "new" still needs to have reached their status at some point.
        $span = max(1, min(40, (int) (($NOW->getTimestamp() - $created->getTimestamp()) / 86400)));
        $prev = 'new';
        $t = $created;
        foreach ($steps as $sIdx => $next) {
            $t = between($t->modify('+2 hours'), $created->modify('+' . (int) ceil($span * ($sIdx + 1) / count($steps)) . ' days'));
            if ($t > $NOW) {
                $t = $NOW->modify('-' . mt_rand(5, 300) . ' minutes');
            }
            $desc = 'Status: ' . $prev . ' → ' . $next;
            $actorName = $repById[$actor]['name'] ?? 'Team member';
            if ($hasActivities) {
                seedInsert($db, 'activities', [
                    'id' => uuid(), 'type' => 'status_change', 'subject' => $desc, 'description' => $desc,
                    'lead_id' => $lead['id'], 'user_id' => $actor, 'occurred_at' => ts($t), 'org_id' => $ORG, 'created_at' => ts($t),
                ]);
            }
            seedInsert($db, 'lead_activities', [
                'id' => uuid(), 'lead_id' => $lead['id'], 'user_id' => $actor, 'type' => 'status_change',
                'description' => $desc, 'org_id' => $ORG, 'created_at' => ts($t),
            ]);
            if ($hasAudit) {
                seedInsert($db, 'audit_log', [
                    'id' => uuid(), 'org_id' => $ORG, 'user_id' => $actor, 'user_name' => $actorName,
                    'action' => 'status_updated', 'entity_type' => 'lead', 'entity_id' => $lead['id'],
                    'details' => $desc, 'created_at' => ts($t),
                ]);
            }
            if (r01() < 0.7) {
                $fu = $t->modify('+' . mt_rand(5, 90) . ' minutes');
                if ($fu < $NOW) {
                    seedInsert($db, 'lead_activities', [
                        'id' => uuid(), 'lead_id' => $lead['id'], 'user_id' => $actor, 'type' => pick(['call', 'note', 'whatsapp']),
                        'description' => pick($followUps), 'completed_at' => ts($fu), 'org_id' => $ORG, 'created_at' => ts($fu),
                    ]);
                }
            }
            $prev = $next;
        }
        $lastStatusAt[$ix] = $steps ? $t : between($created, min($NOW, $created->modify('+' . $span . ' days')));
        if ($steps) {
            $db->prepare('UPDATE leads SET updated_at = ? WHERE id = ?')->execute([ts($t), $lead['id']]);
        }
    }

    // ═══ HR leads (≈150, HR portal) ═════════════════════════════════════
    seedStep("HR leads (≈150, HR portal)");
    if (seedHasTable($db, 'hr_leads')) {
        $hrStatus = ['new' => 40, 'contacted' => 35, 'interested' => 30, 'not_interested' => 15, 'converted' => 20, 'lost' => 10];
        $hrSources = ['naukri', 'linkedin', 'referral', 'walkin', 'form_internship-application', 'indeed'];
        $roles = ['Sales Executive', 'Academic Counsellor', 'Trainer – Full Stack', 'Trainer – Data Science', 'Digital Marketing Intern', 'HR Intern'];
        $hrCount = 0;
        foreach ($hrStatus as $s => $cnt) {
            for ($k = 0; $k < $cnt; $k++) {
                [$f, $l] = personName();
                $c = daysAgo(pow(r01(), 1.5) * 150);
                seedInsert($db, 'hr_leads', [
                    'hr_id' => $hrs[$hrCount % 2]['id'],
                    'assigned_by' => $ADMIN_ID ?? $managers[0]['id'],
                    'full_name' => $f . ' ' . $l,
                    'phone' => newPhone(),
                    'email' => newEmail($f, $l),
                    'source' => pick($hrSources),
                    'status' => $s,
                    'priority' => pick(['low', 'medium', 'medium', 'high']),
                    'notes' => 'Applied for ' . pick($roles) . '. ' . pick(['Fresher.', '1 year experience.', '2+ years experience.', 'Notice period 30 days.']),
                    'follow_up_date' => in_array($s, ['new', 'contacted', 'interested'], true) ? ymd($TODAY->modify('+' . mt_rand(-2, 12) . ' days')) : null,
                    'is_assigned' => 1,
                    'org_id' => $ORG,
                    'created_at' => ts($c),
                    'updated_at' => ts($c),
                ]);
                $hrCount++;
            }
        }
    } else {
        echo "  skip: hr_leads table not found\n";
    }

    // ═══ 6. Students (registered + enrolled leads) ══════════════════════
    seedStep("6. Students (registered + enrolled leads)");
    $batchesByCourse = [];
    foreach ($batches as $bix => $b) {
        $batchesByCourse[$b['course']][] = $bix;
    }
    $students = [];
    foreach ($leads as $ix => $lead) {
        if ($lead['status'] !== 'registered' && $lead['status'] !== 'enrolled') {
            continue;
        }
        $when = $lastStatusAt[$ix];
        $courseIx = $lead['_course'];
        $courseId = null;
        $batchId = null;
        $mentor = null;
        $stStatus = 'active';
        if ($lead['status'] === 'enrolled') {
            $courseId = $courses[$courseIx]['id'];
            $choice = null;
            foreach ($batchesByCourse[$courseIx] as $bix) {
                $b = $batches[$bix];
                if ($b['seats'] < 36 && $b['start'] >= $when->modify('-21 days')->setTime(0, 0)) {
                    $choice = $bix;
                    break;
                }
            }
            if ($choice === null) {
                $list = $batchesByCourse[$courseIx];
                $choice = $list[count($list) - 1];
            }
            $batches[$choice]['seats']++;
            $batchId = $batches[$choice]['id'];
            $mentor = $batches[$choice]['trainer'];
            if ($batches[$choice]['status'] === 'completed') {
                $stStatus = 'completed';
            }
        }
        $sid = uuid();
        seedInsert($db, 'students', [
            'id' => $sid, 'name' => $lead['name'], 'email' => $lead['email'], 'phone' => $lead['phone'],
            'college' => $lead['college'], 'year_of_study' => $lead['year_of_study'],
            'course_id' => $courseId, 'batch_id' => $batchId, 'lead_id' => $lead['id'], 'mentor_id' => $mentor,
            'enrolled_by' => $lead['assigned_to'], 'status' => $stStatus, 'enrollment_date' => ymd($when),
            'org_id' => $ORG, 'created_at' => ts($when), 'updated_at' => ts($when),
        ]);
        $students[] = ['id' => $sid, 'lead' => $ix, 'enrolled' => $lead['status'] === 'enrolled', 'batch' => $batchId, 'when' => $when];
    }

    // ═══ 7. Payments: candidates, manual payments, payment links ════════
    seedStep("7. Payments: candidates, manual payments, payment links");
    $methods = ['UPI', 'UPI', 'Bank Transfer', 'Cash', 'Card', 'UPI'];
    $hasCand = seedHasTable($db, 'payment_candidates');
    $hasManual = seedHasTable($db, 'manual_payments');
    $hasLinks = seedHasTable($db, 'payment_links');
    $hasLinkPay = seedHasTable($db, 'payment_candidate_link_payments');
    $pendingManual = 0;
    $rejectedManual = 0;
    $linkSeq = 0;
    $makeLink = function (array $lead, ?string $candId, int $rupees, string $status, DateTimeImmutable $at, string $desc) use ($db, $ORG, $repById, $reps, $hasLinks, $hasLinkPay, &$linkSeq): void {
        if (!$hasLinks) {
            return;
        }
        $linkSeq++;
        $owner = $lead['assigned_to'] ?? $reps[0]['id'];
        $plink = 'plink_DEMO' . strtoupper(substr(bin2hex(random_bytes(8)), 0, 12));
        $paidPaise = $status === 'paid' ? $rupees * 100 : ($status === 'partially_paid' ? (int) round($rupees * 40) : 0);
        seedInsert($db, 'payment_links', [
            'org_id' => $ORG,
            'razorpay_payment_link_id' => $plink,
            'salesperson_id' => $owner,
            'salesperson_referral_code' => $repById[$owner]['ref'] ?? '',
            'customer_name' => $lead['name'],
            'customer_email' => $lead['email'],
            'customer_phone' => $lead['phone'],
            'amount' => $rupees * 100,
            'currency' => 'INR',
            'description' => $desc,
            'reference_id' => 'DEMO-' . str_pad((string) $linkSeq, 5, '0', STR_PAD_LEFT),
            'payment_type' => $status === 'partially_paid' ? 'partial' : 'full',
            'accept_partial' => $status === 'partially_paid' ? 1 : 0,
            'status' => $status,
            'amount_paid' => $paidPaise,
            'razorpay_short_url' => '',
            'notify_email' => 0,
            'notify_sms' => 0,
            'expire_by' => ts($at->modify('+7 days')),
            'reminder_enable' => 0,
            'notes' => json_encode(['seed' => SEED_BATCH, 'lead_id' => $lead['id']]),
            'enrollment_applied_at' => $paidPaise > 0 ? ts($at) : null,
            'reconcile_needed' => 0,
            'candidate_id' => $candId,
            'created_at' => ts($at),
            'updated_at' => ts($at),
        ]);
        if ($paidPaise > 0 && $candId !== null && $hasLinkPay) {
            seedInsert($db, 'payment_candidate_link_payments', [
                'id' => uuid(), 'candidate_id' => $candId, 'razorpay_payment_link_id' => $plink,
                'razorpay_payment_id' => 'pay_DEMO' . strtoupper(substr(bin2hex(random_bytes(8)), 0, 12)),
                'amount_paise' => $paidPaise, 'paid_at' => ts($at->modify('+' . mt_rand(10, 600) . ' minutes')),
                'created_at' => ts($at),
            ]);
        }
    };
    foreach ($students as $s) {
        $lead = $leads[$s['lead']];
        $course = $courses[$lead['_course']];
        $owner = $lead['assigned_to'] ?? $reps[0]['id'];
        $pitch = $course['price'] - (mt_rand(0, 3) * 2500);
        $candId = null;
        if ($hasCand) {
            $candId = uuid();
            seedInsert($db, 'payment_candidates', [
                'id' => $candId, 'org_id' => $ORG, 'owner_user_id' => $owner, 'customer_name' => $lead['name'],
                'customer_email' => $lead['email'], 'customer_phone' => $lead['phone'],
                'phone_norm' => substr(preg_replace('/\D+/', '', $lead['phone']) ?? '', -10),
                'email_norm' => strtolower($lead['email']), 'pitch_price' => $pitch, 'lead_id' => $lead['id'],
                'created_at' => ts($s['when']), 'updated_at' => ts($s['when']),
            ]);
        }
        // Registration fee first (everyone), then course installments for enrolled students.
        $installments = [2000];
        if ($s['enrolled']) {
            $remaining = $pitch - 2000;
            $plan = pickW(['full' => 45, 'two' => 30, 'partial' => 25]);
            if ($plan === 'full') {
                $installments[] = $remaining;
            } elseif ($plan === 'two') {
                $installments[] = (int) round($remaining / 2);
                $installments[] = $remaining - (int) round($remaining / 2);
            } else {
                $installments[] = (int) round($remaining * 0.4);
            }
        }
        $at = $s['when'];
        foreach ($installments as $n => $amt) {
            $at = $n === 0 ? $at : min($NOW->modify('-1 hour'), $at->modify('+' . mt_rand(7, 30) . ' days'));
            $viaLink = r01() < 0.45;
            if ($viaLink && $hasLinks) {
                $makeLink($lead, $candId, (int) $amt, 'paid', $at, $n === 0 ? 'Registration fee — ' . $course['name'] : 'Course fee installment ' . $n . ' — ' . $course['name']);
            } elseif ($hasManual) {
                $mStatus = 'approved';
                if ($n > 0 && $pendingManual < 14 && $at > $NOW->modify('-10 days')) {
                    $mStatus = 'pending';
                    $pendingManual++;
                } elseif ($n > 0 && $rejectedManual < 5 && r01() < 0.04) {
                    $mStatus = 'rejected';
                    $rejectedManual++;
                }
                seedInsert($db, 'manual_payments', [
                    'id' => uuid(), 'org_id' => $ORG, 'submitted_by' => $owner, 'amount' => $amt, 'currency' => 'INR',
                    'payment_method' => pick($methods), 'customer_name' => $lead['name'], 'customer_email' => $lead['email'],
                    'customer_phone' => $lead['phone'], 'paid_at' => ymd($at),
                    'notes' => $n === 0 ? 'Registration fee' : 'Installment ' . $n . ' — ' . $course['name'],
                    'status' => $mStatus,
                    'reviewed_by' => $mStatus === 'pending' ? null : $APPROVER,
                    'reviewed_at' => $mStatus === 'pending' ? null : ts($at->modify('+1 day')),
                    'review_notes' => $mStatus === 'rejected' ? 'Transaction reference not found in bank statement.' : null,
                    'candidate_id' => $candId, 'installment_number' => $n + 1,
                    'created_at' => ts($at), 'updated_at' => ts($at),
                ]);
            }
        }
    }
    // Links for people still deciding: open, expired and part-paid.
    $deciding = array_values(array_filter(array_keys($leads), static fn($ix) => in_array($leads[$ix]['status'], ['interested', 'demo_scheduled', 'demo_attended'], true)));
    shuffle($deciding);
    foreach (array_slice($deciding, 0, 30) as $j => $ix) {
        $lead = $leads[$ix];
        $course = $courses[$lead['_course']];
        $status = $j < 16 ? 'created' : ($j < 24 ? 'expired' : ($j < 27 ? 'cancelled' : 'partially_paid'));
        $at = min($NOW->modify('-2 hours'), $lastStatusAt[$ix]);
        if ($status === 'created') {
            $at = $NOW->modify('-' . mt_rand(1, 5) . ' days');
        }
        $candId = null;
        if ($status === 'partially_paid' && $hasCand) {
            $candId = uuid();
            seedInsert($db, 'payment_candidates', [
                'id' => $candId, 'org_id' => $ORG, 'owner_user_id' => $lead['assigned_to'] ?? $reps[0]['id'],
                'customer_name' => $lead['name'], 'customer_email' => $lead['email'], 'customer_phone' => $lead['phone'],
                'phone_norm' => substr(preg_replace('/\D+/', '', $lead['phone']) ?? '', -10),
                'email_norm' => strtolower($lead['email']), 'pitch_price' => $course['price'], 'lead_id' => $lead['id'],
                'created_at' => ts($at), 'updated_at' => ts($at),
            ]);
        }
        $makeLink($lead, $candId, $status === 'partially_paid' ? $course['price'] : 2000, $status, $at,
            ($status === 'partially_paid' ? 'Course fee — ' : 'Registration fee — ') . $course['name']);
    }

    // ═══ Coupons ════════════════════════════════════════════════════════
    seedStep("Coupons");
    if (seedHasTable($db, 'coupons')) {
        $codeChk = $db->prepare('SELECT COUNT(*) FROM coupons WHERE org_id = ? AND code = ?');
        foreach (array_slice($deciding, 30, 10) as $j => $ix) {
            $lead = $leads[$ix];
            do {
                $code = 'GROOT' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 5));
                $codeChk->execute([$ORG, $code]);
            } while ((int) $codeChk->fetchColumn() > 0);
            seedInsert($db, 'coupons', [
                'id' => uuid(), 'org_id' => $ORG, 'lead_id' => $lead['id'], 'name' => $lead['name'], 'email' => $lead['email'],
                'discount' => pick([1000, 2000, 2500, 3000, 5000]), 'min_amount' => 15000, 'code' => $code,
                'created_by' => $lead['assigned_to'] ?? $managers[0]['id'], 'created_at' => ts($NOW->modify('-' . mt_rand(1, 20) . ' days')),
            ]);
        }
    }

    // ═══ Call log + daily reports (last 30 days) ════════════════════════
    seedStep("Call log + daily reports (last 30 days)");
    if (seedHasTable($db, 'call_logs')) {
        $leadsByRep = [];
        foreach ($leads as $ix => $lead) {
            if ($lead['assigned_to'] !== null) {
                $leadsByRep[$lead['assigned_to']][] = $ix;
            }
        }
        $repDays = [];
        $callNotes = ['Discussed fee and EMI options.', 'Explained course syllabus.', 'Asked to call back in the evening.',
            'Confirmed demo slot.', 'Parent wants to visit the centre.', 'Shared batch timings.', null, null];
        $seq = 0;
        foreach ($reps as $rIdx => $rep) {
            $pool = $leadsByRep[$rep['id']] ?? [];
            if ($pool === []) {
                continue;
            }
            for ($d = 29; $d >= 0; $d--) {
                $day = $TODAY->modify("-{$d} days");
                if ((int) $day->format('w') === 0) {
                    continue; // Sundays off
                }
                $n = mt_rand(25, 45) - $rIdx * 4;
                for ($c = 0; $c < max(3, $n); $c++) {
                    $lead = $leads[pick($pool)];
                    $kind = pickW(['out_conn' => 50, 'out_np' => 22, 'missed' => 12, 'in_conn' => 13, 'rejected' => 3]);
                    [$type, $cstatus, $dur] = match ($kind) {
                        'out_conn' => ['outgoing', 'connected', mt_rand(25, 780)],
                        'out_np' => ['outgoing', 'not_pickup_by_client', 0],
                        'missed' => ['missed', 'never_attended', 0],
                        'in_conn' => ['incoming', 'connected', mt_rand(20, 540)],
                        default => ['rejected', 'never_attended', 0],
                    };
                    $time = $day->setTime(mt_rand(9, 19), mt_rand(0, 59), mt_rand(0, 59));
                    if ($time > $NOW) {
                        continue;
                    }
                    $seq++;
                    seedInsert($db, 'call_logs', [
                        'sales_rep_id' => $rep['id'], 'org_id' => $ORG, 'lead_id' => $lead['id'],
                        'call_type' => $type, 'call_status' => $cstatus, 'duration_seconds' => $dur,
                        'client_phone' => $lead['phone'], 'client_name' => $lead['name'],
                        'notes' => $cstatus === 'connected' ? pick($callNotes) : null,
                        'call_date' => ymd($day), 'call_time' => $time->format('H:i:s'),
                        'device_call_id' => 'demo-' . SEED_BATCH . '-' . $seq,
                        'synced_at' => ts($time->modify('+3 minutes')), 'created_at' => ts($time->modify('+3 minutes')),
                    ]);
                    $repDays[$rep['id']][ymd($day)] = true;
                }
            }
        }
        // Daily reports are built from the call log by the app's own sync.
        $summaries = ['Good day, two demos booked.', 'Followed up on pending fee payments.', 'Many unanswered calls; will retry tomorrow.',
            'Converted one lead to registration.', 'Focused on new Instagram leads.', 'Parents meeting at the centre went well.'];
        $drSel = $db->prepare('SELECT id FROM daily_reports WHERE user_id = ? AND report_date = ? LIMIT 1');
        foreach ($repDays as $repId => $days) {
            foreach (array_keys($days) as $day) {
                $drSel->execute([$repId, $day]);
                $existed = $drSel->fetchColumn();
                syncpediaSyncDailyReportFromCallLogs($db, $repId, $day, $ORG);
                $drSel->execute([$repId, $day]);
                $drId = $drSel->fetchColumn();
                if ($drId && !$existed) {
                    seedRegister($db, 'daily_reports', (string) $drId);
                    $db->prepare('UPDATE daily_reports SET summary = COALESCE(NULLIF(summary, \'\'), ?), total_demos = ?, total_conversions = ? WHERE id = ?')
                        ->execute([pick($summaries), mt_rand(0, 3), mt_rand(0, 1), $drId]);
                }
            }
        }
    } else {
        echo "  skip: call_logs table not found\n";
    }

    // ═══ Tasks ══════════════════════════════════════════════════════════
    seedStep("Tasks");
    // Tasks that fit each role, so the Tasks page reads like a real team's to-do list.
    $taskPlan = [
        'sales_representative' => [
            ['Call back after demo — {lead}', 'Attended Saturday demo; wants to discuss EMI with parents before deciding.', true],
            ['Collect second installment — {lead}', 'Second installment due this week. Share the payment link on WhatsApp.', true],
            ['Send brochure and fee structure — {lead}', 'Asked for the syllabus PDF and weekend batch timings.', true],
            ['Confirm batch joining date — {lead}', 'Registered last week; confirm which batch they will join.', true],
            ['Follow up on payment proof — {lead}', 'Paid by UPI; upload the screenshot to Payment Records for approval.', true],
        ],
        'manager' => [
            ['Review this week\'s pipeline with the team', 'Go through demo-attended leads that have not enrolled yet.', false],
            ['Approve pending manual payments', 'Check proofs in Payment Records → Approvals.', false],
            ['Reassign unassigned Instagram leads', 'Spread the new Instagram leads between Karthik and Priya.', false],
            ['Plan the CBIT college seminar', 'Confirm the date with the placement officer and share the form link.', false],
        ],
        'operational_manager' => [
            ['Publish next week\'s class timetables', 'Send the timetable emails for all ongoing batches.', false],
            ['Arrange trainer for the December Data Science batch', 'Batch starts on the 19th; confirm trainer and lab access.', false],
            ['Check batch seat availability', 'Two upcoming batches are close to full; open a waitlist.', false],
        ],
        'hr' => [
            ['Shortlist Full Stack trainer applicants', 'Review the HR leads from Naukri and LinkedIn and book interviews.', false],
            ['Schedule interviews for counsellor roles', 'Three candidates interested; set up calls this week.', false],
            ['Send offer letter to selected candidate', 'Candidate accepted the verbal offer; send the letter.', false],
        ],
        'marketing' => [
            ['Refresh Instagram ad creatives', 'Cost per lead went up this week; test two new creatives.', false],
            ['Launch Brochure Download campaign', 'Share the form link in the Google Ads landing page.', false],
            ['Weekly lead source report', 'Compare Google Ads, Instagram and Website lead quality.', false],
        ],
    ];
    $staff = array_merge($reps, $managers, $oms, $hrs, $marketing);
    $taskN = 0;
    foreach ($staff as $who) {
        $list = $taskPlan[$who['role']] ?? [];
        $repeat = $who['role'] === 'sales_representative' ? 3 : 1;
        $ownLeads = array_values(array_filter(array_keys($leads), static fn($ix) => $leads[$ix]['assigned_to'] === $who['id']));
        for ($r = 0; $r < $repeat; $r++) {
            foreach ($list as [$title, $desc, $withLead]) {
                $leadIx = $withLead && $ownLeads ? pick($ownLeads) : null;
                $dueOff = mt_rand(-8, 12);
                $status = $dueOff < -3 ? pick(['completed', 'completed', 'pending']) : ($dueOff < 0 ? pick(['pending', 'in_progress']) : pick(['pending', 'pending', 'in_progress']));
                seedInsert($db, 'tasks', [
                    'id' => uuid(),
                    'title' => str_replace('{lead}', $leadIx !== null ? $leads[$leadIx]['name'] : 'lead', $title),
                    'description' => $desc,
                    'due_date' => ts($TODAY->modify(($dueOff >= 0 ? '+' : '') . $dueOff . ' days')->setTime(mt_rand(10, 18), 0)),
                    'priority' => pick(['low', 'medium', 'medium', 'high', 'urgent']), 'status' => $status,
                    'assigned_to' => $who['id'], 'lead_id' => $leadIx !== null ? $leads[$leadIx]['id'] : null,
                    'created_by' => in_array($who['role'], ['manager', 'operational_manager'], true) ? ($ADMIN_ID ?? $who['id']) : $managers[$taskN % 2]['id'],
                    'org_id' => $ORG,
                    'created_at' => ts($TODAY->modify('-' . mt_rand(1, 20) . ' days')->setTime(10, 0)),
                ]);
                $taskN++;
            }
        }
    }

    // ═══ Notifications ══════════════════════════════════════════════════
    seedStep("Notifications");
    $notifTemplates = [
        ['New lead assigned', 'A new Instagram lead was assigned to you.', 'lead_assigned', '/my-leads'],
        ['Payment received', 'Registration fee of ₹2,000 received via UPI.', 'payment', '/payments/records'],
        ['Task due today', 'Follow up on demo feedback is due today.', 'task', '/tasks'],
        ['Demo scheduled', 'A demo class was booked for Saturday 11 am.', 'info', '/leads'],
        ['Payment proof pending', 'A manual payment is waiting for approval.', 'payment', '/payments/records'],
        ['Holiday added', 'Christmas has been added to the holiday calendar.', 'info', '/holidays'],
    ];
    $notifUsers = $team;
    if ($ADMIN_ID) {
        $notifUsers[] = ['id' => $ADMIN_ID];
    }
    foreach ($notifUsers as $u) {
        foreach ($notifTemplates as $j => [$title, $msg, $type, $link]) {
            if (mt_rand(0, 9) < 3) {
                continue;
            }
            seedInsert($db, 'notifications', [
                'id' => uuid(), 'user_id' => $u['id'], 'title' => $title, 'message' => $msg, 'type' => $type,
                'is_read' => $j > 2 ? 1 : 0, 'link' => $link, 'org_id' => $ORG,
                'created_at' => ts($NOW->modify('-' . mt_rand(10, 60 * 24 * 6) . ' minutes')),
            ]);
        }
    }

    // ═══ Holidays ═══════════════════════════════════════════════════════
    seedStep("Holidays");
    if (seedHasTable($db, 'holidays')) {
        $y = (int) $TODAY->format('Y');
        $hol = [
            ['Christmas', "{$y}-12-25", 'public'],
            ['New Year\'s Day', ($y + 1) . '-01-01', 'public'],
            ['Makar Sankranti / Pongal', ($y + 1) . '-01-14', 'public'],
            ['Republic Day', ($y + 1) . '-01-26', 'public'],
            ['Independence Day', "{$y}-08-15", 'public'],
            ['Gandhi Jayanti', "{$y}-10-02", 'public'],
            ['Team Offsite', ymd($TODAY->modify('+24 days')), 'company'],
            ['Founders\' Day', ymd($TODAY->modify('+52 days')), 'optional'],
        ];
        $hChk = $db->prepare('SELECT COUNT(*) FROM holidays WHERE org_id = ? AND date = ?');
        foreach ($hol as [$hn, $hd, $ht]) {
            $hChk->execute([$ORG, $hd]);
            if ((int) $hChk->fetchColumn() > 0) {
                continue;
            }
            seedInsert($db, 'holidays', [
                'id' => uuid(), 'name' => $hn, 'date' => $hd, 'type' => $ht, 'notes' => 'Office closed.',
                'is_approved' => 1, 'approved_by' => $APPROVER, 'approved_at' => ts($NOW->modify('-30 days')), 'org_id' => $ORG,
            ]);
        }
    }

    seedStep($apply ? "Saving…" : "Finished building; undoing the dry run…");
    // ── Report ───────────────────────────────────────────────────────────
    echo "\nRows " . ($apply ? 'created' : 'that would be created') . ":\n";
    ksort($STATS);
    foreach ($STATS as $t => $n) {
        printf("  %-34s %6d\n", $t, $n);
    }
    $statusTally = array_count_values(array_map(static fn($l) => $l['status'], $leads));
    $sourceTally = array_count_values(array_map(static fn($l) => $l['source'], $leads));
    $unassigned = count(array_filter($leads, static fn($l) => $l['assigned_to'] === null));
    echo "\nLeads by status: " . json_encode($statusTally) . "\n";
    echo "Leads by source: " . json_encode($sourceTally) . "\n";
    echo "Unassigned leads: {$unassigned}; with history: " . count($withHistory) . "; students: " . count($students) . "\n";
    foreach ($SKIPPED_COLS as $t => $cs) {
        echo "  note: {$t} has no column(s) " . implode(', ', $cs) . " — left out\n";
    }

    if ($apply) {
        $db->commit();
        $home = getenv('HOME') ?: '/root';
        $file = rtrim($home, '/') . '/' . preg_replace('/[^a-z0-9]+/i', '-', strtolower((string) $orgRows[0]['slug'])) . '-demo-logins.txt';
        @file_put_contents($file, "Demo logins for {$orgRows[0]['name']} (password for all: {$demoPassword})\n" . implode("\n", $demoEmails) . "\n");
        @chmod($file, 0600);
        echo "\nDone. Demo team logins (one shared password) saved to {$file} (readable by root only).\n";
    } else {
        $db->rollBack();
        echo "\nDry run — nothing written. Re-run with --apply to create it.\n";
    }
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, "\nSeed failed, nothing written: " . $e->getMessage() . "\n  at " . basename($e->getFile()) . ':' . $e->getLine() . "\n");
    exit(1);
}
