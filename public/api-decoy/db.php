<?php
/**
 * DECOY-ONLY PDO → Neon PostgreSQL. Never imports public/api/db.php (MySQL CRM).
 */
function decoyParseDatabaseUrl(string $url): ?array
{
    $url = trim($url);
    if ($url === '') {
        return null;
    }
    // Accept postgres:// or postgresql://
    $parts = parse_url($url);
    if (!$parts || empty($parts['host'])) {
        return null;
    }
    $db = isset($parts['path']) ? ltrim((string) $parts['path'], '/') : 'neondb';
    $query = [];
    if (!empty($parts['query'])) {
        parse_str((string) $parts['query'], $query);
    }
    return [
        'host' => (string) $parts['host'],
        'port' => isset($parts['port']) ? (string) $parts['port'] : '5432',
        'dbname' => $db !== '' ? $db : 'neondb',
        'user' => isset($parts['user']) ? rawurldecode((string) $parts['user']) : '',
        'pass' => isset($parts['pass']) ? rawurldecode((string) $parts['pass']) : '',
        'sslmode' => (string) ($query['sslmode'] ?? 'require'),
    ];
}

function decoyCreatePdo(): PDO
{
    $fromUrl = defined('DECOY_DATABASE_URL') ? decoyParseDatabaseUrl((string) DECOY_DATABASE_URL) : null;
    if ($fromUrl) {
        $host = $fromUrl['host'];
        $port = $fromUrl['port'];
        $dbname = $fromUrl['dbname'];
        $user = $fromUrl['user'];
        $pass = $fromUrl['pass'];
        $sslmode = $fromUrl['sslmode'] !== '' ? $fromUrl['sslmode'] : 'require';
    } else {
        $host = (string) DECOY_DB_HOST;
        $port = defined('DECOY_DB_PORT') && trim((string) DECOY_DB_PORT) !== ''
            ? trim((string) DECOY_DB_PORT)
            : '5432';
        $dbname = (string) DECOY_DB_NAME;
        $user = (string) DECOY_DB_USER;
        $pass = (string) DECOY_DB_PASS;
        $sslmode = defined('DECOY_DB_SSLMODE') && trim((string) DECOY_DB_SSLMODE) !== ''
            ? trim((string) DECOY_DB_SSLMODE)
            : 'require';
    }

    $dsn = "pgsql:host={$host};port={$port};dbname={$dbname};sslmode={$sslmode}";

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    try {
        $pdo->exec("SET TIME ZONE 'Asia/Kolkata'");
    } catch (Throwable $e) {
        try {
            $pdo->exec("SET TIME ZONE '+05:30'");
        } catch (Throwable $e2) {
        }
    }
    return $pdo;
}

class DecoyDatabase
{
    private ?PDO $conn = null;

    public function getConnection(): PDO
    {
        if ($this->conn === null) {
            try {
                $this->conn = decoyCreatePdo();
            } catch (PDOException $e) {
                error_log('[api-decoy] Neon connect: ' . $e->getMessage());
                decoy_json_die(['error' => 'Database connection failed'], 500);
            }
        }
        return $this->conn;
    }
}

function decoyEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec(
        'CREATE TABLE IF NOT EXISTS decoy_users (
            id CHAR(36) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(32) NOT NULL DEFAULT \'admin\',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )'
    );
    $db->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_decoy_users_email ON decoy_users (email)'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS decoy_leads (
            id CHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NULL,
            phone VARCHAR(40) NULL,
            source VARCHAR(64) NOT NULL DEFAULT \'website\',
            status VARCHAR(64) NOT NULL DEFAULT \'new\',
            company VARCHAR(255) NULL,
            notes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )'
    );
    $db->exec('CREATE INDEX IF NOT EXISTS idx_decoy_leads_created ON decoy_leads (created_at)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_decoy_leads_status ON decoy_leads (status)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_decoy_leads_source ON decoy_leads (source)');
    $done = true;
}
