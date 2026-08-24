<?php
/**
 * India calendar catalog.
 * National days are office holidays. Regional festivals are special days until an admin declares a holiday.
 */

/** @return list<array{date:string,name:string,kind:string,notes:string}> */
function syncpediaIndiaNationalHolidays(int $year): array
{
    return [
        ['date' => sprintf('%04d-01-26', $year), 'name' => 'Republic Day', 'kind' => 'national', 'notes' => "India's Constitution came into effect on 26 Jan 1950"],
        ['date' => sprintf('%04d-08-15', $year), 'name' => 'Independence Day', 'kind' => 'national', 'notes' => "India's independence from British rule on 15 Aug 1947"],
        ['date' => sprintf('%04d-10-02', $year), 'name' => 'Mahatma Gandhi Jayanti', 'kind' => 'national', 'notes' => 'Birth anniversary of Mahatma Gandhi, Father of the Nation'],
    ];
}

/**
 * Major regional / religious festivals (special days, not automatic holidays).
 * Lunar dates are listed for known years; other years still get national holidays.
 *
 * @return list<array{date:string,name:string,kind:string,notes:string}>
 */
function syncpediaIndiaRegionalFestivals(int $year): array
{
    $byYear = [
        2026 => [
            ['01-01', "New Year's Day", 'Gregorian new year'],
            ['01-13', 'Bhogi', 'First day of Sankranti — Andhra Pradesh / Telangana'],
            ['01-14', 'Makar Sankranti / Pongal', 'Harvest festival (South & West India)'],
            ['01-15', 'Kanuma', 'Third day of Sankranti — Andhra Pradesh / Telangana'],
            ['01-23', 'Netaji Subhas Chandra Bose Jayanti', 'Observed in several eastern states'],
            ['02-15', 'Maha Shivaratri', 'Hindu festival dedicated to Lord Shiva'],
            ['02-19', 'Chhatrapati Shivaji Maharaj Jayanti', 'Maharashtra'],
            ['03-03', 'Holika Dahan', 'Eve of Holi'],
            ['03-04', 'Holi', 'Festival of colours'],
            ['03-19', 'Ugadi / Gudi Padwa', 'Telugu, Kannada & Marathi New Year'],
            ['03-21', 'Eid ul-Fitr', 'End of Ramadan (tentative, moon sighting)'],
            ['03-26', 'Ram Navami', 'Birth of Lord Rama'],
            ['03-31', 'Mahavir Jayanti', 'Birth of Lord Mahavira'],
            ['04-03', 'Good Friday', 'Christian observance'],
            ['04-05', 'Easter Sunday', 'Christian observance'],
            ['04-14', 'Dr. Ambedkar Jayanti / Vaisakhi / Tamil New Year', 'Multiple regional observances'],
            ['04-15', 'Bohag Bihu / Vishu', 'Assam / Kerala new year & harvest'],
            ['05-01', 'Labour Day / Buddha Purnima', 'Workers’ Day and Buddha Jayanti'],
            ['05-27', 'Eid ul-Adha (Bakrid)', 'Islamic festival of sacrifice (tentative)'],
            ['06-26', 'Muharram', 'Islamic New Year observance (tentative)'],
            ['07-16', 'Rath Yatra', 'Puri / Odisha chariot festival'],
            ['08-15', 'Parsi New Year (Shahenshahi)', 'Observed in Maharashtra / Gujarat (same date as Independence Day)'],
            ['08-26', 'Onam / Milad-un-Nabi', 'Kerala harvest festival; Prophet’s birthday (tentative)'],
            ['08-28', 'Raksha Bandhan', 'Brother–sister festival'],
            ['09-04', 'Janmashtami', 'Birth of Lord Krishna'],
            ['09-14', 'Ganesh Chaturthi', 'Birth of Lord Ganesha'],
            ['10-11', 'Navratri Starts', 'Nine nights of Goddess Durga'],
            ['10-20', 'Dussehra (Vijayadashami)', 'Victory of good over evil'],
            ['10-29', 'Karva Chauth', 'North Indian fast for spouses'],
            ['11-08', 'Diwali', 'Festival of lights'],
            ['11-09', 'Govardhan Puja', 'Day after Diwali'],
            ['11-11', 'Bhai Dooj', 'Brother–sister festival'],
            ['11-15', 'Chhath Puja', 'Sun worship — Bihar, Jharkhand, East UP'],
            ['11-24', 'Guru Nanak Jayanti', 'Birth of Guru Nanak Dev'],
            ['12-24', 'Christmas Eve', 'Christian observance'],
            ['12-25', 'Christmas', 'Birth of Jesus Christ'],
        ],
    ];

    $rows = $byYear[$year] ?? [];
    $out = [];
    $nationalNames = [];
    foreach (syncpediaIndiaNationalHolidays($year) as $n) {
        $nationalNames[strtolower($n['name'])] = true;
    }
    foreach ($rows as $row) {
        [$md, $name, $notes] = $row;
        if (isset($nationalNames[strtolower($name)])) {
            continue;
        }
        // Independence Day and Parsi New Year share 15 Aug — keep Parsi as special day with a distinct name.
        $out[] = [
            'date' => sprintf('%04d-%s', $year, $md),
            'name' => $name,
            'kind' => 'regional',
            'notes' => $notes,
        ];
    }
    return $out;
}

/** @return list<array{date:string,name:string,kind:string,notes:string}> */
function syncpediaIndiaCalendarEvents(int $year): array
{
    return array_merge(
        syncpediaIndiaNationalHolidays($year),
        syncpediaIndiaRegionalFestivals($year)
    );
}

function syncpediaSeedIndiaHolidayCalendar(PDO $db, ?string $orgId, int $year): void
{
    if ($year < 2024 || $year > 2035) {
        return;
    }
    $events = syncpediaIndiaCalendarEvents($year);
    if (!$events) {
        return;
    }

    $hasOrg = false;
    try {
        $db->query('SELECT org_id FROM holidays LIMIT 1');
        $hasOrg = true;
    } catch (Throwable $e) {
        $hasOrg = false;
    }

    $existsSql = $hasOrg && $orgId
        ? 'SELECT id FROM holidays WHERE date = ? AND name = ? AND org_id = ? LIMIT 1'
        : 'SELECT id FROM holidays WHERE date = ? AND name = ? AND (org_id IS NULL OR org_id = \'\') LIMIT 1';
    $exists = $db->prepare($existsSql);

    $insSql = $hasOrg
        ? 'INSERT INTO holidays (id, name, date, type, notes, is_approved, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO holidays (id, name, date, type, notes, is_approved) VALUES (?, ?, ?, ?, ?, ?)';
    $ins = $db->prepare($insSql);

    foreach ($events as $ev) {
        $params = [$ev['date'], $ev['name']];
        if ($hasOrg && $orgId) {
            $params[] = $orgId;
        }
        $exists->execute($params);
        if ($exists->fetchColumn()) {
            continue;
        }
        $isNational = ($ev['kind'] ?? '') === 'national';
        $type = $isNational ? 'national' : 'regional';
        $approved = $isNational ? 1 : 0;
        $id = generateUUID();
        if ($hasOrg) {
            $ins->execute([$id, $ev['name'], $ev['date'], $type, $ev['notes'], $approved, $orgId]);
        } else {
            $ins->execute([$id, $ev['name'], $ev['date'], $type, $ev['notes'], $approved]);
        }
    }
}
