<?php
/**
 * Mobile location ping — POST only.
 * Body JSON: { "latitude": number, "longitude": number, "timestamp": "ISO8601"|unix }
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = (string) ($tokenData['user_id'] ?? '');

if ($method !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$input = getInput();
if (!is_array($input)) {
    $input = [];
}

if (!array_key_exists('latitude', $input) || !array_key_exists('longitude', $input)) {
    respond(['error' => 'latitude and longitude are required'], 422);
}
if (!is_numeric($input['latitude']) || !is_numeric($input['longitude'])) {
    respond(['error' => 'latitude and longitude must be numeric'], 422);
}

$latitude = round((float) $input['latitude'], 7);
$longitude = round((float) $input['longitude'], 7);
if ($latitude < -90 || $latitude > 90) {
    respond(['error' => 'latitude out of range'], 422);
}
if ($longitude < -180 || $longitude > 180) {
    respond(['error' => 'longitude out of range'], 422);
}

$orgId = resolveWriteOrgId($db, $tokenData);
if ($orgId === null || trim((string) $orgId) === '') {
    respond(['error' => 'Organization context required'], 403);
}
$orgId = (string) $orgId;

$recordedAt = null;
$ts = $input['timestamp'] ?? null;
if ($ts === null || $ts === '') {
    $recordedAt = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d H:i:s');
} elseif (is_numeric($ts)) {
    $sec = (int) $ts;
    // Accept ms timestamps from Android.
    if ($sec > 20000000000) {
        $sec = (int) floor($sec / 1000);
    }
    $recordedAt = (new DateTimeImmutable('@' . $sec))
        ->setTimezone(new DateTimeZone('Asia/Kolkata'))
        ->format('Y-m-d H:i:s');
} else {
    try {
        $dt = new DateTimeImmutable(trim((string) $ts));
        $recordedAt = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    } catch (Throwable $e) {
        respond(['error' => 'timestamp must be ISO-8601 or unix seconds'], 422);
    }
}

$id = generateUUID();
try {
    $stmt = $db->prepare(
        'INSERT INTO user_locations (id, user_id, org_id, latitude, longitude, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$id, $userId, $orgId, $latitude, $longitude, $recordedAt]);
} catch (Throwable $e) {
    error_log('[location] insert failed: ' . $e->getMessage());
    respond(['error' => 'Could not save location'], 500);
}

respond(['success' => true], 201);
