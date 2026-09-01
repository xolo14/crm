<?php
/**
 * DECOY-ONLY seed → Neon PostgreSQL (not Hostinger MySQL CRM).
 *
 *   php scripts/seed-decoy.php
 *
 * Requires public/api-decoy/config.example.php (or config.php) with DECOY_DATABASE_URL or DECOY_DB_*.
 * Writes plaintext admin passwords once to decoy-credentials.txt (gitignored).
 */
declare(strict_types=1);

$root = dirname(__DIR__);
$decoyDir = $root . '/public/api-decoy';
$configPath = is_file($decoyDir . '/config.php')
    ? ($decoyDir . '/config.php')
    : ($decoyDir . '/config.example.php');
if (!is_file($configPath)) {
    fwrite(STDERR, "Missing public/api-decoy/config.example.php\n");
    exit(1);
}

require_once $configPath;
require_once $root . '/public/api-decoy/db.php';

$url = defined('DECOY_DATABASE_URL') ? trim((string) DECOY_DATABASE_URL) : '';
$host = defined('DECOY_DB_HOST') ? trim((string) DECOY_DB_HOST) : '';
$configured = ($url !== '' && stripos($url, 'ep-xxxx') === false)
    || ($host !== '' && stripos($host, 'ep-xxxx') === false && stripos($host, 'localhost') === false);
if (!$configured) {
    fwrite(STDERR, "Configure Neon DECOY_DATABASE_URL (or DECOY_DB_HOST/USER/PASS) in api-decoy/config.example.php first.\n");
    exit(1);
}

function seedUuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function seedRng(int $seed): callable
{
    $state = $seed & 0x7fffffff;
    if ($state === 0) {
        $state = 1;
    }
    return static function () use (&$state): float {
        $state ^= ($state << 13) & 0x7fffffff;
        $state ^= ($state >> 17);
        $state ^= ($state << 5) & 0x7fffffff;
        return ($state & 0x7fffffff) / 0x7fffffff;
    };
}

echo "Connecting to Neon…\n";
$pdo = decoyCreatePdo();
decoyEnsureSchema($pdo);
echo "Schema ready.\n";

$firstNames = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
    'Ananya', 'Aadhya', 'Aarohi', 'Diya', 'Myra', 'Anika', 'Sara', 'Pari', 'Anvi', 'Kiara'];
$lastNames = ['Sharma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Khan', 'Singh', 'Mehta', 'Joshi',
    'Chopra', 'Desai', 'Malhotra', 'Rao', 'Verma', 'Kapoor', 'Pillai', 'Banerjee', 'Das', 'Kulkarni'];
$sources = ['website', 'google_ads', 'referral', 'whatsapp', 'walkin', 'college_seminar', 'facebook', 'youtube'];
$statuses = ['new', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'enrolled', 'lost', 'not_answered'];
$domains = ['example.com', 'mail.test', 'demo.local', 'leads.fake', 'inbox.sample'];

$admins = [
    ['email' => 'ops.admin@legacycrm.local', 'name' => 'Ops Admin', 'pass' => null],
    ['email' => 'crm.legacy@legacycrm.local', 'name' => 'Legacy CRM Admin', 'pass' => null],
];

$credLines = ["# DECOY credentials (Neon) — DO NOT COMMIT — generated " . gmdate('c') . "\n"];
$pdo->exec('DELETE FROM decoy_leads');
$pdo->exec('DELETE FROM decoy_users');
$insUser = $pdo->prepare(
    'INSERT INTO decoy_users (id, email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, TRUE)'
);

foreach ($admins as &$admin) {
    $plain = bin2hex(random_bytes(5)) . 'A!';
    $admin['pass'] = $plain;
    $hash = password_hash($plain, PASSWORD_BCRYPT);
    $insUser->execute([seedUuid(), $admin['email'], $admin['name'], $hash, 'admin']);
    $credLines[] = "{$admin['email']}  /  {$plain}\n";
}
unset($admin);

$credFile = $root . '/decoy-credentials.txt';
file_put_contents($credFile, implode('', $credLines));
@chmod($credFile, 0600);
echo "Admins seeded. Credentials → decoy-credentials.txt\n";

$rand = seedRng(12345);
$leadCount = 20000;
$batchSize = 500;
$insSql = 'INSERT INTO decoy_leads (id, name, email, phone, source, status, company, notes, created_at) VALUES ';

$pdo->beginTransaction();
for ($i = 0; $i < $leadCount; $i += $batchSize) {
    $values = [];
    $params = [];
    $n = min($batchSize, $leadCount - $i);
    for ($j = 0; $j < $n; $j++) {
        $fn = $firstNames[(int) floor($rand() * count($firstNames)) % count($firstNames)];
        $ln = $lastNames[(int) floor($rand() * count($lastNames)) % count($lastNames)];
        $name = $fn . ' ' . $ln;
        $local = strtolower($fn . '.' . $ln . ($i + $j));
        $domain = $domains[(int) floor($rand() * count($domains)) % count($domains)];
        $email = $local . '@' . $domain;
        $phone = '9' . str_pad((string) ((int) floor($rand() * 900000000) + 100000000), 9, '0', STR_PAD_LEFT);
        $source = $sources[(int) floor($rand() * count($sources)) % count($sources)];
        $status = $statuses[(int) floor($rand() * count($statuses)) % count($statuses)];
        $daysAgo = (int) floor($rand() * 730);
        $created = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')))
            ->modify("-{$daysAgo} days")
            ->setTime((int) floor($rand() * 23), (int) floor($rand() * 59), (int) floor($rand() * 59))
            ->format('Y-m-d H:i:s');
        $values[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?)';
        array_push(
            $params,
            seedUuid(),
            $name,
            $email,
            $phone,
            $source,
            $status,
            $ln . ' Solutions',
            'Synthetic decoy lead',
            $created
        );
    }
    $stmt = $pdo->prepare($insSql . implode(',', $values));
    $stmt->execute($params);
    echo 'Leads: ' . min($i + $n, $leadCount) . "/{$leadCount}\n";
}
$pdo->commit();

$label = $url !== '' ? 'DECOY_DATABASE_URL (Neon)' : ('host=' . $host);
echo "Done. Seeded {$leadCount} decoy leads + 2 admins into {$label}\n";
echo "Open /legacy after deploying the decoy frontend.\n";
