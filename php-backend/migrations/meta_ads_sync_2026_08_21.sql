-- Meta Ads Marketing API sync (campaigns / daily insights)
-- Idempotent where practical. Safe to re-run; ignore duplicate errors.

CREATE TABLE IF NOT EXISTS `meta_ads_connections` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `meta_user_id` VARCHAR(64) DEFAULT NULL,
  `meta_user_name` VARCHAR(255) DEFAULT NULL,
  `token_ciphertext` TEXT NOT NULL,
  `token_nonce` VARCHAR(64) NOT NULL,
  `token_tag` VARCHAR(64) NOT NULL,
  `token_expires_at` DATETIME DEFAULT NULL,
  `scopes` VARCHAR(500) DEFAULT NULL,
  `status` ENUM('active','expired','revoked','error') NOT NULL DEFAULT 'active',
  `last_error` TEXT DEFAULT NULL,
  `connected_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_meta_conn_org` (`org_id`),
  INDEX `idx_meta_conn_status` (`status`),
  CONSTRAINT `fk_meta_conn_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `meta_ads_accounts` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `connection_id` CHAR(36) NOT NULL,
  `ad_account_id` VARCHAR(64) NOT NULL COMMENT 'act_XXXXXXXX',
  `account_name` VARCHAR(255) DEFAULT NULL,
  `currency` VARCHAR(8) DEFAULT NULL,
  `timezone_name` VARCHAR(64) DEFAULT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `last_synced_at` DATETIME DEFAULT NULL,
  `last_sync_error` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meta_acct_org_act` (`org_id`, `ad_account_id`),
  INDEX `idx_meta_acct_conn` (`connection_id`),
  INDEX `idx_meta_acct_enabled` (`is_enabled`),
  CONSTRAINT `fk_meta_acct_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_meta_acct_conn` FOREIGN KEY (`connection_id`) REFERENCES `meta_ads_connections`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `meta_ads_campaign_insights` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `ad_account_id` VARCHAR(64) NOT NULL,
  `campaign_id` VARCHAR(64) NOT NULL,
  `campaign_name` VARCHAR(500) DEFAULT NULL,
  `insight_date` DATE NOT NULL,
  `spend` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `impressions` BIGINT NOT NULL DEFAULT 0,
  `clicks` BIGINT NOT NULL DEFAULT 0,
  `ctr` DECIMAL(12,6) NOT NULL DEFAULT 0,
  `cpc` DECIMAL(14,6) NOT NULL DEFAULT 0,
  `conversions` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `conversion_value` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `roas` DECIMAL(14,6) NOT NULL DEFAULT 0,
  `currency` VARCHAR(8) DEFAULT NULL,
  `raw_json` LONGTEXT DEFAULT NULL,
  `synced_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meta_insight_day` (`org_id`, `ad_account_id`, `campaign_id`, `insight_date`),
  INDEX `idx_meta_insight_org_date` (`org_id`, `insight_date`),
  INDEX `idx_meta_insight_campaign` (`campaign_id`),
  CONSTRAINT `fk_meta_insight_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `meta_ads_oauth_states` (
  `state` CHAR(64) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`state`),
  INDEX `idx_meta_oauth_exp` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
