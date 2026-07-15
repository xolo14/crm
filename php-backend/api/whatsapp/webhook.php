<?php
/**
 * Meta WhatsApp webhook — canonical URL: GET|POST /api/whatsapp/webhook
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../communications_org.php';
require_once __DIR__ . '/../lib/WhatsAppInbox.php';
require_once __DIR__ . '/../lib/WhatsAppWebhookHandler.php';

$db = (new Database())->getConnection();
WhatsAppInbox::ensureTables($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    WhatsAppWebhookHandler::handleGet($db);
}

if ($method === 'POST') {
    WhatsAppWebhookHandler::handlePost($db);
    exit;
}

http_response_code(405);
header('Content-Type: application/json; charset=UTF-8');
echo json_encode(['error' => 'Method not allowed']);
