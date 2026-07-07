-- Syncpedia CRM — phpMyAdmin / Hostinger MySQL maintenance (safe to re-run)
-- Paste into phpMyAdmin → SQL tab for an existing live database.
-- New installs: import php-backend/database.mysql.sql instead.

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET NAMES utf8mb4;

-- ── Add org_id column on older databases (skip if "Duplicate column" error) ─
ALTER TABLE `tasks` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `created_by`;
ALTER TABLE `activities` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `user_id`;
ALTER TABLE `contacts` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `owner_id`;
ALTER TABLE `deals` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `owner_id`;
ALTER TABLE `daily_reports` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `user_id`;
ALTER TABLE `holidays` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `is_approved`;
ALTER TABLE `notifications` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `user_id`;
ALTER TABLE `courses` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL;
ALTER TABLE `batches` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL;
ALTER TABLE `lead_forms` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `created_by`;
ALTER TABLE `offer_letter_templates` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `created_by`;
ALTER TABLE `offer_letters_sent` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `sent_by`;
ALTER TABLE `certificate_templates` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `created_by`;
ALTER TABLE `issued_certificates` ADD COLUMN `org_id` CHAR(36) DEFAULT NULL AFTER `issued_by`;

-- Optional indexes (ignore "Duplicate key name" if already present)
ALTER TABLE `tasks` ADD INDEX `idx_tasks_org` (`org_id`);
ALTER TABLE `activities` ADD INDEX `idx_activities_org` (`org_id`);
ALTER TABLE `contacts` ADD INDEX `idx_contacts_org` (`org_id`);
ALTER TABLE `deals` ADD INDEX `idx_deals_org` (`org_id`);
ALTER TABLE `daily_reports` ADD INDEX `idx_reports_org` (`org_id`);
ALTER TABLE `holidays` ADD INDEX `idx_holidays_org` (`org_id`);
ALTER TABLE `notifications` ADD INDEX `idx_notif_org` (`org_id`);
ALTER TABLE `courses` ADD INDEX `idx_courses_org` (`org_id`);
ALTER TABLE `batches` ADD INDEX `idx_batches_org` (`org_id`);

-- ── payment_links (Razorpay) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `payment_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `org_id` CHAR(36) DEFAULT NULL,
  `razorpay_payment_link_id` VARCHAR(64) NOT NULL,
  `salesperson_id` CHAR(36) NOT NULL,
  `salesperson_referral_code` VARCHAR(50) NOT NULL DEFAULT '',
  `customer_name` VARCHAR(200) NOT NULL,
  `customer_email` VARCHAR(255) DEFAULT NULL,
  `customer_phone` VARCHAR(30) DEFAULT NULL,
  `amount` BIGINT NOT NULL COMMENT 'paise',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
  `description` VARCHAR(500) DEFAULT NULL,
  `reference_id` VARCHAR(100) DEFAULT NULL,
  `payment_type` ENUM('full','partial') NOT NULL DEFAULT 'full',
  `accept_partial` TINYINT(1) NOT NULL DEFAULT 0,
  `first_min_partial_amount` BIGINT UNSIGNED DEFAULT NULL,
  `status` ENUM('created','partially_paid','paid','cancelled','expired') NOT NULL DEFAULT 'created',
  `amount_paid` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `razorpay_short_url` VARCHAR(500) NOT NULL DEFAULT '',
  `notify_email` TINYINT(1) NOT NULL DEFAULT 0,
  `notify_sms` TINYINT(1) NOT NULL DEFAULT 0,
  `expire_by` DATETIME DEFAULT NULL,
  `reminder_enable` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` JSON DEFAULT NULL,
  `invoice_number` VARCHAR(64) DEFAULT NULL,
  `invoice_sent_at` DATETIME DEFAULT NULL,
  `invoice_sent_for_amount_paid` BIGINT UNSIGNED DEFAULT NULL,
  `invoice_pdf_path` TEXT DEFAULT NULL,
  `enrollment_applied_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pl_rzp_id` (`razorpay_payment_link_id`),
  KEY `idx_pl_salesperson` (`salesperson_id`),
  KEY `idx_pl_org` (`org_id`),
  KEY `idx_pl_status` (`status`),
  KEY `idx_pl_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill org_id on payment links created before CRM persist fix
UPDATE `payment_links` pl
INNER JOIN `users` u ON u.id = pl.salesperson_id
SET pl.org_id = u.org_id
WHERE (pl.org_id IS NULL OR pl.org_id = '')
  AND u.org_id IS NOT NULL;

-- ── lead form assignments (unique upsert key) ─────────────────────────────
CREATE TABLE IF NOT EXISTS `lead_form_assignments` (
  `id` CHAR(36) NOT NULL,
  `form_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `assigned_by` CHAR(36) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_form_member` (`form_id`, `member_id`),
  KEY `idx_lfa_form` (`form_id`),
  KEY `idx_lfa_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── org feature toggles (super admin portal flags) ────────────────────────
CREATE TABLE IF NOT EXISTS `org_features` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `feature` VARCHAR(50) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_feature` (`org_id`, `feature`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── certificate issue artifacts (super admin certificates) ────────────────
CREATE TABLE IF NOT EXISTS `certificate_issue_artifacts` (
  `id` CHAR(36) NOT NULL,
  `recipient_id` CHAR(36) DEFAULT NULL,
  `template_id` CHAR(36) DEFAULT NULL,
  `sync_id` VARCHAR(80) NOT NULL,
  `student_name` VARCHAR(255) DEFAULT NULL,
  `student_email` VARCHAR(255) DEFAULT NULL,
  `course_name` VARCHAR(255) DEFAULT NULL,
  `issue_date` DATE DEFAULT NULL,
  `verify_token` TEXT DEFAULT NULL,
  `pdf_path` TEXT DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `issued_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cert_sync_id` (`sync_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── password reset (forgot password on all login portals) ─────────────────
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token` VARCHAR(128) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_resets_token` (`token`),
  KEY `idx_password_resets_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Backfill org_id on leads/students (org admin visibility) ───────────────
UPDATE `leads` l
INNER JOIN `users` u ON u.id = COALESCE(l.assigned_to, l.created_by)
SET l.org_id = u.org_id
WHERE (l.org_id IS NULL OR l.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `students` s
INNER JOIN `users` u ON u.id = s.mentor_id
SET s.org_id = u.org_id
WHERE (s.org_id IS NULL OR s.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `students` s
INNER JOIN `leads` l ON l.id = s.lead_id
SET s.org_id = l.org_id
WHERE (s.org_id IS NULL OR s.org_id = '')
  AND l.org_id IS NOT NULL;

-- Verify: payment links visible to org admins
-- SELECT razorpay_payment_link_id, org_id, salesperson_id, customer_name, created_at
-- FROM payment_links ORDER BY created_at DESC LIMIT 20;

-- ── Backfill org_id on tenant-scoped modules ───────────────────────────────
UPDATE `holidays` h
INNER JOIN `users` u ON u.id = h.approved_by
SET h.org_id = u.org_id
WHERE (h.org_id IS NULL OR h.org_id = '')
  AND u.org_id IS NOT NULL
  AND h.approved_by IS NOT NULL;

UPDATE `tasks` t
INNER JOIN `users` u ON u.id = COALESCE(t.created_by, t.assigned_to)
SET t.org_id = u.org_id
WHERE (t.org_id IS NULL OR t.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `activities` a
INNER JOIN `users` u ON u.id = a.user_id
SET a.org_id = u.org_id
WHERE (a.org_id IS NULL OR a.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `contacts` c
INNER JOIN `users` u ON u.id = c.owner_id
SET c.org_id = u.org_id
WHERE (c.org_id IS NULL OR c.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `deals` d
INNER JOIN `users` u ON u.id = d.owner_id
SET d.org_id = u.org_id
WHERE (d.org_id IS NULL OR d.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `daily_reports` dr
INNER JOIN `users` u ON u.id = dr.user_id
SET dr.org_id = u.org_id
WHERE (dr.org_id IS NULL OR dr.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `offer_letter_templates` olt
INNER JOIN `users` u ON u.id = olt.created_by
SET olt.org_id = u.org_id
WHERE (olt.org_id IS NULL OR olt.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `offer_letters_sent` ols
INNER JOIN `users` u ON u.id = ols.sent_by
SET ols.org_id = u.org_id
WHERE (ols.org_id IS NULL OR ols.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `certificate_templates` ct
INNER JOIN `users` u ON u.id = ct.created_by
SET ct.org_id = u.org_id
WHERE (ct.org_id IS NULL OR ct.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `issued_certificates` ic
INNER JOIN `users` u ON u.id = ic.issued_by
SET ic.org_id = u.org_id
WHERE (ic.org_id IS NULL OR ic.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `certificate_issue_artifacts` cia
INNER JOIN `users` u ON u.id = cia.issued_by
SET cia.org_id = u.org_id
WHERE (cia.org_id IS NULL OR cia.org_id = '')
  AND u.org_id IS NOT NULL
  AND cia.issued_by IS NOT NULL;

UPDATE `notifications` n
INNER JOIN `users` u ON u.id = n.user_id
SET n.org_id = u.org_id
WHERE (n.org_id IS NULL OR n.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `lead_forms` lf
INNER JOIN `users` u ON u.id = lf.created_by
SET lf.org_id = u.org_id
WHERE (lf.org_id IS NULL OR lf.org_id = '')
  AND u.org_id IS NOT NULL;

UPDATE `courses` c
INNER JOIN `batches` b ON b.course_id = c.id
SET c.org_id = b.org_id
WHERE (c.org_id IS NULL OR c.org_id = '')
  AND b.org_id IS NOT NULL;

UPDATE `batches` b
INNER JOIN `courses` c ON c.id = b.course_id
SET b.org_id = c.org_id
WHERE (b.org_id IS NULL OR b.org_id = '')
  AND c.org_id IS NOT NULL;
