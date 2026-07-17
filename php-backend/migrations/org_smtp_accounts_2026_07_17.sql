CREATE TABLE IF NOT EXISTS org_smtp_accounts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    org_id CHAR(36) NOT NULL,
    slot TINYINT UNSIGNED NOT NULL,
    label VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    from_name VARCHAR(150) NOT NULL DEFAULT '',
    secret_ciphertext TEXT NOT NULL,
    secret_nonce VARCHAR(64) NOT NULL,
    secret_tag VARCHAR(64) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_tested_at DATETIME NULL,
    last_test_status VARCHAR(20) NULL,
    last_error VARCHAR(500) NULL,
    created_by CHAR(36) NULL,
    updated_by CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_smtp_slot (org_id, slot),
    UNIQUE KEY uq_org_smtp_email (org_id, email),
    KEY idx_org_smtp_active (org_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_email_routes (
    id CHAR(36) NOT NULL PRIMARY KEY,
    org_id CHAR(36) NOT NULL,
    category VARCHAR(50) NOT NULL,
    smtp_account_id CHAR(36) NOT NULL,
    updated_by CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_email_route (org_id, category),
    KEY idx_org_email_route_account (org_id, smtp_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
