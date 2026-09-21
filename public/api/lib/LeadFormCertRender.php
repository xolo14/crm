<?php
/**
 * Render a certificate template (style + layers + background) to a PDF
 * that matches Certificates → Issue preview, without the browser canvas.
 */

/** @return array<string, mixed>|list<mixed> */
function leadFormCertDecodeJson($raw)
{
    if (is_array($raw)) {
        return $raw;
    }
    if (is_string($raw) && trim($raw) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    return [];
}

/** @return array{0:float,1:float} widthMm, heightMm */
function leadFormCertPageMm(string $pageFormat): array
{
    $map = [
        'a4-landscape' => [297.0, 210.0],
        'a4-portrait' => [210.0, 297.0],
        'letter-landscape' => [279.4, 215.9],
        'letter-portrait' => [215.9, 279.4],
        'a5-landscape' => [210.0, 148.0],
        'a5-portrait' => [148.0, 210.0],
        'square' => [210.0, 210.0],
    ];
    $key = strtolower(trim($pageFormat));
    return $map[$key] ?? $map['a4-landscape'];
}

function leadFormCertCanonicalToken(string $raw): string
{
    $compact = preg_replace('/[^a-zA-Z0-9_]+/', '_', trim($raw)) ?? '';
    $compact = trim($compact, '_');
    $lower = strtolower($compact);
    $aliases = [
        'name' => 'recipient_name',
        'recipient_name' => 'recipient_name',
        'candidate_name' => 'recipient_name',
        'date' => 'issue_date',
        'issue_date' => 'issue_date',
        'domain' => 'domain_name',
        'course' => 'domain_name',
        'course_name' => 'domain_name',
        'domain_name' => 'domain_name',
        'company' => 'company_name',
        'company_name' => 'company_name',
        'certid' => 'cert_id',
        'cert_id' => 'cert_id',
        'certificate_id' => 'cert_id',
        'sync_id' => 'cert_id',
        'start' => 'start',
        'end' => 'end',
        'start_date' => 'start',
        'end_date' => 'end',
    ];
    return $aliases[$lower] ?? $lower;
}

/**
 * @param array<string, string> $vars
 */
function leadFormCertApplyTokens(string $text, array $vars): string
{
    $lookup = static function (string $raw) use ($vars): ?string {
        $keys = [$raw, leadFormCertCanonicalToken($raw), strtolower(trim($raw))];
        foreach ($keys as $k) {
            if ($k !== '' && array_key_exists($k, $vars) && $vars[$k] !== '') {
                return (string) $vars[$k];
            }
        }
        $canon = leadFormCertCanonicalToken($raw);
        if ($canon !== '' && array_key_exists($canon, $vars) && trim((string) $vars[$canon]) !== '') {
            return (string) $vars[$canon];
        }
        return null;
    };
    $out = preg_replace_callback('/<<\s*([^<>]+?)\s*>>/', static function ($m) use ($lookup) {
        $v = $lookup((string) $m[1]);
        return $v !== null ? $v : (string) $m[0];
    }, $text) ?? $text;
    $out = preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', static function ($m) use ($lookup) {
        $v = $lookup((string) $m[1]);
        return $v !== null ? $v : (string) $m[0];
    }, $out) ?? $out;
    return $out;
}

function leadFormCertLayerHasTokens(string $text): bool
{
    return (bool) preg_match('/<<\s*[^<>]+?\s*>>/', $text)
        || (bool) preg_match('/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/', $text);
}

/**
 * Same order as CertificatesPage resolveLayerContent: fill <<tokens>> in place
 * instead of replacing a whole typed layer with a single value.
 *
 * @param array<string, mixed> $layer
 * @param array<string, string> $vars
 */
function leadFormCertResolveLayerContent(array $layer, array $vars): string
{
    $type = strtolower(trim((string) ($layer['type'] ?? 'text')));
    $content = (string) ($layer['content'] ?? $layer['text'] ?? '');
    if ($type === 'certid' || $type === 'cert_id') {
        return (string) ($vars['cert_id'] ?? $content);
    }
    if (leadFormCertLayerHasTokens($content)) {
        return leadFormCertApplyTokens($content, $vars);
    }
    if ($type === 'company') {
        $v = trim((string) ($vars['company_name'] ?? ''));
        return $v !== '' ? $v : $content;
    }
    if ($type === 'name') {
        $v = trim((string) ($vars['recipient_name'] ?? ''));
        return $v !== '' ? $v : $content;
    }
    if ($type === 'domain') {
        $v = trim((string) ($vars['domain_name'] ?? ''));
        return $v !== '' ? $v : $content;
    }
    if ($type === 'date') {
        $v = trim((string) ($vars['issue_date'] ?? ''));
        return $v !== '' ? $v : $content;
    }
    return leadFormCertApplyTokens($content, $vars);
}

function leadFormCertResolveUploadPath(string $raw): ?string
{
    $raw = trim($raw);
    if ($raw === '' || str_starts_with($raw, 'data:')) {
        return null;
    }
    if (str_starts_with($raw, 'blob:') || str_starts_with($raw, 'http://') || str_starts_with($raw, 'https://')) {
        return null;
    }
    if ($raw[0] !== '/') {
        $raw = '/' . $raw;
    }
    if (str_contains($raw, '..')) {
        return null;
    }
    if (function_exists('peaklyyResolveUploadFsPath')) {
        $hit = peaklyyResolveUploadFsPath($raw);
        if (is_string($hit) && is_file($hit)) {
            return $hit;
        }
    }
    $rel = str_replace('/', DIRECTORY_SEPARATOR, $raw);
    $candidates = [
        dirname(__DIR__, 2) . $rel,                          // public + /uploads
        dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'public' . $rel,
        dirname(__DIR__) . $rel,
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $rel,
    ];
    foreach ($candidates as $path) {
        $resolved = @realpath($path);
        if (is_string($resolved) && is_file($resolved)) {
            return $resolved;
        }
    }
    return null;
}

function leadFormCertLoadImage(string $src)
{
    $src = trim($src);
    if ($src === '') {
        return null;
    }
    $bytes = null;
    if (str_starts_with($src, 'data:image/')) {
        $comma = strpos($src, ',');
        if ($comma === false) {
            return null;
        }
        $bytes = base64_decode(substr($src, $comma + 1), true);
    } else {
        $path = leadFormCertResolveUploadPath($src);
        if ($path !== null) {
            $bytes = @file_get_contents($path);
        }
    }
    if (!is_string($bytes) || $bytes === '') {
        return null;
    }
    $im = @imagecreatefromstring($bytes);
    return $im ?: null;
}

function leadFormCertFindTtf(bool $serif = true, bool $bold = false): ?string
{
    $bundledDir = __DIR__ . DIRECTORY_SEPARATOR . 'fonts';
    $bundled = $bold
        ? [$bundledDir . DIRECTORY_SEPARATOR . 'Roboto-Bold.ttf', $bundledDir . DIRECTORY_SEPARATOR . 'Roboto-Regular.ttf']
        : [$bundledDir . DIRECTORY_SEPARATOR . 'Roboto-Regular.ttf', $bundledDir . DIRECTORY_SEPARATOR . 'Roboto-Bold.ttf'];
    foreach ($bundled as $path) {
        if (is_file($path)) {
            return $path;
        }
    }
    $serifNames = ['georgia.ttf', 'times.ttf', 'timesnr.ttf', 'DejaVuSerif.ttf', 'LiberationSerif-Regular.ttf'];
    $sansNames = $bold
        ? ['arialbd.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'Roboto-Bold.ttf']
        : ['arial.ttf', 'DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'FreeSans.ttf', 'Roboto-Regular.ttf'];
    $names = $serif ? array_merge($serifNames, $sansNames) : array_merge($sansNames, $serifNames);
    $dirs = [
        $bundledDir,
        'C:\\Windows\\Fonts',
        '/usr/share/fonts/truetype/dejavu',
        '/usr/share/fonts/truetype/liberation',
        '/usr/share/fonts/truetype/msttcorefonts',
        '/usr/share/fonts/truetype/freefont',
        '/usr/share/fonts/truetype',
        dirname(__DIR__, 2) . '/vendor/dompdf/dompdf/lib/fonts',
        dirname(__DIR__, 3) . '/php-backend/vendor/dompdf/dompdf/lib/fonts',
    ];
    foreach ($dirs as $dir) {
        if (!is_dir($dir)) {
            continue;
        }
        foreach ($names as $name) {
            $path = $dir . DIRECTORY_SEPARATOR . $name;
            if (is_file($path)) {
                return $path;
            }
        }
    }
    return null;
}

function leadFormCertTtfUsable(?string $font, float $size): bool
{
    if ($font === null || $font === '' || !function_exists('imagettfbbox')) {
        return false;
    }
    $box = @imagettfbbox($size, 0, $font, 'Ag');
    return is_array($box);
}

/**
 * Readable fallback when FreeType/TTF is missing: scale GD bitmap font to layer height.
 */
function leadFormCertDrawScaledBitmapText(
    $canvas,
    string $text,
    int $left,
    int $top,
    int $boxW,
    int $boxH,
    int $r,
    int $g,
    int $b,
    string $align,
    int $pixelHeight
): void {
    $font = 5;
    $cw = imagefontwidth($font);
    $ch = imagefontheight($font);
    if ($cw < 1 || $ch < 1 || $boxW < 4 || $boxH < 4) {
        return;
    }
    $pixelHeight = max($ch, min($boxH, $pixelHeight));
    $scale = $pixelHeight / $ch;
    $maxChars = max(6, (int) floor($boxW / max(1.0, $cw * $scale)));
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $lines = [];
    foreach (explode("\n", $text) as $para) {
        $para = trim($para);
        if ($para === '') {
            $lines[] = '';
            continue;
        }
        while (strlen($para) > $maxChars) {
            $chunk = substr($para, 0, $maxChars);
            $cut = strrpos($chunk, ' ');
            if ($cut === false || $cut < 4) {
                $cut = $maxChars;
            }
            $lines[] = rtrim(substr($para, 0, $cut));
            $para = ltrim(substr($para, $cut));
        }
        if ($para !== '') {
            $lines[] = $para;
        }
    }
    $maxLines = max(1, (int) floor($boxH / $pixelHeight));
    $lines = array_slice($lines, 0, $maxLines);
    if ($lines === []) {
        return;
    }
    $longest = 1;
    foreach ($lines as $line) {
        $longest = max($longest, strlen($line));
    }
    $tmpW = $longest * $cw + 2;
    $tmpH = count($lines) * ($ch + 1);
    $tmp = imagecreatetruecolor($tmpW, $tmpH);
    if ($tmp === false) {
        return;
    }
    imagealphablending($tmp, false);
    imagesavealpha($tmp, true);
    $clear = imagecolorallocatealpha($tmp, 0, 0, 0, 127);
    imagefilledrectangle($tmp, 0, 0, $tmpW, $tmpH, $clear);
    $col = imagecolorallocate($tmp, $r, $g, $b);
    foreach ($lines as $i => $line) {
        if ($line === '') {
            continue;
        }
        $lw = strlen($line) * $cw;
        if ($align === 'right') {
            $x = $tmpW - $lw;
        } elseif ($align === 'center') {
            $x = (int) (($tmpW - $lw) / 2);
        } else {
            $x = 0;
        }
        imagestring($tmp, $font, $x, $i * ($ch + 1), $line, $col);
    }
    $outW = (int) round($tmpW * $scale);
    $outH = (int) round($tmpH * $scale);
    if ($outW > $boxW && $outW > 0) {
        $fit = $boxW / $outW;
        $outW = $boxW;
        $outH = max(1, (int) round($outH * $fit));
    }
    if ($outH > $boxH && $outH > 0) {
        $fit = $boxH / $outH;
        $outH = $boxH;
        $outW = max(1, (int) round($outW * $fit));
    }
    $ox = $left;
    if ($align === 'center') {
        $ox = $left + (int) (($boxW - $outW) / 2);
    } elseif ($align === 'right') {
        $ox = $left + $boxW - $outW;
    }
    $oy = $top + (int) max(0, ($boxH - $outH) / 2);
    imagealphablending($canvas, true);
    imagecopyresampled($canvas, $tmp, $ox, $oy, 0, 0, $outW, $outH, $tmpW, $tmpH);
    imagedestroy($tmp);
}

/** @return array{0:int,1:int,2:int} */
function leadFormCertHexRgb(string $hex): array
{
    $hex = ltrim(trim($hex), '#');
    if (strlen($hex) === 3) {
        $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
    }
    if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
        return [17, 24, 39];
    }
    return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
}

function leadFormCertHttpGet(string $url): ?string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $data = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code >= 200 && $code < 300 && is_string($data) && $data !== '') {
            return $data;
        }
    }
    $ctx = stream_context_create([
        'http' => ['timeout' => 8],
        'https' => ['timeout' => 8],
    ]);
    $data = @file_get_contents($url, false, $ctx);
    return is_string($data) && $data !== '' ? $data : null;
}

function leadFormCertLoadQr(string $payload, int $sizePx)
{
    $sizePx = max(64, min(400, $sizePx));
    $url = 'https://api.qrserver.com/v1/create-qr-code/?size=' . $sizePx . 'x' . $sizePx
        . '&margin=0&ecc=M&data=' . rawurlencode($payload);
    $bytes = leadFormCertHttpGet($url);
    if (!is_string($bytes) || $bytes === '') {
        return null;
    }
    $im = @imagecreatefromstring($bytes);
    return $im ?: null;
}

/**
 * @param list<string> $lines
 */
function leadFormCertWrapTtf(string $font, float $size, string $text, int $maxW): array
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $out = [];
    foreach (explode("\n", $text) as $para) {
        $para = trim($para);
        if ($para === '') {
            $out[] = '';
            continue;
        }
        $words = preg_split('/\s+/', $para) ?: [];
        $cur = '';
        foreach ($words as $word) {
            $try = $cur === '' ? $word : $cur . ' ' . $word;
            $box = @imagettfbbox($size, 0, $font, $try);
            $tw = is_array($box) ? abs($box[2] - $box[0]) : strlen($try) * $size * 0.5;
            if ($tw > $maxW && $cur !== '') {
                $out[] = $cur;
                $cur = $word;
            } else {
                $cur = $try;
            }
        }
        if ($cur !== '') {
            $out[] = $cur;
        }
    }
    return $out === [] ? [''] : $out;
}

function leadFormCertCopyContain($dst, $src, int $dx, int $dy, int $dw, int $dh): void
{
    $sw = imagesx($src);
    $sh = imagesy($src);
    if ($sw < 1 || $sh < 1 || $dw < 1 || $dh < 1) {
        return;
    }
    $scale = min($dw / $sw, $dh / $sh);
    $nw = max(1, (int) round($sw * $scale));
    $nh = max(1, (int) round($sh * $scale));
    $ox = $dx + (int) floor(($dw - $nw) / 2);
    $oy = $dy + (int) floor(($dh - $nh) / 2);
    imagecopyresampled($dst, $src, $ox, $oy, 0, 0, $nw, $nh, $sw, $sh);
}

function leadFormCertJpegToPdf(string $jpeg, float $wMm, float $hMm): string
{
    $wPt = $wMm * 72 / 25.4;
    $hPt = $hMm * 72 / 25.4;
    $info = @getimagesizefromstring($jpeg);
    $iw = (int) ($info[0] ?? 1);
    $ih = (int) ($info[1] ?? 1);
    $len = strlen($jpeg);
    $content = sprintf("q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q\n", $wPt, $hPt);
    $clen = strlen($content);
    $objs = [
        "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {$wPt} {$hPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>endobj\n",
        "4 0 obj<< /Type /XObject /Subtype /Image /Width {$iw} /Height {$ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {$len} >>stream\n"
            . $jpeg . "\nendstream\nendobj\n",
        "5 0 obj<< /Length {$clen} >>stream\n{$content}endstream\nendobj\n",
    ];
    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objs as $obj) {
        $offsets[] = strlen($pdf);
        $pdf .= $obj;
    }
    $xref = strlen($pdf);
    $count = count($objs) + 1;
    $pdf .= "xref\n0 {$count}\n0000000000 65535 f \n";
    for ($i = 1; $i < $count; $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }
    $pdf .= "trailer<< /Size {$count} /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    return $pdf;
}

/**
 * @param array<string, mixed> $tplRow
 * @param array<string, string> $vars
 * @return array{ok:bool,pdf?:string,error?:string}
 */
function leadFormCertRenderTemplatePdf(array $tplRow, array $vars): array
{
    if (!function_exists('imagecreatetruecolor')) {
        return ['ok' => false, 'error' => 'GD not available'];
    }
    $style = leadFormCertDecodeJson($tplRow['style_json'] ?? null);
    $fields = leadFormCertDecodeJson($tplRow['fields_json'] ?? null);
    $layers = leadFormCertDecodeJson($tplRow['layers_json'] ?? null);
    if (!is_array($layers)) {
        $layers = [];
    } elseif ($layers !== [] && !isset($layers[0])) {
        $layers = isset($layers['type']) ? [$layers] : array_values($layers);
    }

    $pageFormat = (string) ($style['pageFormat'] ?? $style['page_format'] ?? 'a4-landscape');
    [$wMm, $hMm] = leadFormCertPageMm($pageFormat);
    $scale = 2.0;
    $pxPerMm = 96 / 25.4 * $scale;
    $W = max(400, (int) round($wMm * $pxPerMm));
    $H = max(280, (int) round($hMm * $pxPerMm));

    $canvas = imagecreatetruecolor($W, $H);
    if ($canvas === false) {
        return ['ok' => false, 'error' => 'Could not create certificate canvas'];
    }
    imagealphablending($canvas, true);
    imagesavealpha($canvas, true);
    [$br, $bg, $bb] = leadFormCertHexRgb((string) ($style['bgColor'] ?? $tplRow['bg_color'] ?? '#ffffff'));
    imagefill($canvas, 0, 0, imagecolorallocate($canvas, $br, $bg, $bb));

    $bgSrc = trim((string) ($style['bgImage'] ?? $style['bg_image'] ?? ''));
    if ($bgSrc === '') {
        $bgSrc = trim((string) ($style['bgPdf'] ?? ''));
    }
    if ($bgSrc !== '') {
        $bgIm = leadFormCertLoadImage($bgSrc);
        if ($bgIm) {
            imagecopyresampled($canvas, $bgIm, 0, 0, 0, 0, $W, $H, imagesx($bgIm), imagesy($bgIm));
            imagedestroy($bgIm);
        }
    }

    $overlay = $style['bgOverlayOpacity'] ?? null;
    if (is_numeric($overlay) && (float) $overlay > 0) {
        $alpha = (int) round(min(1, max(0, (float) $overlay)) * 127);
        $col = imagecolorallocatealpha($canvas, 255, 255, 255, $alpha);
        if ($col !== false) {
            imagefilledrectangle($canvas, 0, 0, $W, $H, $col);
        }
    }

    $company = trim((string) ($vars['company_name'] ?? ''));
    if ($company === '') {
        $company = trim((string) ($fields['companyName'] ?? $style['company_name'] ?? ''));
    }
    $name = (string) ($vars['recipient_name'] ?? '');
    $course = (string) ($vars['domain_name'] ?? '');
    $date = (string) ($vars['issue_date'] ?? '');
    $certId = (string) ($vars['cert_id'] ?? '');

    usort($layers, static function ($a, $b) {
        $za = (int) (is_array($a) ? ($a['zIndex'] ?? 0) : 0);
        $zb = (int) (is_array($b) ? ($b['zIndex'] ?? 0) : 0);
        return $za <=> $zb;
    });

    $serif = leadFormCertFindTtf(true, false);
    $sans = leadFormCertFindTtf(false, false);
    $sansBold = leadFormCertFindTtf(false, true);
    $defaultFont = $sans ?: $serif;

    $verifyBase = function_exists('syncpediaCrmAppBaseUrl') ? syncpediaCrmAppBaseUrl() : 'https://crm.syncpedia.in';
    $verifyUrl = rtrim($verifyBase, '/') . '/verify/' . rawurlencode($certId);

    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $type = strtolower(trim((string) ($layer['type'] ?? 'text')));
        $xPct = (float) ($layer['x'] ?? 50);
        $yPct = (float) ($layer['y'] ?? 50);
        $wPct = (float) ($layer['width'] ?? 20);
        $hPct = (float) ($layer['height'] ?? 10);
        if ($xPct <= 1.5 && $yPct <= 1.5 && $wPct <= 1.5) {
            $xPct *= 100;
            $yPct *= 100;
            $wPct *= 100;
            $hPct *= 100;
        }
        $boxW = max(8, (int) round($W * $wPct / 100));
        $boxH = max(8, (int) round($H * $hPct / 100));
        $cx = (int) round($W * $xPct / 100);
        $cy = (int) round($H * $yPct / 100);
        $left = $cx - (int) floor($boxW / 2);
        $top = $cy - (int) floor($boxH / 2);

        if ($type === 'qr') {
            $qrSize = min($boxW, $boxH);
            $qr = leadFormCertLoadQr($verifyUrl, max(80, $qrSize));
            if ($qr) {
                leadFormCertCopyContain($canvas, $qr, $left, $top, $boxW, $boxH);
                imagedestroy($qr);
            }
            continue;
        }

        if ($type === 'logo' || $type === 'image' || $type === 'signature') {
            $img = leadFormCertLoadImage((string) ($layer['content'] ?? ''));
            if ($img) {
                leadFormCertCopyContain($canvas, $img, $left, $top, $boxW, $boxH);
                imagedestroy($img);
            }
            continue;
        }

        $content = trim(leadFormCertResolveLayerContent($layer, $vars));
        if ($content === '') {
            continue;
        }

        $cssPx = (float) preg_replace('/[^0-9.]/', '', (string) ($layer['fontSize'] ?? 20));
        if ($cssPx <= 0) {
            $cssPx = $type === 'name' ? 32 : 18;
        }
        $gdSize = max(10.0, $cssPx * $scale * 0.75);
        $weight = strtolower((string) ($layer['fontWeight'] ?? 'normal'));
        $family = strtolower((string) ($layer['fontFamily'] ?? ''));
        $useSerif = str_contains($family, 'georgia') || str_contains($family, 'times') || str_contains($family, 'serif');
        $font = $weight === 'bold'
            ? ($sansBold ?: ($sans ?: $serif))
            : (($useSerif ? $serif : $sans) ?: $defaultFont);
        [$tr, $tg, $tb] = leadFormCertHexRgb((string) ($layer['color'] ?? '#111827'));
        $align = strtolower((string) ($layer['align'] ?? 'center'));
        $pad = (int) max(2, round($boxW * 0.02));
        $maxW = max(10, $boxW - $pad * 2);

        $drew = false;
        if (leadFormCertTtfUsable($font, $gdSize)) {
            $lines = leadFormCertWrapTtf((string) $font, $gdSize, $content, $maxW);
            $lineH = $gdSize * 1.28;
            $blockH = count($lines) * $lineH;
            $y0 = $top + max(0, ($boxH - $blockH) / 2) + $gdSize;
            $color = imagecolorallocate($canvas, $tr, $tg, $tb);
            foreach ($lines as $i => $line) {
                if ($line === '') {
                    continue;
                }
                $bbox = @imagettfbbox($gdSize, 0, (string) $font, $line);
                $tw = is_array($bbox) ? abs($bbox[2] - $bbox[0]) : strlen($line) * $gdSize * 0.5;
                if ($align === 'left') {
                    $tx = $left + $pad;
                } elseif ($align === 'right') {
                    $tx = $left + $boxW - $pad - $tw;
                } else {
                    $tx = $left + (int) round(($boxW - $tw) / 2);
                }
                $ok = @imagettftext($canvas, $gdSize, 0, (int) $tx, (int) round($y0 + $i * $lineH), $color, (string) $font, $line);
                if ($ok !== false) {
                    $drew = true;
                }
            }
        }
        if (!$drew) {
            leadFormCertDrawScaledBitmapText(
                $canvas,
                $content,
                $left,
                $top,
                $boxW,
                $boxH,
                $tr,
                $tg,
                $tb,
                $align,
                (int) max(14, min($boxH, $cssPx * $scale)),
            );
        }
    }

    ob_start();
    imagejpeg($canvas, null, 90);
    $jpeg = ob_get_clean();
    imagedestroy($canvas);
    if (!is_string($jpeg) || $jpeg === '') {
        return ['ok' => false, 'error' => 'Could not encode certificate image'];
    }
    $pdf = leadFormCertJpegToPdf($jpeg, $wMm, $hMm);
    if ($pdf === '') {
        return ['ok' => false, 'error' => 'Could not wrap certificate PDF'];
    }
    return ['ok' => true, 'pdf' => $pdf];
}
