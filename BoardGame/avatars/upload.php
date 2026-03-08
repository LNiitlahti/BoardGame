<?php
/**
 * Avatar Upload Endpoint
 *
 * Receives a resized JPEG blob and saves it as avatars/{uid}.jpg
 * Client must send: uid (string) and avatar (file)
 */

error_reporting(E_ALL);
ini_set('display_errors', 0);

header('Content-Type: application/json');

// Allow CORS for local development
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Validate UID
$uid = $_POST['uid'] ?? '';
if (!$uid || !preg_match('/^[a-zA-Z0-9]{10,128}$/', $uid)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid user ID']);
    exit;
}

// Validate file upload
if (!isset($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded or upload error']);
    exit;
}

$file = $_FILES['avatar'];

// Validate file type
if (function_exists('finfo_open')) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
} else {
    // Fallback: check file extension from original name
    $mimeType = $file['type'];
}

if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid file type. Must be JPEG, PNG, or WebP.']);
    exit;
}

// Validate file size (max 500KB — images are already resized client-side)
if ($file['size'] > 500 * 1024) {
    http_response_code(400);
    echo json_encode(['error' => 'File too large. Maximum 500KB.']);
    exit;
}

// Save file
$filename = $uid . '.jpg';
$filepath = __DIR__ . '/' . $filename;

if (!move_uploaded_file($file['tmp_name'], $filepath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save file']);
    exit;
}

// Build public URL
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'];
$basePath = dirname($_SERVER['SCRIPT_NAME']);
$avatarUrl = $protocol . '://' . $host . $basePath . '/' . $filename . '?v=' . time();

echo json_encode([
    'success' => true,
    'avatarUrl' => $avatarUrl
]);
