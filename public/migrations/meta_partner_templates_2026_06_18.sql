-- Meta Official Partner + Platform Template Library
-- Master templates pre-aligned with Meta categories for faster org approval

CREATE TABLE IF NOT EXISTS `meta_partner_config` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `partner_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
  `business_verification` VARCHAR(30) NOT NULL DEFAULT 'not_started',
  `meta_app_id` VARCHAR(100) DEFAULT NULL,
  `meta_partner_business_id` VARCHAR(100) DEFAULT NULL,
  `master_waba_id` VARCHAR(100) DEFAULT NULL,
  `system_user_token` VARCHAR(500) DEFAULT NULL,
  `embedded_signup_config_id` VARCHAR(100) DEFAULT NULL,
  `solution_name` VARCHAR(200) NOT NULL DEFAULT 'Syncpedia CRM',
  `partner_contact_email` VARCHAR(200) DEFAULT NULL,
  `onboarding_notes` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_by` CHAR(36) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_template_library` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `slug` VARCHAR(100) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `use_case` VARCHAR(200) DEFAULT NULL,
  `category` VARCHAR(30) NOT NULL DEFAULT 'utility',
  `template_type` VARCHAR(50) NOT NULL DEFAULT 'general',
  `language` VARCHAR(10) NOT NULL DEFAULT 'en',
  `header_type` VARCHAR(20) NOT NULL DEFAULT 'none',
  `header_text` VARCHAR(500) DEFAULT NULL,
  `body` TEXT NOT NULL,
  `footer` VARCHAR(200) DEFAULT NULL,
  `variables` JSON DEFAULT NULL,
  `editable_fields` JSON DEFAULT NULL,
  `meta_partner_preapproved` TINYINT(1) NOT NULL DEFAULT 1,
  `meta_quality_tier` VARCHAR(20) NOT NULL DEFAULT 'high',
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ptl_slug` (`slug`),
  INDEX `idx_ptl_category` (`category`),
  INDEX `idx_ptl_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_message_templates`
  ADD COLUMN `platform_template_id` CHAR(36) DEFAULT NULL,
  ADD COLUMN `application_source` VARCHAR(30) NOT NULL DEFAULT 'custom',
  ADD COLUMN `customization_json` JSON DEFAULT NULL;
