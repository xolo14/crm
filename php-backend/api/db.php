<?php
/**
 * PDO connection + portable schema helpers (Hostinger MySQL / optional PostgreSQL).
 */

function syncpediaDbDriver(): string
{
    if (defined('DB_DRIVER') && trim((string) DB_DRIVER) !== '') {
        return strtolower(trim((string) DB_DRIVER));
    }
    $port = defined('DB_PORT') ? trim((string) DB_PORT) : '3306';
    if ($port === '5432') {
        return 'pgsql';
    }

    return 'mysql';
}

function syncpediaCreatePdo(): PDO
{
    $driver = syncpediaDbDriver();

    if ($driver === 'pgsql') {
        $host = (string) DB_HOST;
        $port = defined('DB_PORT') && trim((string) DB_PORT) !== '' ? trim((string) DB_PORT) : '5432';
        $dbname = (string) DB_NAME;
        $user = (string) DB_USER;
        $pass = (string) DB_PASS;
        $ssl = defined('DB_SSLMODE') && trim((string) DB_SSLMODE) !== '' ? trim((string) DB_SSLMODE) : 'require';
        $dsn = "pgsql:host={$host};port={$port};dbname={$dbname};sslmode={$ssl}";

        return new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }

    $host = (string) DB_HOST;
    $port = defined('DB_PORT') && trim((string) DB_PORT) !== '' ? (int) DB_PORT : 3306;
    $dbname = (string) DB_NAME;
    $user = (string) DB_USER;
    $pass = (string) DB_PASS;
    $charset = defined('DB_CHARSET') && trim((string) DB_CHARSET) !== '' ? trim((string) DB_CHARSET) : 'utf8mb4';
    $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset={$charset}";

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci',
    ]);
    // Hostinger MySQL is usually UTC. App users are India — store/read wall-clock IST
    // so CURRENT_TIMESTAMP and TIMESTAMP columns match real activity time.
    try {
        $pdo->exec("SET time_zone = '+05:30'");
    } catch (Throwable $e) {
        // Older hosts without zone tables may reject named zones; offset form usually works.
    }

    return $pdo;
}

function syncpediaDbIsMysql(PDO $db): bool
{
    try {
        return $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    } catch (Throwable $e) {
        return true;
    }
}

function syncpediaColumnExists(PDO $db, string $table, string $column): bool
{
    try {
        if (syncpediaDbIsMysql($db)) {
            $st = $db->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            );
        } else {
            $st = $db->prepare(
                "SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?",
            );
        }
        $st->execute([$table, $column]);

        return (int) $st->fetchColumn() > 0;
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Column names for a table in the current database (MySQL phpMyAdmin / Hostinger,
 * or PostgreSQL). Never hardcode schema = 'public' — that is Postgres-only and
 * returns zero rows on MySQL, which breaks trash restore.
 *
 * @return list<string>
 */
function syncpediaTableColumns(PDO $db, string $table): array
{
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', $table) ?? '';
    if ($table === '') {
        return [];
    }
    try {
        if (syncpediaDbIsMysql($db)) {
            $st = $db->prepare(
                'SELECT COLUMN_NAME AS col_name FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            );
        } else {
            $st = $db->prepare(
                "SELECT column_name AS col_name FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = ?",
            );
        }
        $st->execute([$table]);
        $cols = [];
        while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
            $name = (string) ($row['col_name'] ?? $row['COLUMN_NAME'] ?? $row['column_name'] ?? '');
            if ($name !== '') {
                $cols[] = $name;
            }
        }
        return $cols;
    } catch (Throwable $e) {
        error_log('[syncpedia] table columns ' . $table . ': ' . $e->getMessage());
        return [];
    }
}

function isMysqlDuplicateKey(Throwable $e): bool
{
    if ($e instanceof PDOException && isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062) {
        return true;
    }
    $m = $e->getMessage();

    return stripos($m, '1062') !== false || stripos($m, 'duplicate entry') !== false;
}

function isMysqlForeignKeyViolation(Throwable $e): bool
{
    if ($e instanceof PDOException && isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1452) {
        return true;
    }
    $m = $e->getMessage();

    return stripos($m, '1452') !== false || stripos($m, 'foreign key constraint') !== false;
}

/**
 * Portable INSERT … upsert suffix (MySQL ON DUPLICATE KEY UPDATE / PostgreSQL ON CONFLICT).
 *
 * @param list<string> $pgsqlSet e.g. ['enabled = EXCLUDED.enabled']
 * @param list<string> $mysqlSet e.g. ['`enabled` = VALUES(`enabled`)']
 */
function syncpediaUpsertClause(
    PDO $db,
    string $pgsqlConflictTarget,
    array $pgsqlSet,
    array $mysqlSet,
): string {
    if (syncpediaDbIsMysql($db)) {
        return 'ON DUPLICATE KEY UPDATE ' . implode(', ', $mysqlSet);
    }

    return 'ON CONFLICT ' . $pgsqlConflictTarget . ' DO UPDATE SET ' . implode(', ', $pgsqlSet);
}

/** Best-effort index create (MySQL + PostgreSQL). */
function syncpediaEnsureIndex(PDO $db, string $indexName, string $table, string $columnsSql): void
{
    try {
        if (syncpediaDbIsMysql($db)) {
            $st = $db->prepare(
                'SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
            );
            $st->execute([$table, $indexName]);
            if ((int) $st->fetchColumn() > 0) {
                return;
            }
            $db->exec('CREATE INDEX `' . str_replace('`', '', $indexName) . '` ON `' . str_replace('`', '', $table) . '` (' . $columnsSql . ')');
            return;
        }
        $db->exec(
            'CREATE INDEX IF NOT EXISTS ' . $indexName . ' ON ' . $table . ' (' . $columnsSql . ')',
        );
    } catch (Throwable $e) {
        error_log('[syncpedia] ensure index ' . $indexName . ': ' . $e->getMessage());
    }
}

/** Skip runtime PostgreSQL-only DDL when using imported MySQL schema (phpMyAdmin). */
function syncpediaSkipRuntimeDdl(PDO $db): bool
{
    return syncpediaDbIsMysql($db);
}
