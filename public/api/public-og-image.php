<?php
/**
 * Public Open Graph / WhatsApp preview image for form links.
 * No auth — only org_logos / form brand logos (or Syncpedia default).
 *
 * GET ?form=slug          → lead form org / brand logo
 * GET ?doc=slug           → document form org / brand logo
 * GET (no params)         → Syncpedia default OG image
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Method not allowed';
    exit;
}

require_once __DIR__ . '/helpers.php';

function publicOgResolveUploadAbs(string $rawPath): ?string
{
    $rawPath = trim($rawPath);
    if ($rawPath === '') {
        return null;
    }
    if ($rawPath[0] !== '/') {
        $rawPath = '/' . $rawPath;
    }
    if (strpos($rawPath, '..') !== false) {
        return null;
    }
    if (strpos($rawPath, '/uploads/org_logos/') !== 0) {
        return null;
    }
    $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
    $candidates = [
        dirname(__DIR__) . $relUploads,
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
        dirname(__DIR__, 2) . $relUploads,
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
    ];
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        $norm = str_replace('\\', '/', $resolved);
        if (strpos($norm, '/uploads/') === false) {
            continue;
        }
        return $resolved;
    }
    return null;
}

function publicOgNormalizeLogoCandidate(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '' || str_starts_with($raw, 'data:')) {
        return '';
    }
    if (preg_match('#^https?://#i', $raw)) {
        try {
            $u = parse_url($raw);
            $path = (string) ($u['path'] ?? '');
            $idx = strpos($path, '/uploads/org_logos/');
            if ($idx !== false) {
                return substr($path, $idx);
            }
        } catch (Throwable $e) {
            return '';
        }
        return $raw;
    }
    if (str_starts_with($raw, '/uploads/org_logos/') || str_starts_with($raw, 'uploads/org_logos/')) {
        return str_starts_with($raw, '/') ? $raw : '/' . $raw;
    }
    return '';
}

function publicOgDefaultImagePaths(): array
{
    $root = dirname(__DIR__, 2);
    return [
        $root . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'og-default.png',
        $root . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'logo.png',
        $root . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'syncpedia-logo.webp',
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'og-default.png',
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'logo.png',
        __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'logo.png',
    ];
}

function publicOgStreamFile(string $abs): void
{
    $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
    $mime = match ($ext) {
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
        default => 'application/octet-stream',
    };
    header('Content-Type: ' . $mime);
    header('Cache-Control: public, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    readfile($abs);
    exit;
}

function publicOgStreamDefault(): void
{
    foreach (publicOgDefaultImagePaths() as $path) {
        if (is_file($path)) {
            publicOgStreamFile($path);
        }
    }
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Logo not found';
    exit;
}

$formSlug = trim((string) ($_GET['form'] ?? ''));
$docSlug = trim((string) ($_GET['doc'] ?? ''));

$logoCandidates = [];

try {
    $db = (new Database())->getConnection();
    if ($formSlug !== '') {
        $row = publicLeadFetchFormBySlug($db, $formSlug);
        if (is_array($row)) {
            $meta = [];
            if (!empty($row['meta_json'])) {
                $tmp = is_array($row['meta_json']) ? $row['meta_json'] : json_decode((string) $row['meta_json'], true);
                if (is_array($tmp)) {
                    $meta = $tmp;
                }
            }
            $orgId = trim((string) ($row['org_id'] ?? ''));
            if ($orgId !== '') {
                $st = $db->prepare('SELECT logo_url FROM organizations WHERE id = ? LIMIT 1');
                $st->execute([$orgId]);
                $orgLogo = publicOgNormalizeLogoCandidate((string) ($st->fetchColumn() ?: ''));
                if ($orgLogo !== '') {
                    $logoCandidates[] = $orgLogo;
                }
            }
            $brand = publicOgNormalizeLogoCandidate((string) ($meta['logo_url'] ?? ''));
            if ($brand !== '') {
                $logoCandidates[] = $brand;
            }
        }
    } elseif ($docSlug !== '') {
        $st = $db->prepare(
            'SELECT df.meta_json, df.org_id, o.logo_url AS org_logo_url
             FROM doc_forms df
             LEFT JOIN organizations o ON o.id = df.org_id
             WHERE LOWER(TRIM(df.slug)) = LOWER(TRIM(?)) AND df.is_active = 1
             LIMIT 1'
        );
        $st->execute([$docSlug]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            $meta = [];
            if (!empty($row['meta_json'])) {
                $tmp = json_decode((string) $row['meta_json'], true);
                if (is_array($tmp)) {
                    $meta = $tmp;
                }
            }
            $orgLogo = publicOgNormalizeLogoCandidate((string) ($row['org_logo_url'] ?? ''));
            if ($orgLogo !== '') {
                $logoCandidates[] = $orgLogo;
            }
            $brand = publicOgNormalizeLogoCandidate((string) ($meta['logo_url'] ?? ''));
            if ($brand !== '') {
                $logoCandidates[] = $brand;
            }
        }
    }
} catch (Throwable $e) {
    error_log('[public-og-image] ' . $e->getMessage());
}

foreach ($logoCandidates as $cand) {
    if (preg_match('#^https?://#i', $cand)) {
        header('Location: ' . $cand, true, 302);
        exit;
    }
    $abs = publicOgResolveUploadAbs($cand);
    if ($abs !== null) {
        publicOgStreamFile($abs);
    }
}

publicOgStreamDefault();
