-- Communications Hub: shared WhatsApp API, virtual numbers, templates
-- Safe to paste on live DBs (CREATE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS `platform_whatsapp_config` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `provider` VARCHAR(30) NOT NULL DEFAULT 'interakt',
  `api_key` VARCHAR(500) DEFAULT NULL,
  `phone_number_id` VARCHAR(100) DEFAULT NULL,
  `business_phone` VARCHAR(20) DEFAULT NULL,
  `waba_id` VARCHAR(100) DEFAULT NULL,
  `webhook_url` VARCHAR(500) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` CHAR(36) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `org_virtual_numbers` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `org_id` CHAR(36) NOT NULL,
  `phone_number` VARCHAR(20) NOT NULL,
  `label` VARCHAR(100) NOT NULL DEFAULT '',
  `provider` VARCHAR(50) NOT NULL DEFAULT 'exotel',
  `provider_sid` VARCHAR(200) DEFAULT NULL,
  `whatsapp_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `calls_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ovn_org` (`org_id`),
  INDEX `idx_ovn_phone` (`phone_number`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_number_assignments` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `virtual_number_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `assigned_by` CHAR(36) DEFAULT NULL,
  `assigned_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_number` (`virtual_number_id`, `user_id`),
  INDEX `idx_una_user` (`user_id`),
  FOREIGN KEY (`virtual_number_id`) REFERENCES `org_virtual_numbers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `whatsapp_message_templates` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `org_id` CHAR(36) DEFAULT NULL,
  `name` VARCHAR(200) NOT NULL,
  `category` VARCHAR(30) NOT NULL DEFAULT 'marketing',
  `language` VARCHAR(10) NOT NULL DEFAULT 'en',
  `header_type` VARCHAR(20) NOT NULL DEFAULT 'none',
  `header_text` VARCHAR(500) DEFAULT NULL,
  `body` TEXT NOT NULL,
  `footer` VARCHAR(200) DEFAULT NULL,
  `variables` JSON DEFAULT NULL,
  `provider_template_id` VARCHAR(200) DEFAULT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
  `rejection_reason` TEXT DEFAULT NULL,
  `created_by` CHAR(36) NOT NULL,
  `approved_by` CHAR(36) DEFAULT NULL,
  `approved_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_wmt_org` (`org_id`),
  INDEX `idx_wmt_status` (`status`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `comm_whatsapp_messages` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `org_id` CHAR(36) DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `virtual_number_id` CHAR(36) DEFAULT NULL,
  `template_id` CHAR(36) DEFAULT NULL,
  `recipient_phone` VARCHAR(20) NOT NULL,
  `recipient_name` VARCHAR(200) DEFAULT NULL,
  `variables` JSON DEFAULT NULL,
  `message_body` TEXT DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
  `provider_message_id` VARCHAR(200) DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `lead_id` CHAR(36) DEFAULT NULL,
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_cwm_org` (`org_id`),
  INDEX `idx_cwm_user` (`user_id`),
  INDEX `idx_cwm_phone` (`recipient_phone`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`virtual_number_id`) REFERENCES `org_virtual_numbers`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`template_id`) REFERENCES `whatsapp_message_templates`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
