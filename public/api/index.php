<?php
require_once __DIR__ . '/helpers.php';
cors();

respond([
    'status' => 'ok',
    'message' => 'Syncpedia CRM API',
]);
