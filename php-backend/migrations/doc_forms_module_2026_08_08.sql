-- Document Forms module: Certificates & Offer Letters forms (separate from lead_forms)
-- Run on MySQL after deploy, or rely on doc-forms.php ensureSchema().

CREATE TABLE IF NOT EXISTS `doc_forms` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `form_type` VARCHAR(32) NOT NULL,
  `fields_json` JSON DEFAULT NULL,
  `meta_json` JSON DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_forms_org_slug` (`org_id`, `slug`),
  INDEX `idx_doc_forms_type` (`form_type`),
  INDEX `idx_doc_forms_org` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `doc_form_access` (
  `id` CHAR(36) NOT NULL,
  `form_id` CHAR(36) NOT NULL,
  `access_type` VARCHAR(16) NOT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `role_key` VARCHAR(64) DEFAULT NULL,
  `assigned_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_dfa_form` (`form_id`),
  INDEX `idx_dfa_user` (`user_id`),
  INDEX `idx_dfa_role` (`role_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `doc_form_template_links` (
  `id` CHAR(36) NOT NULL,
  `form_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `template_kind` VARCHAR(32) NOT NULL,
  `template_id` CHAR(36) NOT NULL,
  `column_maps_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dftl_form` (`form_id`),
  INDEX `idx_dftl_template` (`template_kind`, `template_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `doc_form_submissions` (
  `id` CHAR(36) NOT NULL,
  `form_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `submitted_by` CHAR(36) DEFAULT NULL,
  `respondent_name` VARCHAR(255) DEFAULT NULL,
  `respondent_email` VARCHAR(255) DEFAULT NULL,
  `answers_json` JSON DEFAULT NULL,
  `values_json` JSON DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'submitted',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_dfs_form` (`form_id`),
  INDEX `idx_dfs_status` (`status`),
  INDEX `idx_dfs_org` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `doc_issued_documents` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `doc_kind` VARCHAR(32) NOT NULL,
  `form_id` CHAR(36) DEFAULT NULL,
  `submission_id` CHAR(36) DEFAULT NULL,
  `template_id` CHAR(36) DEFAULT NULL,
  `recipient_name` VARCHAR(255) DEFAULT NULL,
  `recipient_email` VARCHAR(255) DEFAULT NULL,
  `subject` VARCHAR(500) DEFAULT NULL,
  `pdf_path` VARCHAR(500) DEFAULT NULL,
  `pdf_url` VARCHAR(500) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'issued',
  `issued_by` CHAR(36) DEFAULT NULL,
  `issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `meta_json` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_did_kind` (`doc_kind`),
  INDEX `idx_did_org` (`org_id`),
  INDEX `idx_did_form` (`form_id`),
  INDEX `idx_did_submission` (`submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional mail config on offer templates (also ensured in PHP).
-- MySQL 5.7 / older MariaDB: run only if column is missing (IF NOT EXISTS may not work).
-- Prefer checking first in phpMyAdmin:
--   SHOW COLUMNS FROM offer_letter_templates LIKE 'mail_json';
-- If empty, then run:
ALTER TABLE `offer_letter_templates`
  ADD COLUMN `mail_json` JSON DEFAULT NULL;
