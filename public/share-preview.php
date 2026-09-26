<?php
/**
 * Social crawler preview for /apply and /doc-form links.
 * Humans are redirected to the SPA; bots get static Open Graph HTML
 * with the organization (or Syncpedia) logo — WhatsApp does not run JS.
 */
$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$isBot = (bool) preg_match(
    '/facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|Pinterest|Googlebot|bingbot|Applebot|Embedly|Quora|redditbot|SkypeUriPreview|vkShare|W3C_Validator/i',
    $ua,
);

$form = trim((string) ($_GET['form'] ?? ''));
$doc = trim((string) ($_GET['doc'] ?? ''));
$slugPath = trim((string) ($_GET['slug'] ?? ''));
if ($doc === '' && $slugPath !== '') {
    $doc = $slugPath;
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = (string) ($_SERVER['HTTP_HOST'] ?? 'crm.syncpedia.in');
$origin = $scheme . '://' . $host;

if (!$isBot) {
    if ($form !== '') {
        $qs = $_GET;
        header('Location: ' . $origin . '/apply?' . http_build_query($qs), true, 302);
        exit;
    }
    if ($doc !== '') {
        header('Location: ' . $origin . '/doc-form/' . rawurlencode($doc), true, 302);
        exit;
    }
    header('Location: ' . $origin . '/', true, 302);
    exit;
}

$title = 'Syncpedia CRM';
$description = 'EdTech sales, leads, and operations platform for training organizations in India.';
$canonical = $origin . '/';
$image = $origin . '/api/public-og-image.php?v=20260924';

try {
    require_once __DIR__ . '/api/helpers.php';
    $db = (new Database())->getConnection();

    if ($form !== '') {
        $row = publicLeadFetchFormBySlug($db, $form);
        if (is_array($row)) {
            $name = trim((string) ($row['name'] ?? ''));
            $orgName = trim((string) ($row['org_name'] ?? ''));
            $desc = trim((string) ($row['description'] ?? ''));
            $title = $name !== '' ? $name : $title;
            if ($orgName !== '') {
                $title = $title . ' | ' . $orgName;
            }
            if ($desc !== '') {
                $description = substr(strip_tags($desc), 0, 200);
            } elseif ($orgName !== '') {
                $description = 'Apply via ' . $orgName . ' on Syncpedia CRM.';
            }
            $canonical = $origin . '/apply?form=' . rawurlencode($form);
            if (!empty($_GET['ref'])) {
                $canonical .= '&ref=' . rawurlencode((string) $_GET['ref']);
            }
            $image = $origin . '/api/public-og-image.php?form=' . rawurlencode($form);
        }
    } elseif ($doc !== '') {
        $st = $db->prepare(
            'SELECT df.name, df.description, df.slug, o.name AS org_name
             FROM doc_forms df
             LEFT JOIN organizations o ON o.id = df.org_id
             WHERE LOWER(TRIM(df.slug)) = LOWER(TRIM(?)) AND df.is_active = 1
             LIMIT 1'
        );
        $st->execute([$doc]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            $name = trim((string) ($row['name'] ?? ''));
            $orgName = trim((string) ($row['org_name'] ?? ''));
            $desc = trim((string) ($row['description'] ?? ''));
            $title = $name !== '' ? $name : $title;
            if ($orgName !== '') {
                $title = $title . ' | ' . $orgName;
            }
            if ($desc !== '') {
                $description = substr(strip_tags($desc), 0, 200);
            } elseif ($orgName !== '') {
                $description = 'Open this form from ' . $orgName . '.';
            }
            $canonical = $origin . '/doc-form/' . rawurlencode((string) ($row['slug'] ?? $doc));
            $image = $origin . '/api/public-og-image.php?doc=' . rawurlencode($doc);
        }
    }
} catch (Throwable $e) {
    error_log('[share-preview] ' . $e->getMessage());
}

$eTitle = htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$eDesc = htmlspecialchars($description, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$eCanon = htmlspecialchars($canonical, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$eImage = htmlspecialchars($image, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: public, max-age=300');
echo '<!doctype html><html lang="en-IN"><head>';
echo '<meta charset="UTF-8" />';
echo '<title>' . $eTitle . '</title>';
echo '<meta name="description" content="' . $eDesc . '" />';
echo '<meta property="og:type" content="website" />';
echo '<meta property="og:title" content="' . $eTitle . '" />';
echo '<meta property="og:description" content="' . $eDesc . '" />';
echo '<meta property="og:url" content="' . $eCanon . '" />';
echo '<meta property="og:image" content="' . $eImage . '" />';
echo '<meta property="og:image:secure_url" content="' . $eImage . '" />';
echo '<meta property="og:image:width" content="1200" />';
echo '<meta property="og:image:height" content="630" />';
echo '<meta name="twitter:card" content="summary_large_image" />';
echo '<meta name="twitter:title" content="' . $eTitle . '" />';
echo '<meta name="twitter:description" content="' . $eDesc . '" />';
echo '<meta name="twitter:image" content="' . $eImage . '" />';
echo '<link rel="canonical" href="' . $eCanon . '" />';
echo '<meta http-equiv="refresh" content="0;url=' . $eCanon . '" />';
echo '</head><body>';
echo '<p><a href="' . $eCanon . '">' . $eTitle . '</a></p>';
echo '</body></html>';
