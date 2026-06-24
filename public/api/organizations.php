<?php
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'];
$userId = $tokenData['user_id'];
$role = $tokenData['role'];

// Only super_admin can manage organizations
if ($method === 'GET') {
    // List all orgs (super_admin) or own org
    if ($role === 'super_admin') {
        $action = $_GET['action'] ?? '';
        
        if ($action === 'stats') {
            try {
                $stmt = $db->query("SELECT 
                    o.id, o.name, o.slug, o.logo_url, o.plan, o.max_users, o.is_active, o.created_at, o.industry,
                    (SELECT COUNT(*) FROM users WHERE org_id = o.id AND is_active = 1) as user_count,
                    (SELECT COUNT(*) FROM leads WHERE org_id = o.id) as leads_count,
                    (SELECT COUNT(*) FROM leads WHERE org_id = o.id AND status = 'enrolled') as converted_count,
                    (SELECT COUNT(*) FROM students WHERE org_id = o.id) as students_count,
                    (SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) FROM payments WHERE org_id = o.id) as revenue
                    FROM organizations o ORDER BY o.created_at DESC");
                respond(['data' => $stmt->fetchAll()]);
            } catch (Exception $e) {
                try {
                    // Backward-compatible fallback for older schemas (e.g. missing industry/revenue columns)
                    $stmt = $db->query("SELECT 
                        o.id, o.name, o.slug, o.logo_url, o.plan, o.max_users, o.is_active, o.created_at, '' as industry,
                        (SELECT COUNT(*) FROM users WHERE org_id = o.id AND is_active = 1) as user_count,
                        (SELECT COUNT(*) FROM leads WHERE org_id = o.id) as leads_count,
                        (SELECT COUNT(*) FROM leads WHERE org_id = o.id AND status = 'enrolled') as converted_count,
                        (SELECT COUNT(*) FROM students WHERE org_id = o.id) as students_count,
                        0 as revenue
                        FROM organizations o ORDER BY o.created_at DESC");
                    respond(['data' => $stmt->fetchAll()]);
                } catch (Exception $e2) {
                    try {
                        // Minimal fallback for very old schemas: return org basics + REAL is_active status.
                        $stmt = $db->query("SELECT o.id, o.name, o.slug, o.plan, o.max_users, o.is_active, o.created_at FROM organizations o ORDER BY o.name ASC");
                        $rows = $stmt->fetchAll();
                        $safe = array_map(function($o) {
                            return [
                                'id' => $o['id'] ?? '',
                                'name' => $o['name'] ?? '',
                                'slug' => $o['slug'] ?? '',
                                'logo_url' => null,
                                'plan' => $o['plan'] ?? 'starter',
                                'max_users' => $o['max_users'] ?? 0,
                                'is_active' => isset($o['is_active']) ? (int)$o['is_active'] : 1,
                                'created_at' => $o['created_at'] ?? null,
                                'industry' => '',
                                'user_count' => 0,
                                'leads_count' => 0,
                                'converted_count' => 0,
                                'students_count' => 0,
                                'revenue' => 0,
                            ];
                        }, $rows ?: []);
                        respond(['data' => $safe]);
                    } catch (Exception $e3) {
                        respond(['data' => []]);
                    }
                }
            }
        }
        
        if ($action === 'features') {
            $orgId = $_GET['org_id'] ?? '';
            if (!$orgId) respond(['error' => 'org_id required'], 400);
            $stmt = $db->prepare("SELECT * FROM org_features WHERE org_id = ?");
            $stmt->execute([$orgId]);
            respond(['data' => $stmt->fetchAll()]);
        }
        
        $stmt = $db->query("SELECT * FROM organizations ORDER BY created_at DESC");
        respond(['data' => $stmt->fetchAll()]);
    }
    
    // Non super_admin: return own org info
    $orgId = $tokenData['org_id'];
    if (!$orgId) respond(['data' => null]);
    $stmt = $db->prepare("SELECT * FROM organizations WHERE id = ?");
    $stmt->execute([$orgId]);
    $org = $stmt->fetch();
    
    // Get features
    $fstmt = $db->prepare("SELECT feature, enabled FROM org_features WHERE org_id = ?");
    $fstmt->execute([$orgId]);
    $features = [];
    foreach ($fstmt->fetchAll() as $f) {
        $features[$f['feature']] = (bool)$f['enabled'];
    }
    $org['features'] = $features;
    
    respond(['data' => $org]);
}

if ($method === 'POST') {
    requireRole($tokenData, ['super_admin']);
    try {
        $input = getInput();

        if (($_GET['action'] ?? '') === 'provision_admin') {
            $orgId = trim($input['org_id'] ?? '');
            $adminEmail = trim($input['admin_email'] ?? '');
            $adminName = trim($input['admin_name'] ?? '');
            $adminPassword = (string)($input['admin_password'] ?? '');
            if (!$orgId || !$adminEmail || !$adminName) {
                respond(['error' => 'org_id, admin_email, and admin_name are required'], 400);
            }
            if (strlen($adminPassword) < 6) {
                respond(['error' => 'Password must be at least 6 characters'], 400);
            }
            $ostmt = $db->prepare("SELECT id FROM organizations WHERE id = ?");
            $ostmt->execute([$orgId]);
            if (!$ostmt->fetch()) {
                respond(['error' => 'Organization not found'], 404);
            }
            $hash = password_hash($adminPassword, PASSWORD_DEFAULT);
            $ustmt = $db->prepare("SELECT id, org_id FROM users WHERE email = ?");
            $ustmt->execute([$adminEmail]);
            $existing = $ustmt->fetch();
            if ($existing) {
                if (($existing['org_id'] ?? '') !== $orgId) {
                    respond(['error' => 'This email is already registered to another organization'], 409);
                }
                $db->prepare("UPDATE users SET full_name = ?, password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?")
                    ->execute([$adminName, $hash, $existing['id']]);
                try {
                    $db->prepare("UPDATE organizations SET owner_id = ? WHERE id = ?")->execute([$existing['id'], $orgId]);
                } catch (Exception $e) {
                }
                respond(['message' => 'Organization admin credentials updated', 'user_id' => $existing['id']]);
            }

            // Each org has at most one admin: update owner/first admin row instead of inserting another.
            $primaryAdminId = null;
            try {
                $ownStmt = $db->prepare("SELECT owner_id FROM organizations WHERE id = ?");
                $ownStmt->execute([$orgId]);
                $orgRow = $ownStmt->fetch();
                $candidateOwner = $orgRow['owner_id'] ?? null;
                if ($candidateOwner) {
                    $chk = $db->prepare("SELECT id FROM users WHERE id = ? AND org_id = ? AND LOWER(TRIM(role)) = 'admin' LIMIT 1");
                    $chk->execute([$candidateOwner, $orgId]);
                    if ($chk->fetch()) {
                        $primaryAdminId = $candidateOwner;
                    }
                }
            } catch (Exception $e) {
            }
            if (!$primaryAdminId) {
                $stmt = $db->prepare("SELECT id FROM users WHERE org_id = ? AND LOWER(TRIM(role)) = 'admin' ORDER BY created_at ASC LIMIT 1");
                $stmt->execute([$orgId]);
                $row = $stmt->fetch();
                if ($row) {
                    $primaryAdminId = $row['id'];
                }
            }

            if ($primaryAdminId) {
                $emailTaken = $db->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
                $emailTaken->execute([$adminEmail, $primaryAdminId]);
                if ($emailTaken->fetch()) {
                    respond(['error' => 'This email is already used by another account'], 409);
                }
                $db->prepare("UPDATE users SET email = ?, full_name = ?, password_hash = ?, role = 'admin', is_active = 1 WHERE id = ? AND org_id = ?")
                    ->execute([$adminEmail, $adminName, $hash, $primaryAdminId, $orgId]);
                try {
                    $db->prepare("UPDATE organizations SET owner_id = ? WHERE id = ?")->execute([$primaryAdminId, $orgId]);
                } catch (Exception $e) {
                }
                respond(['message' => 'Organization admin credentials updated', 'user_id' => $primaryAdminId]);
            }

            $adminId = generateUUID();
            $refCode = strtoupper(substr(str_replace('-', '', $adminId), 0, 8));
            $db->prepare("INSERT INTO users (id, email, password_hash, full_name, role, org_id, referral_code) VALUES (?, ?, ?, ?, 'admin', ?, ?)")
                ->execute([$adminId, $adminEmail, $hash, $adminName, $orgId, $refCode]);
            try {
                $db->prepare("UPDATE organizations SET owner_id = ? WHERE id = ?")->execute([$adminId, $orgId]);
            } catch (Exception $e) {
            }
            respond(['message' => 'Organization admin created', 'user_id' => $adminId], 201);
        }

        if (($_GET['action'] ?? '') === 'sync_platform_sales') {
            $result = migratePlatformSalesToSyncpediaOrg($db, $userId);
            if (!empty($result['success'])) {
                respond($result, 200);
            }
            respond(['error' => $result['error'] ?? 'Migration failed'], 500);
        }
        
        $name = trim($input['name'] ?? '');
        $slug = trim($input['slug'] ?? '');
        if (!$name || !$slug) respond(['error' => 'Name and slug required'], 400);
        
        // Check slug uniqueness
        $stmt = $db->prepare("SELECT id FROM organizations WHERE slug = ?");
        $stmt->execute([$slug]);
        if ($stmt->fetch()) respond(['error' => 'Slug already exists'], 409);

        if ($db->inTransaction()) {
            $db->rollBack();
        }
        $db->beginTransaction();
        
        $orgId = generateUUID();
        $industry = trim($input['industry'] ?? '');
        try {
            $stmt = $db->prepare("INSERT INTO organizations (id, name, slug, logo_url, domain, plan, max_users, industry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $orgId, $name, $slug,
                $input['logo_url'] ?? null,
                $input['domain'] ?? null,
                $input['plan'] ?? 'starter',
                $input['max_users'] ?? 10,
                $industry ?: null,
            ]);
        } catch (Exception $e) {
            // Fallback for older schemas without industry column
            $stmt = $db->prepare("INSERT INTO organizations (id, name, slug, logo_url, domain, plan, max_users) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $orgId, $name, $slug,
                $input['logo_url'] ?? null,
                $input['domain'] ?? null,
                $input['plan'] ?? 'starter',
                $input['max_users'] ?? 10,
            ]);
        }
        
        // Create admin user for this org (optional; controlled by create_admin from UI)
        $createAdmin = !array_key_exists('create_admin', $input) || filter_var($input['create_admin'], FILTER_VALIDATE_BOOLEAN);
        $adminEmail = trim($input['admin_email'] ?? '');
        $adminName = trim($input['admin_name'] ?? '');
        $adminPassword = $input['admin_password'] ?? 'Welcome@123';

        if ($createAdmin && (!$adminEmail || !$adminName)) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            respond(['error' => 'When creating an org admin account, admin name and email are required'], 400);
        }
        
        if ($createAdmin && $adminEmail && $adminName) {
            $adminId = generateUUID();
            $hash = password_hash($adminPassword, PASSWORD_DEFAULT);
            $refCode = strtoupper(substr(str_replace('-', '', $adminId), 0, 8));
            
            $stmt = $db->prepare("INSERT INTO users (id, email, password_hash, full_name, role, org_id, referral_code) VALUES (?, ?, ?, ?, 'admin', ?, ?)");
            $stmt->execute([$adminId, $adminEmail, $hash, $adminName, $orgId, $refCode]);
            
            try {
                $db->prepare("UPDATE organizations SET owner_id = ? WHERE id = ?")->execute([$adminId, $orgId]);
            } catch (Exception $e) {
                // Older schema may not have owner_id; ignore.
            }
        }
        
        // Create features from request (or defaults)
        $inputFeatures = $input['features'] ?? null;
        try {
            $fstmt = $db->prepare("INSERT INTO org_features (id, org_id, feature, enabled) VALUES (?, ?, ?, ?)");
            if ($inputFeatures && is_array($inputFeatures)) {
                foreach ($inputFeatures as $feat => $enabled) {
                    $fstmt->execute([generateUUID(), $orgId, $feat, $enabled ? 1 : 0]);
                }
            } else {
                $defaultFeatures = ['leads', 'contacts', 'deals', 'tasks', 'students', 'courses', 'batches', 'payments', 'reports', 'daily_reports', 'notifications'];
                foreach ($defaultFeatures as $feat) {
                    $fstmt->execute([generateUUID(), $orgId, $feat, 1]);
                }
            }
        } catch (Exception $e) {
            // Fallback for very old schemas without org_id in org_features
            try {
                $fstmt = $db->prepare("INSERT INTO org_features (id, feature, enabled) VALUES (?, ?, ?)");
                if ($inputFeatures && is_array($inputFeatures)) {
                    foreach ($inputFeatures as $feat => $enabled) {
                        $fstmt->execute([generateUUID(), $feat, $enabled ? 1 : 0]);
                    }
                } else {
                    $defaultFeatures = ['leads', 'contacts', 'deals', 'tasks', 'students', 'courses', 'batches', 'payments', 'reports', 'daily_reports', 'notifications'];
                    foreach ($defaultFeatures as $feat) {
                        $fstmt->execute([generateUUID(), $feat, 1]);
                    }
                }
            } catch (Exception $e2) {
                // If feature table shape is incompatible, skip features to keep org creation successful.
            }
        }
        
        // Create default pipeline stages for the org
        $stages = [
            ['Prospect', 0, '#6366f1', 1],
            ['Qualified', 1, '#3b82f6', 0],
            ['Proposal', 2, '#f59e0b', 0],
            ['Negotiation', 3, '#f97316', 0],
            ['Won', 4, '#22c55e', 0],
            ['Lost', 5, '#ef4444', 0],
        ];
        try {
            $sstmt = $db->prepare("INSERT INTO pipeline_stages (id, name, position, color, is_default, org_id) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($stages as $s) {
                $sstmt->execute([generateUUID(), $s[0], $s[1], $s[2], $s[3], $orgId]);
            }
        } catch (Exception $e) {
            // Fallback for old schemas without org_id in pipeline_stages
            try {
                $sstmt = $db->prepare("INSERT INTO pipeline_stages (id, name, position, color, is_default) VALUES (?, ?, ?, ?, ?)");
                foreach ($stages as $s) {
                    $sstmt->execute([generateUUID(), $s[0], $s[1], $s[2], $s[3]]);
                }
            } catch (Exception $e2) {
                // Skip pipeline defaults if schema differs.
            }
        }

        $db->commit();
        respond(['id' => $orgId, 'message' => 'Organization created'], 201);
    } catch (Exception $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Create organization failed: ' . $e->getMessage()], 500);
    }
}

if ($method === 'PUT') {
    requireRole($tokenData, ['super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);
    $input = getInput();
    
    // Update features
    if (!empty($_GET['action']) && $_GET['action'] === 'features') {
        $features = $input['features'] ?? [];
        foreach ($features as $feat => $enabled) {
            $stmt = $db->prepare("INSERT INTO org_features (id, org_id, feature, enabled) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = ?");
            $stmt->execute([generateUUID(), $id, $feat, $enabled ? 1 : 0, $enabled ? 1 : 0]);
        }
        respond(['message' => 'Features updated']);
    }
    
    $fields = [];
    $params = [];
    foreach (['name', 'slug', 'logo_url', 'domain', 'plan', 'max_users', 'is_active'] as $f) {
        if (array_key_exists($f, $input)) {
            $fields[] = "$f = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($fields)) respond(['error' => 'Nothing to update'], 400);
    
    $params[] = $id;
    $stmt = $db->prepare("UPDATE organizations SET " . implode(', ', $fields) . " WHERE id = ?");
    $stmt->execute($params);
    respond(['message' => 'Organization updated']);
}

if ($method === 'DELETE') {
    requireRole($tokenData, ['super_admin']);
    $id = $_GET['id'] ?? '';
    if (!$id) respond(['error' => 'ID required'], 400);
    
    $db->prepare("DELETE FROM organizations WHERE id = ?")->execute([$id]);
    respond(['message' => 'Organization deleted']);
}

respond(['error' => 'Invalid request'], 400);
