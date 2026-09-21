<?php
/**
 * Match certificate / offer-letter placeholders to lead-form fields.
 * Unmatched tokens keep template text (or a saved prefill) instead of being wiped.
 */

/** @return array<string, mixed>|list<mixed> */
function formTplDecodeJson($raw)
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

function formTplNormalizeKey(string $raw): string
{
    $n = strtolower(trim($raw));
    $n = preg_replace('/[^a-z0-9]+/', '_', $n) ?? '';
    return trim($n, '_');
}

function formTplGroup(string $raw): string
{
    $n = formTplNormalizeKey($raw);
    if ($n === '') {
        return '';
    }
    $groups = [
        'name' => ['name', 'full_name', 'recipient_name', 'candidate_name', 'student_name'],
        'email' => ['email', 'email_address', 'e_mail', 'recipient_email'],
        'phone' => ['phone', 'mobile', 'whatsapp', 'phone_number', 'whatsapp_number'],
        'course' => ['course', 'domain', 'program', 'course_interest', 'specialization', 'domain_name', 'course_name', 'internship'],
        'start' => ['start', 'start_date', 'from', 'from_date', 'joining_date', 'internship_start', 'internship_start_date', 'begin', 'commencing', 'date_from'],
        'end' => ['end', 'end_date', 'to', 'until', 'completion_date', 'internship_end', 'internship_end_date', 'finishing', 'date_to', 'to_date'],
        'company' => ['company', 'company_name', 'organization', 'organisation', 'org'],
        'date' => ['date', 'issue_date', 'issued_on'],
        'cert_id' => ['cert_id', 'certid', 'certificate_id', 'sync_id'],
        'college' => ['college', 'institution', 'university'],
        'role_title' => ['role', 'role_title', 'title', 'designation', 'position'],
        'department' => ['department', 'dept'],
        'salary' => ['salary', 'ctc', 'compensation'],
        'work_location' => ['work_location', 'location', 'city'],
    ];
    if (isset($groups[$n])) {
        return $n;
    }
    foreach ($groups as $group => $aliases) {
        if (in_array($n, $aliases, true)) {
            return $group;
        }
    }
    return $n;
}

/**
 * @return list<string>
 */
function formTplAliasKeys(string $key): array
{
    $g = formTplGroup($key);
    $map = [
        'name' => ['name', 'recipient_name', 'candidate_name', 'full_name'],
        'email' => ['email', 'recipient_email'],
        'phone' => ['phone', 'mobile'],
        'course' => ['course', 'domain', 'domain_name', 'course_name', 'course_interest'],
        'start' => ['start', 'start_date', 'from', 'from_date'],
        'end' => ['end', 'end_date', 'to', 'to_date'],
        'company' => ['company', 'company_name'],
        'date' => ['date', 'issue_date'],
        'college' => ['college'],
        'role_title' => ['role_title', 'role', 'title'],
    ];
    $keys = $map[$g] ?? [$key, formTplNormalizeKey($key)];
    if (!in_array($key, $keys, true)) {
        array_unshift($keys, $key);
    }
    return array_values(array_unique(array_filter($keys)));
}

function formTplLooksLikeSample(string $text): bool
{
    $t = strtolower(trim($text));
    if ($t === '') {
        return true;
    }
    if (str_contains($t, '<<') || str_contains($t, '{{')) {
        return true;
    }
    $samples = ['recipient name', 'type here', 'type here…', 'your name', 'candidate name'];
    if (in_array($t, $samples, true)) {
        return true;
    }
    if (strlen($t) > 80) {
        return true;
    }
    if (preg_match('/successfully|internship in/i', $t)) {
        return true;
    }
    return false;
}

function formTplTokenLabel(string $key, string $style = 'angle'): string
{
    $label = trim(str_replace('_', ' ', $key));
    $label = $label === '' ? $key : ucwords($label);
    if (strcasecmp($key, 'certid') === 0 || strcasecmp($key, 'cert_id') === 0) {
        $label = 'Cert ID';
    }
    return $style === 'mustache' ? '{{' . formTplNormalizeKey($key) . '}}' : '<<' . $label . '>>';
}

/**
 * @param list<array{key:string,token?:string,label?:string,auto?:bool,prefill?:string}> $found
 * @return list<array{key:string,token:string,label:string,auto:bool,prefill:string}>
 */
function formTplPushPlaceholder(array &$found, string $key, string $token, string $label, bool $auto = false, string $prefill = ''): void
{
    $canon = formTplNormalizeKey($key);
    if ($canon === '') {
        return;
    }
    $g = formTplGroup($canon);
    $storeKey = $g !== '' ? $g : $canon;
    foreach ($found as &$row) {
        if (($row['key'] ?? '') === $storeKey) {
            if ($prefill !== '' && trim((string) ($row['prefill'] ?? '')) === '') {
                $row['prefill'] = $prefill;
            }
            if ($auto) {
                $row['auto'] = true;
            }
            return;
        }
    }
    unset($row);
    $found[] = [
        'key' => $storeKey,
        'token' => $token !== '' ? $token : formTplTokenLabel($storeKey, str_starts_with($token, '{{') ? 'mustache' : 'angle'),
        'label' => $label !== '' ? $label : ucwords(str_replace('_', ' ', $storeKey)),
        'auto' => $auto,
        'prefill' => $prefill,
    ];
}

function formTplCollectTokensFromText(string $text, array &$found, string $style = 'angle'): void
{
    if ($text === '') {
        return;
    }
    if (preg_match_all('/<<\s*([^<>]+?)\s*>>/', $text, $m)) {
        foreach ($m[1] as $raw) {
            $key = formTplNormalizeKey((string) $raw);
            $g = formTplGroup($key);
            $auto = in_array($g, ['cert_id', 'certid'], true) || $key === 'certid' || $key === 'cert_id';
            formTplPushPlaceholder($found, $key, '<<' . trim((string) $raw) . '>>', trim((string) $raw), $auto);
        }
    }
    if (preg_match_all('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', $text, $m2)) {
        foreach ($m2[1] as $raw) {
            $key = formTplNormalizeKey((string) $raw);
            $g = formTplGroup($key);
            $auto = $g === 'cert_id' || in_array($key, ['certid', 'cert_id', 'ref_number', 'letterhead_url'], true);
            formTplPushPlaceholder(
                $found,
                $key,
                '{{' . $raw . '}}',
                ucwords(str_replace('_', ' ', $key)),
                $auto
            );
        }
    }
}

/**
 * @param array<string, mixed> $row
 * @return list<array{key:string,token:string,label:string,auto:bool,prefill:string}>
 */
function formTplExtractCertificatePlaceholders(array $row): array
{
    $found = [];
    $style = formTplDecodeJson($row['style_json'] ?? null);
    $fields = formTplDecodeJson($row['fields_json'] ?? null);
    $layers = formTplDecodeJson($row['layers_json'] ?? null);
    if ($layers !== [] && !isset($layers[0]) && isset($layers['type'])) {
        $layers = [$layers];
    }
    $chunks = [
        (string) ($fields['title'] ?? ''),
        (string) ($fields['bodyText'] ?? ''),
        (string) ($style['mail_subject'] ?? ''),
        (string) ($style['mail_body'] ?? ''),
        (string) ($style['pdf_filename_pattern'] ?? ''),
    ];
    if (is_array($layers)) {
        foreach ($layers as $layer) {
            if (!is_array($layer)) {
                continue;
            }
            $type = strtolower(trim((string) ($layer['type'] ?? 'text')));
            $content = (string) ($layer['content'] ?? $layer['text'] ?? '');
            if (in_array($type, ['qr', 'logo', 'image', 'signature'], true)) {
                continue;
            }
            if ($type === 'certid' || $type === 'cert_id') {
                formTplPushPlaceholder($found, 'cert_id', '<<CertID>>', 'Cert ID', true);
                continue;
            }
            formTplCollectTokensFromText($content, $found, 'angle');
            $prefill = formTplLooksLikeSample($content) ? '' : trim($content);
            if ($type === 'name') {
                formTplPushPlaceholder($found, 'name', '<<Name>>', 'Recipient name', false, $prefill);
            } elseif ($type === 'domain') {
                $d = trim((string) ($fields['domainName'] ?? ''));
                if (formTplLooksLikeSample($d)) {
                    $d = '';
                }
                formTplPushPlaceholder($found, 'course', '<<Course>>', 'Course / Domain', false, $d);
            } elseif ($type === 'date') {
                formTplPushPlaceholder($found, 'date', '<<Date>>', 'Issue date', true);
            } elseif ($type === 'company') {
                $c = trim((string) ($fields['companyName'] ?? ''));
                formTplPushPlaceholder($found, 'company', '<<Company>>', 'Company', false, $c !== '' ? $c : $prefill);
            }
        }
    }
    foreach ($chunks as $chunk) {
        formTplCollectTokensFromText($chunk, $found, 'angle');
    }
    $company = trim((string) ($fields['companyName'] ?? $style['company_name'] ?? ''));
    if ($company !== '') {
        formTplPushPlaceholder($found, 'company', '<<Company>>', 'Company', false, $company);
    }
    return array_values($found);
}

/**
 * @param array<string, mixed> $row
 * @return list<array{key:string,token:string,label:string,auto:bool,prefill:string}>
 */
function formTplExtractOfferPlaceholders(array $row): array
{
    $found = [];
    $mail = formTplDecodeJson($row['mail_json'] ?? null);
    formTplCollectTokensFromText((string) ($row['html_content'] ?? ''), $found, 'mustache');
    formTplCollectTokensFromText((string) ($mail['mail_subject'] ?? ''), $found, 'mustache');
    formTplCollectTokensFromText((string) ($mail['mail_body'] ?? ''), $found, 'mustache');
    formTplCollectTokensFromText((string) ($mail['pdf_filename_pattern'] ?? ''), $found, 'mustache');
    $role = trim((string) ($row['role_title'] ?? ''));
    if ($role !== '') {
        formTplPushPlaceholder($found, 'role_title', '{{role_title}}', 'Role / title', false, $role);
    }
    $company = trim((string) ($mail['company_name'] ?? ''));
    if ($company !== '') {
        formTplPushPlaceholder($found, 'company', '{{company_name}}', 'Company', false, $company);
    }
    return array_values($found);
}

/**
 * @return list<array{key:string,label:string}>
 */
function formTplFormFieldOptions(array $formRow): array
{
    $meta = formTplDecodeJson($formRow['meta_json'] ?? null);
    $questions = $meta['builder_questions'] ?? [];
    $out = [];
    if (is_array($questions) && $questions !== []) {
        $i = 0;
        foreach ($questions as $q) {
            if (!is_array($q)) {
                $i++;
                continue;
            }
            $type = strtolower(trim((string) ($q['type'] ?? '')));
            if (in_array($type, ['section_break', 'image', 'video'], true)) {
                $i++;
                continue;
            }
            $out[] = [
                'key' => formTplQuestionKey($q, $i),
                'label' => trim((string) ($q['title'] ?? '')) ?: ('Question ' . ($i + 1)),
                'id' => trim((string) ($q['id'] ?? '')),
                'type' => $type,
            ];
            $i++;
        }
        return $out;
    }
    $fields = formTplDecodeJson($formRow['fields_json'] ?? null);
    if (is_array($fields)) {
        foreach ($fields as $f) {
            if (!is_array($f)) {
                continue;
            }
            $key = trim((string) ($f['key'] ?? ''));
            if ($key === '') {
                continue;
            }
            $out[] = [
                'key' => $key,
                'label' => trim((string) ($f['label'] ?? $key)),
            ];
        }
    }
    return $out;
}

function formTplQuestionKey(array $q, int $idx): string
{
    $title = trim((string) ($q['title'] ?? ''));
    $type = strtolower(trim((string) ($q['type'] ?? '')));
    $validation = is_array($q['validation'] ?? null) ? $q['validation'] : [];
    if (($validation['kind'] ?? '') === 'regex' && ($validation['value'] ?? '') === 'email') {
        return 'email';
    }
    if (preg_match('/e[\s-]*mail(\s+address)?/i', $title)) {
        return 'email';
    }
    if ($type === 'phone_number') {
        return 'phone';
    }
    if (preg_match('/full\s*name/i', $title)) {
        return 'name';
    }
    if (preg_match('/phone|mobile|whatsapp/i', $title)) {
        return 'phone';
    }
    $from = formTplNormalizeKey($title);
    return $from !== '' ? $from : ('field_' . ($idx + 1));
}

/**
 * @param list<array<string,mixed>> $placeholders
 * @param list<array{key:string,label:string}> $fields
 * @param list<array<string,mixed>> $previous
 * @return list<array{key:string,field_key:string,prefill:string}>
 */
function formTplMergeMappings(array $placeholders, array $fields, array $previous, array $defaults = []): array
{
    $prevByKey = [];
    foreach ($previous as $row) {
        if (!is_array($row)) {
            continue;
        }
        $k = formTplNormalizeKey((string) ($row['key'] ?? ''));
        if ($k !== '') {
            $prevByKey[$k] = $row;
        }
    }
    $fieldKeys = [];
    foreach ($fields as $f) {
        $fieldKeys[(string) ($f['key'] ?? '')] = $f;
    }
    $used = [];
    $out = [];
    foreach ($placeholders as $ph) {
        $key = formTplNormalizeKey((string) ($ph['key'] ?? ''));
        if ($key === '') {
            continue;
        }
        $prev = $prevByKey[$key] ?? null;
        $kept = '';
        if (is_array($prev)) {
            $fk = trim((string) ($prev['field_key'] ?? ''));
            if ($fk !== '' && isset($fieldKeys[$fk])) {
                $kept = $fk;
                $used[$fk] = true;
            }
        }
        $prefill = is_array($prev) ? trim((string) ($prev['prefill'] ?? '')) : '';
        if ($prefill === '' && !is_array($prev)) {
            $prefill = trim((string) ($ph['prefill'] ?? ''));
            $g = formTplGroup($key);
            if ($prefill === '' && $g === 'course') {
                $prefill = trim((string) ($defaults['course'] ?? ''));
            }
            if ($prefill === '' && $g === 'company') {
                $prefill = trim((string) ($defaults['company'] ?? ''));
            }
        }
        $out[] = [
            'key' => $key,
            'field_key' => $kept,
            'prefill' => $prefill,
        ];
    }
    foreach ($out as &$row) {
        if (($row['field_key'] ?? '') !== '') {
            continue;
        }
        $ph = null;
        foreach ($placeholders as $p) {
            if (formTplNormalizeKey((string) ($p['key'] ?? '')) === $row['key']) {
                $ph = $p;
                break;
            }
        }
        if (!is_array($ph)) {
            continue;
        }
        if (!empty($ph['auto']) && in_array($row['key'], ['cert_id', 'certid', 'ref_number'], true)) {
            continue;
        }
        if (isset($prevByKey[$row['key']])) {
            continue;
        }
        $match = formTplMatchField($ph, $fields, $used);
        if ($match !== null) {
            $row['field_key'] = $match;
            $used[$match] = true;
        }
    }
    unset($row);
    return $out;
}

/**
 * @param array<string,mixed> $ph
 * @param list<array{key:string,label:string}> $fields
 * @param array<string,bool> $used
 */
function formTplMatchField(array $ph, array $fields, array $used): ?string
{
    $pg = formTplGroup((string) ($ph['key'] ?? '')) ?: formTplGroup((string) ($ph['label'] ?? ''));
    $best = null;
    $bestScore = 0;
    foreach ($fields as $field) {
        $fk = (string) ($field['key'] ?? '');
        if ($fk === '' || isset($used[$fk])) {
            continue;
        }
        $fg = formTplGroup($fk) ?: formTplGroup((string) ($field['label'] ?? ''));
        $label = (string) ($field['label'] ?? '');
        $type = strtolower((string) ($field['type'] ?? ''));
        $score = 0;
        if (formTplNormalizeKey($fk) === formTplNormalizeKey((string) ($ph['key'] ?? ''))) {
            $score = 100;
        } elseif (formTplNormalizeKey($label) === formTplNormalizeKey((string) ($ph['key'] ?? ''))) {
            $score = 90;
        } elseif ($pg !== '' && $fg !== '' && $pg === $fg) {
            $score = 80;
        } elseif ($type === 'date' && $pg === 'start' && preg_match('/start|from|begin|join|commenc/i', $label . ' ' . $fk)) {
            $score = 85;
        } elseif ($type === 'date' && $pg === 'end' && preg_match('/end|to|until|complet|finish/i', $label . ' ' . $fk)) {
            $score = 85;
        }
        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $fk;
        }
    }
    return $bestScore >= 80 ? $best : null;
}

/**
 * @return array<string, string>
 */
function formTplScalarize($value): string
{
    if ($value === null) {
        return '';
    }
    if (is_bool($value)) {
        return $value ? 'Yes' : 'No';
    }
    if (is_scalar($value)) {
        return trim((string) $value);
    }
    if (is_array($value)) {
        $isList = array_keys($value) === range(0, count($value) - 1);
        if ($isList) {
            $parts = [];
            foreach ($value as $item) {
                $s = formTplScalarize($item);
                if ($s !== '') {
                    $parts[] = $s;
                }
            }
            return implode(', ', $parts);
        }
        $parts = [];
        foreach ($value as $k => $v) {
            $s = formTplScalarize($v);
            if ($s !== '') {
                $parts[] = trim((string) $k) . ': ' . $s;
            }
        }
        return implode('; ', $parts);
    }
    return '';
}

function formTplParseLeadAnswers(array $lead): array
{
    $out = [];
    foreach (['name', 'email', 'phone', 'college', 'course_interest', 'company'] as $k) {
        $v = trim((string) ($lead[$k] ?? ''));
        if ($v !== '') {
            $out[$k] = $v;
        }
    }
    $notes = (string) ($lead['notes'] ?? '');
    $json = '';
    if ($notes !== '') {
        if (preg_match('/Answers:\s*/', $notes, $m, PREG_OFFSET_CAPTURE)) {
            $from = (int) $m[0][1] + strlen($m[0][0]);
            $chunk = substr($notes, $from);
            $attach = strpos($chunk, "\nAttachments:");
            if ($attach !== false) {
                $chunk = substr($chunk, 0, $attach);
            }
            $json = trim($chunk);
        } elseif ($notes[0] === '{' || $notes[0] === '[') {
            $json = $notes;
        }
    }
    if ($json !== '') {
        $decoded = json_decode($json, true);
        if (is_array($decoded)) {
            foreach ($decoded as $k => $v) {
                $val = formTplScalarize($v);
                if ($val !== '') {
                    $out[(string) $k] = $val;
                }
            }
        }
    }
    return $out;
}

function formTplLookupAnswer(array $answers, string $want): string
{
    $want = trim($want);
    if ($want === '') {
        return '';
    }
    if (isset($answers[$want]) && trim((string) $answers[$want]) !== '') {
        return trim((string) $answers[$want]);
    }
    $n = formTplNormalizeKey($want);
    $g = formTplGroup($want);
    foreach ($answers as $k => $v) {
        $val = trim((string) $v);
        if ($val === '') {
            continue;
        }
        if (formTplNormalizeKey((string) $k) === $n) {
            return $val;
        }
        if ($g !== '' && formTplGroup((string) $k) === $g) {
            return $val;
        }
    }
    return '';
}

function formTplFormatIfDate(string $value): string
{
    $v = trim($value);
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $v, $m)) {
        $ts = strtotime($v);
        if ($ts !== false) {
            return date('d M Y', $ts);
        }
    }
    return $v;
}

/**
 * @param list<array<string,mixed>> $placeholders
 * @param array<string,mixed>|list<mixed> $savedMap
 * @param array<string,string> $base
 * @return array<string,string>
 */
function formTplFillDocumentVars(array $lead, array $formRow, array $placeholders, $savedMap, array $base, array $defaults = []): array
{
    $answers = formTplParseLeadAnswers($lead);
    $fields = formTplFormFieldOptions($formRow);
    foreach ($fields as $f) {
        $id = trim((string) ($f['id'] ?? ''));
        $key = (string) ($f['key'] ?? '');
        if ($id !== '' && $key !== '' && isset($answers[$id]) && ($answers[$key] ?? '') === '') {
            $answers[$key] = $answers[$id];
        }
    }
    $previous = [];
    if (is_array($savedMap)) {
        if (isset($savedMap['mappings']) && is_array($savedMap['mappings'])) {
            $previous = $savedMap['mappings'];
        } elseif (isset($savedMap[0]) || $savedMap === []) {
            $previous = $savedMap;
        }
    }
    $savedKeys = [];
    foreach ($previous as $p) {
        if (!is_array($p)) {
            continue;
        }
        $sk = formTplNormalizeKey((string) ($p['key'] ?? ''));
        if ($sk !== '') {
            $savedKeys[$sk] = true;
        }
    }
    $mappings = formTplMergeMappings($placeholders, $fields, $previous, $defaults);
    $vars = $base;
    foreach ($placeholders as $ph) {
        $key = formTplNormalizeKey((string) ($ph['key'] ?? ''));
        if ($key === '') {
            continue;
        }
        if (!empty($ph['auto']) && in_array($key, ['cert_id', 'certid', 'ref_number'], true)) {
            continue;
        }
        $row = null;
        foreach ($mappings as $m) {
            if (($m['key'] ?? '') === $key) {
                $row = $m;
                break;
            }
        }
        $fieldKey = is_array($row) ? trim((string) ($row['field_key'] ?? '')) : '';
        $savedPrefill = is_array($row) ? trim((string) ($row['prefill'] ?? '')) : '';
        $userPinnedPrefill = isset($savedKeys[$key]) && $fieldKey === '';
        $value = '';
        if ($fieldKey !== '') {
            $value = formTplLookupAnswer($answers, $fieldKey);
        }
        if ($value === '' && !$userPinnedPrefill) {
            $value = formTplLookupAnswer($answers, $key);
        }
        if ($value === '' && $savedPrefill !== '') {
            $value = $savedPrefill;
        }
        if ($value === '') {
            $value = trim((string) ($ph['prefill'] ?? ''));
        }
        if ($value === '' && in_array(formTplGroup($key), ['date'], true)) {
            $value = trim((string) ($base['issue_date'] ?? $base['date'] ?? ''));
        }
        if ($value === '') {
            continue;
        }
        $value = formTplFormatIfDate($value);
        foreach (formTplAliasKeys($key) as $alias) {
            $vars[$alias] = $value;
        }
    }
    return $vars;
}

function formTplParseSavedMap($raw): array
{
    $decoded = formTplDecodeJson($raw);
    if (isset($decoded['mappings']) && is_array($decoded['mappings'])) {
        return $decoded;
    }
    if (is_array($decoded) && ($decoded === [] || isset($decoded[0]))) {
        return ['template_id' => '', 'mappings' => $decoded];
    }
    return ['template_id' => '', 'mappings' => []];
}
