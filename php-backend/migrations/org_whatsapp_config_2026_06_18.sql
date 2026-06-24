-- Per-organization Meta WhatsApp API credentials (each org connects their own Meta account)
CREATE TABLE IF NOT EXISTS `org_whatsapp_config` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `org_id` CHAR(36) NOT NULL,
  `provider` VARCHAR(30) NOT NULL DEFAULT 'meta',
  `api_key` VARCHAR(500) DEFAULT NULL,
  `app_secret` VARCHAR(255) DEFAULT NULL,
  `phone_number_id` VARCHAR(100) DEFAULT NULL,
  `business_phone` VARCHAR(20) DEFAULT NULL,
  `waba_id` VARCHAR(100) DEFAULT NULL,
  `webhook_verify_token` VARCHAR(128) DEFAULT NULL,
  `graph_api_version` VARCHAR(10) NOT NULL DEFAULT 'v21.0',
  `connection_status` VARCHAR(30) NOT NULL DEFAULT 'not_connected',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `configured_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_wa_config` (`org_id`),
  INDEX `idx_org_wa_phone_id` (`phone_number_id`),
  INDEX `idx_org_wa_waba` (`waba_id`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
