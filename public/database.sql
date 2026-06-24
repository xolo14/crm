-- Syncpedia CRM - MySQL Database Schema (Multi-Tenant SaaS)
-- Upload this to your Hostinger phpMyAdmin
-- Updated: 2026-05-13 (see migrations/paste_one_shot_2026_05_13.sql for incremental paste on live DBs)

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";

-- --------------------------------------------------------
-- Organizations (Tenants)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(200) NOT NULL,
  `slug` VARCHAR(100) NOT NULL,
  `logo_url` VARCHAR(500) DEFAULT NULL,
  `domain` VARCHAR(255) DEFAULT NULL,
  `owner_id` CHAR(36) DEFAULT NULL,
  `plan` ENUM('free','starter','pro','enterprise') DEFAULT 'starter',
  `max_users` INT DEFAULT 10,
  `industry` VARCHAR(50) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_slug` (`slug`),
  INDEX `idx_org_active` (`is_active`),
  INDEX `idx_org_industry` (`industry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Built-in platform tenant (slug syncpedia). Matches php helpers syncpediaGetOrCreateOrgId().
-- Display name is Syncpedia; owner_id stays NULL until a super_admin creates platform-scoped members (then API sets
-- owner_id to that super_admin so team roster org_admin_email resolves to their mail).
INSERT INTO `organizations` (`id`, `name`, `slug`, `logo_url`, `domain`, `owner_id`, `plan`, `max_users`, `industry`, `is_active`)
SELECT UUID(), 'Syncpedia', 'syncpedia', NULL, NULL, NULL, 'enterprise', 9999, NULL, 1
WHERE NOT EXISTS (
  SELECT 1 FROM `organizations` o WHERE LOWER(TRIM(o.`slug`)) = 'syncpedia'
);

-- --------------------------------------------------------
-- Organization Features (toggleable per tenant)
-- --------------------------------------------------------

-- Feature toggles (enabled=1). Keys used by CRM UI include: leads, certificates,
-- marketing_access, offer_letters, fresher_salary, … Absence of a row = disabled for gated modules.
CREATE TABLE IF NOT EXISTS `org_features` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `org_id` CHAR(36) NOT NULL,
  `feature` VARCHAR(50) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_feature` (`org_id`, `feature`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Users & Authentication
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(100) NOT NULL DEFAULT '',
  `phone` VARCHAR(20) DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `referral_code` VARCHAR(50) DEFAULT NULL,
  `role` ENUM('super_admin','admin','manager','sales_representative','trainer','student','finance','marketing','sales_marketing','hr') NOT NULL DEFAULT 'sales_representative',
  `org_id` CHAR(36) DEFAULT NULL,
  `created_by` CHAR(36) DEFAULT NULL,
  `reports_to_id` CHAR(36) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `fresher_training_join_date` DATE DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referral_code` (`referral_code`),
  INDEX `idx_users_email` (`email`),
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_org` (`org_id`),
  INDEX `idx_users_org_active` (`org_id`, `is_active`),
  INDEX `idx_users_role_org` (`role`, `org_id`),
  INDEX `idx_users_created_by` (`created_by`),
  INDEX `idx_users_reports_to` (`reports_to_id`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auto-generate referral code on insert
DELIMITER $$
CREATE TRIGGER IF NOT EXISTS `trg_users_referral_code`
BEFORE INSERT ON `users`
FOR EACH ROW
BEGIN
  IF NEW.referral_code IS NULL THEN
    SET NEW.referral_code = CONCAT('SP-', SUBSTRING(MD5(UUID()), 1, 8));
  END IF;
END$$
DELIMITER ;

-- --------------------------------------------------------
-- Auth portal membership (one logical bucket per login URL; mirrors users.role)
-- Super Admin / Admin / Manager / Marketing / Sales Rep portals each have their own table.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `auth_portal_super_admin` (
  `user_id` CHAR(36) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_portal_org_admin` (
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  INDEX `idx_auth_org_admin_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_portal_manager` (
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  INDEX `idx_auth_sm_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_portal_marketing` (
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  INDEX `idx_auth_mkt_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_portal_sales_rep` (
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `reports_to_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  INDEX `idx_auth_rep_org` (`org_id`),
  INDEX `idx_auth_rep_reports` (`reports_to_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Portal triggers + backfill run after `marketing_members` exists (see below).

-- --------------------------------------------------------
-- Pipeline Stages
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `pipeline_stages` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(100) NOT NULL,
  `position` INT NOT NULL DEFAULT 0,
  `color` VARCHAR(20) DEFAULT '#6366f1',
  `is_default` TINYINT(1) DEFAULT 0,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_stages_org` (`org_id`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `pipeline_stages` (`id`, `name`, `position`, `color`, `is_default`) VALUES
(UUID(), 'Prospect', 0, '#6366f1', 1),
(UUID(), 'Qualified', 1, '#3b82f6', 0),
(UUID(), 'Proposal', 2, '#f59e0b', 0),
(UUID(), 'Negotiation', 3, '#f97316', 0),
(UUID(), 'Won', 4, '#22c55e', 0),
(UUID(), 'Lost', 5, '#ef4444', 0);

-- --------------------------------------------------------
-- Courses
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `courses` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `duration_weeks` INT DEFAULT NULL,
  `modules` JSON DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_courses_org` (`org_id`),
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Batches
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `batches` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(200) NOT NULL,
  `course_id` CHAR(36) DEFAULT NULL,
  `trainer_id` CHAR(36) DEFAULT NULL,
  `start_date` DATE DEFAULT NULL,
  `end_date` DATE DEFAULT NULL,
  `seat_limit` INT DEFAULT 30,
  `status` VARCHAR(20) DEFAULT 'upcoming',
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_batches_course` (`course_id`),
  INDEX `idx_batches_org` (`org_id`),
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`trainer_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Leads (org_id: JWT / assignee / creator on API create; public forms: lead_forms.org_id then ref rep — see leads.php, public-lead.php)
-- HR module may set created_by (hr.php). resume_path added by leads.php when missing on older DBs.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `leads` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL,
  `college` VARCHAR(200) DEFAULT NULL,
  `year_of_study` VARCHAR(20) DEFAULT NULL,
  `course_interest` VARCHAR(255) DEFAULT NULL,
  `referred_by` VARCHAR(100) DEFAULT NULL,
  `source` ENUM('google_ads','instagram','facebook','youtube','website','google_forms','whatsapp','referral','walkin','college_seminar','other') DEFAULT 'other',
  `status` ENUM('new','contacted','qualified','interested','demo_scheduled','demo_attended','enrolled','lost') DEFAULT 'new',
  `score` INT DEFAULT 0,
  `assigned_to` CHAR(36) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `resume_path` VARCHAR(500) DEFAULT NULL,
  `tags` JSON DEFAULT NULL,
  `next_follow_up` DATETIME DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_leads_status` (`status`),
  INDEX `idx_leads_assigned` (`assigned_to`),
  INDEX `idx_leads_source` (`source`),
  INDEX `idx_leads_referred` (`referred_by`),
  INDEX `idx_leads_org` (`org_id`),
  INDEX `idx_leads_org_status` (`org_id`, `status`),
  INDEX `idx_leads_created_by` (`created_by`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Lead Assignments (bulk assignment tracking)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lead_assignments` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `lead_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_la_lead` (`lead_id`),
  INDEX `idx_la_user` (`user_id`),
  INDEX `idx_la_org` (`org_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Students
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `students` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `college` VARCHAR(200) DEFAULT NULL,
  `year_of_study` VARCHAR(20) DEFAULT NULL,
  `course_id` CHAR(36) DEFAULT NULL,
  `batch_id` CHAR(36) DEFAULT NULL,
  `lead_id` CHAR(36) DEFAULT NULL,
  `mentor_id` CHAR(36) DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `status` VARCHAR(20) DEFAULT 'active',
  `enrollment_date` DATE DEFAULT (CURRENT_DATE),
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_students_course` (`course_id`),
  INDEX `idx_students_batch` (`batch_id`),
  INDEX `idx_students_status` (`status`),
  INDEX `idx_students_org` (`org_id`),
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`mentor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Contacts
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `contacts` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL,
  `position` VARCHAR(100) DEFAULT NULL,
  `lead_id` CHAR(36) DEFAULT NULL,
  `owner_id` CHAR(36) DEFAULT NULL,
  `tags` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_contacts_owner` (`owner_id`),
  INDEX `idx_contacts_org` (`org_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Deals
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `deals` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `title` VARCHAR(200) NOT NULL,
  `value` DECIMAL(12,2) DEFAULT 0,
  `stage_id` CHAR(36) DEFAULT NULL,
  `contact_id` CHAR(36) DEFAULT NULL,
  `owner_id` CHAR(36) DEFAULT NULL,
  `expected_close_date` DATE DEFAULT NULL,
  `probability` INT DEFAULT 50,
  `description` TEXT DEFAULT NULL,
  `status` ENUM('open','won','lost') DEFAULT 'open',
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_deals_stage` (`stage_id`),
  INDEX `idx_deals_owner` (`owner_id`),
  INDEX `idx_deals_status` (`status`),
  INDEX `idx_deals_org` (`org_id`),
  FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Payments (indexes support payment-record date filters; composite helps org + status + paid_date reports)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `payments` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `student_id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) DEFAULT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `payment_type` VARCHAR(50) NOT NULL DEFAULT 'full',
  `payment_method` VARCHAR(50) DEFAULT NULL,
  `status` VARCHAR(20) DEFAULT 'pending',
  `due_date` DATE DEFAULT NULL,
  `paid_date` DATE DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_payments_student` (`student_id`),
  INDEX `idx_payments_batch` (`batch_id`),
  INDEX `idx_payments_status` (`status`),
  INDEX `idx_payments_org` (`org_id`),
  INDEX `idx_payments_created_at` (`created_at`),
  INDEX `idx_payments_paid_date` (`paid_date`),
  INDEX `idx_payments_due_date` (`due_date`),
  INDEX `idx_payments_org_status_paid` (`org_id`, `status`, `paid_date`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Tasks
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `due_date` DATETIME DEFAULT NULL,
  `priority` ENUM('low','medium','high','urgent') DEFAULT 'medium',
  `status` ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
  `assigned_to` CHAR(36) DEFAULT NULL,
  `lead_id` CHAR(36) DEFAULT NULL,
  `contact_id` CHAR(36) DEFAULT NULL,
  `deal_id` CHAR(36) DEFAULT NULL,
  `created_by` CHAR(36) DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_tasks_assigned` (`assigned_to`),
  INDEX `idx_tasks_status` (`status`),
  INDEX `idx_tasks_org` (`org_id`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Activities
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `activities` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `type` VARCHAR(20) NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `lead_id` CHAR(36) DEFAULT NULL,
  `contact_id` CHAR(36) DEFAULT NULL,
  `deal_id` CHAR(36) DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `duration_minutes` INT DEFAULT NULL,
  `occurred_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_activities_user` (`user_id`),
  INDEX `idx_activities_type` (`type`),
  INDEX `idx_activities_org` (`org_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Lead Activities (follow-up tracking)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lead_activities` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `lead_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `scheduled_at` DATETIME DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_lead_act_lead` (`lead_id`),
  INDEX `idx_lead_act_user` (`user_id`),
  INDEX `idx_lead_act_org` (`org_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Daily Reports
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `daily_reports` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) NOT NULL,
  `report_date` DATE NOT NULL,
  `total_calls` INT DEFAULT 0,
  `total_followups` INT DEFAULT 0,
  `total_demos` INT DEFAULT 0,
  `total_conversions` INT DEFAULT 0,
  `new_leads_contacted` INT DEFAULT 0,
  `total_lost` INT NOT NULL DEFAULT 0,
  `lead_updates` JSON DEFAULT NULL,
  `summary` TEXT DEFAULT NULL,
  `challenges` TEXT DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_date` (`user_id`, `report_date`),
  INDEX `idx_reports_user` (`user_id`),
  INDEX `idx_reports_date` (`report_date`),
  INDEX `idx_reports_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Notifications
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT DEFAULT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'info',
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `link` VARCHAR(500) DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_notif_user` (`user_id`),
  INDEX `idx_notif_read` (`is_read`),
  INDEX `idx_notif_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Holidays
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `holidays` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(255) NOT NULL,
  `date` DATE NOT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'public',
  `notes` TEXT DEFAULT NULL,
  `is_approved` TINYINT(1) NOT NULL DEFAULT 0,
  `approved_by` CHAR(36) DEFAULT NULL,
  `approved_at` TIMESTAMP NULL DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_holidays_date` (`date`),
  INDEX `idx_holidays_org` (`org_id`),
  FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Marketing Members
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `marketing_members` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_by` CHAR(36) DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_mm_user` (`user_id`),
  INDEX `idx_mm_org` (`org_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- HR Leads (portal rows; table `hr_leads`)
-- For existing databases: run php-backend/migrations/paste_hr_leads_and_hr_schema_updates.sql
-- (adds missing columns / FKs, backfills org_id). New installs: this CREATE is enough.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `hr_leads` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `hr_id` CHAR(36) NOT NULL,
  `assigned_by` CHAR(36) DEFAULT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `source` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('new','contacted','interested','not_interested','converted','lost') DEFAULT 'new',
  `priority` ENUM('low','medium','high') DEFAULT 'medium',
  `notes` TEXT DEFAULT NULL,
  `resume_path` VARCHAR(500) DEFAULT NULL,
  `follow_up_date` DATE DEFAULT NULL,
  `is_assigned` TINYINT(1) DEFAULT 0,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP DEFAULT NULL,
  INDEX `idx_hr_leads_hr_id` (`hr_id`),
  INDEX `idx_hr_leads_status` (`status`),
  INDEX `idx_hr_leads_is_assigned` (`is_assigned`),
  INDEX `idx_hr_leads_created_at` (`created_at`),
  INDEX `idx_hr_leads_org_id` (`org_id`),
  FOREIGN KEY (`hr_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_hr_leads_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Auth portal: triggers (after marketing_members) + backfill
-- Marketing portal = role marketing OR row in marketing_members (matches PHP login).
-- --------------------------------------------------------

DELIMITER $$
CREATE TRIGGER IF NOT EXISTS `trg_users_auth_portal_after_insert`
AFTER INSERT ON `users`
FOR EACH ROW
BEGIN
  IF NEW.`role` = 'super_admin' THEN
    INSERT INTO `auth_portal_super_admin` (`user_id`) VALUES (NEW.`id`);
  END IF;
  IF NEW.`role` = 'admin' THEN
    INSERT INTO `auth_portal_org_admin` (`user_id`, `org_id`) VALUES (NEW.`id`, CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END);
  END IF;
  IF NEW.`role` = 'manager' THEN
    INSERT INTO `auth_portal_manager` (`user_id`, `org_id`) VALUES (NEW.`id`, CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END);
  END IF;
  IF NEW.`role` = 'marketing'
     OR EXISTS (SELECT 1 FROM `marketing_members` mm WHERE mm.`user_id` = NEW.`id` LIMIT 1)
     OR EXISTS (SELECT 1 FROM `marketing_members` mm WHERE LOWER(TRIM(mm.`email`)) = LOWER(TRIM(NEW.`email`)) LIMIT 1) THEN
    INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`) VALUES (
      NEW.`id`,
      COALESCE(
        (SELECT IF(o.`id` IS NOT NULL, mm.`org_id`, NULL) FROM `marketing_members` mm LEFT JOIN `organizations` o ON o.`id` = mm.`org_id` WHERE mm.`user_id` = NEW.`id` ORDER BY mm.`created_at` DESC LIMIT 1),
        (SELECT IF(o.`id` IS NOT NULL, mm.`org_id`, NULL) FROM `marketing_members` mm LEFT JOIN `organizations` o ON o.`id` = mm.`org_id` WHERE LOWER(TRIM(mm.`email`)) = LOWER(TRIM(NEW.`email`)) ORDER BY mm.`created_at` DESC LIMIT 1),
        CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END
      )
    )
    ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
  END IF;
  IF NEW.`role` = 'sales_representative' THEN
    INSERT INTO `auth_portal_sales_rep` (`user_id`, `org_id`, `reports_to_id`) VALUES (
      NEW.`id`,
      CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END,
      NEW.`reports_to_id`
    );
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS `trg_users_auth_portal_after_update`
AFTER UPDATE ON `users`
FOR EACH ROW
BEGIN
  DELETE FROM `auth_portal_super_admin` WHERE `user_id` = NEW.`id`;
  DELETE FROM `auth_portal_org_admin` WHERE `user_id` = NEW.`id`;
  DELETE FROM `auth_portal_manager` WHERE `user_id` = NEW.`id`;
  DELETE FROM `auth_portal_marketing` WHERE `user_id` = NEW.`id`;
  DELETE FROM `auth_portal_sales_rep` WHERE `user_id` = NEW.`id`;
  IF NEW.`role` = 'super_admin' THEN
    INSERT INTO `auth_portal_super_admin` (`user_id`) VALUES (NEW.`id`);
  END IF;
  IF NEW.`role` = 'admin' THEN
    INSERT INTO `auth_portal_org_admin` (`user_id`, `org_id`) VALUES (NEW.`id`, CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END);
  END IF;
  IF NEW.`role` = 'manager' THEN
    INSERT INTO `auth_portal_manager` (`user_id`, `org_id`) VALUES (NEW.`id`, CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END);
  END IF;
  IF NEW.`role` = 'marketing'
     OR EXISTS (SELECT 1 FROM `marketing_members` mm WHERE mm.`user_id` = NEW.`id` LIMIT 1)
     OR EXISTS (SELECT 1 FROM `marketing_members` mm WHERE LOWER(TRIM(mm.`email`)) = LOWER(TRIM(NEW.`email`)) LIMIT 1) THEN
    INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`) VALUES (
      NEW.`id`,
      COALESCE(
        (SELECT IF(o.`id` IS NOT NULL, mm.`org_id`, NULL) FROM `marketing_members` mm LEFT JOIN `organizations` o ON o.`id` = mm.`org_id` WHERE mm.`user_id` = NEW.`id` ORDER BY mm.`created_at` DESC LIMIT 1),
        (SELECT IF(o.`id` IS NOT NULL, mm.`org_id`, NULL) FROM `marketing_members` mm LEFT JOIN `organizations` o ON o.`id` = mm.`org_id` WHERE LOWER(TRIM(mm.`email`)) = LOWER(TRIM(NEW.`email`)) ORDER BY mm.`created_at` DESC LIMIT 1),
        CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END
      )
    )
    ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
  END IF;
  IF NEW.`role` = 'sales_representative' THEN
    INSERT INTO `auth_portal_sales_rep` (`user_id`, `org_id`, `reports_to_id`) VALUES (
      NEW.`id`,
      CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END,
      NEW.`reports_to_id`
    );
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS `trg_marketing_members_auth_portal_ins`
AFTER INSERT ON `marketing_members`
FOR EACH ROW
BEGIN
  INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`) VALUES (
    NEW.`user_id`,
    CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END
  )
  ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
END$$

CREATE TRIGGER IF NOT EXISTS `trg_marketing_members_auth_portal_upd`
AFTER UPDATE ON `marketing_members`
FOR EACH ROW
BEGIN
  INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`) VALUES (
    NEW.`user_id`,
    CASE WHEN NEW.`org_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `organizations` o WHERE o.`id` = NEW.`org_id`) THEN NEW.`org_id` ELSE NULL END
  )
  ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
END$$

CREATE TRIGGER IF NOT EXISTS `trg_marketing_members_auth_portal_del`
AFTER DELETE ON `marketing_members`
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM `marketing_members` mm WHERE mm.`user_id` = OLD.`user_id`)
     AND NOT EXISTS (SELECT 1 FROM `marketing_members` mm INNER JOIN `users` u ON u.`id` = OLD.`user_id` AND LOWER(TRIM(mm.`email`)) = LOWER(TRIM(u.`email`)))
     AND (SELECT u2.`role` FROM `users` u2 WHERE u2.`id` = OLD.`user_id` LIMIT 1) <> 'marketing' THEN
    DELETE FROM `auth_portal_marketing` WHERE `user_id` = OLD.`user_id`;
  END IF;
END$$
DELIMITER ;

INSERT INTO `auth_portal_super_admin` (`user_id`) SELECT `id` FROM `users` WHERE `role` = 'super_admin'
ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`);
INSERT INTO `auth_portal_org_admin` (`user_id`, `org_id`)
SELECT u.`id`, IF(o.`id` IS NOT NULL, u.`org_id`, NULL) FROM `users` u LEFT JOIN `organizations` o ON o.`id` = u.`org_id` WHERE u.`role` = 'admin'
ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
INSERT INTO `auth_portal_manager` (`user_id`, `org_id`)
SELECT u.`id`, IF(o.`id` IS NOT NULL, u.`org_id`, NULL) FROM `users` u LEFT JOIN `organizations` o ON o.`id` = u.`org_id` WHERE u.`role` = 'manager'
ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`)
SELECT u.`id`, IF(o.`id` IS NOT NULL, u.`org_id`, NULL) FROM `users` u LEFT JOIN `organizations` o ON o.`id` = u.`org_id` WHERE u.`role` = 'marketing'
ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
INSERT INTO `auth_portal_marketing` (`user_id`, `org_id`)
SELECT mm.`user_id`, IF(o.`id` IS NOT NULL, mm.`org_id`, NULL)
FROM `marketing_members` mm
LEFT JOIN `organizations` o ON o.`id` = mm.`org_id`
ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`);
INSERT INTO `auth_portal_sales_rep` (`user_id`, `org_id`, `reports_to_id`)
SELECT u.`id`, IF(o.`id` IS NOT NULL, u.`org_id`, NULL), u.`reports_to_id` FROM `users` u LEFT JOIN `organizations` o ON o.`id` = u.`org_id` WHERE u.`role` = 'sales_representative'
ON DUPLICATE KEY UPDATE `org_id` = VALUES(`org_id`), `reports_to_id` = VALUES(`reports_to_id`);

-- --------------------------------------------------------
-- Email Drafts
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `email_drafts` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(200) NOT NULL DEFAULT '',
  `subject` VARCHAR(500) NOT NULL DEFAULT '',
  `html_body` LONGTEXT NOT NULL DEFAULT '',
  `plain_text` TEXT DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ed_created_by` (`created_by`),
  INDEX `idx_ed_org` (`org_id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Email Campaigns
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `email_campaigns` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `subject` VARCHAR(500) NOT NULL,
  `draft_id` CHAR(36) DEFAULT NULL,
  `recipient_count` INT NOT NULL DEFAULT 0,
  `sent_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `pending_count` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ec_draft` (`draft_id`),
  INDEX `idx_ec_org` (`org_id`),
  FOREIGN KEY (`draft_id`) REFERENCES `email_drafts`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Email Sends
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `email_sends` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `campaign_id` CHAR(36) NOT NULL,
  `recipient_email` VARCHAR(255) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_es_campaign` (`campaign_id`),
  FOREIGN KEY (`campaign_id`) REFERENCES `email_campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- WhatsApp Drafts
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `whatsapp_drafts` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(200) NOT NULL DEFAULT '',
  `subject` VARCHAR(500) NOT NULL DEFAULT '',
  `body` LONGTEXT NOT NULL DEFAULT '',
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_wd_created_by` (`created_by`),
  INDEX `idx_wd_org` (`org_id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- WhatsApp Campaigns
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `whatsapp_campaigns` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `subject` VARCHAR(500) NOT NULL,
  `draft_id` CHAR(36) DEFAULT NULL,
  `recipient_count` INT NOT NULL DEFAULT 0,
  `sent_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `pending_count` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_wc_draft` (`draft_id`),
  INDEX `idx_wc_org` (`org_id`),
  FOREIGN KEY (`draft_id`) REFERENCES `whatsapp_drafts`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- WhatsApp Sends
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `whatsapp_sends` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `campaign_id` CHAR(36) NOT NULL,
  `recipient_phone` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ws_campaign` (`campaign_id`),
  FOREIGN KEY (`campaign_id`) REFERENCES `whatsapp_campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Offer Letter Templates
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `offer_letter_templates` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `template_name` VARCHAR(255) NOT NULL,
  `role_title` VARCHAR(200) NOT NULL,
  `html_content` LONGTEXT NOT NULL DEFAULT '',
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_olt_created_by` (`created_by`),
  INDEX `idx_olt_org` (`org_id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Offer Letters Sent
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `offer_letters_sent` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `template_id` CHAR(36) DEFAULT NULL,
  `recipient_name` VARCHAR(200) NOT NULL,
  `recipient_email` VARCHAR(255) NOT NULL,
  `role_title` VARCHAR(200) NOT NULL,
  `html_content` LONGTEXT NOT NULL,
  `pdf_url` VARCHAR(500) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'sent',
  `sent_by` CHAR(36) NOT NULL,
  `sent_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ols_template` (`template_id`),
  INDEX `idx_ols_sent_by` (`sent_by`),
  INDEX `idx_ols_org` (`org_id`),
  FOREIGN KEY (`template_id`) REFERENCES `offer_letter_templates`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Certificate Templates
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `certificate_templates` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(255) NOT NULL,
  `status` ENUM('active','draft','archived') NOT NULL DEFAULT 'draft',
  `cert_type` ENUM('CC','ACH','PRO','INT','WS') NOT NULL DEFAULT 'CC',
  `layout_style` ENUM('classic','dark-pro','elegant') NOT NULL DEFAULT 'classic',
  `bg_color` VARCHAR(20) NOT NULL DEFAULT '#ffffff',
  `accent_color` VARCHAR(20) NOT NULL DEFAULT '#1A6B3C',
  `style_json` JSON DEFAULT NULL,
  `fields_json` JSON NOT NULL,
  `layers_json` JSON DEFAULT NULL,
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_cert_templates_created_by` (`created_by`),
  INDEX `idx_cert_templates_org` (`org_id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Issued Certificates
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `issued_certificates` (
  `id` CHAR(36) NOT NULL,
  `template_id` CHAR(36) NOT NULL,
  `template_name` VARCHAR(255) NOT NULL,
  `recipient_name` VARCHAR(200) NOT NULL,
  `course_name` VARCHAR(255) NOT NULL,
  `cert_type` ENUM('CC','ACH','PRO','INT','WS') NOT NULL DEFAULT 'CC',
  `issue_date` DATE NOT NULL,
  `status` ENUM('issued','revoked','expired') NOT NULL DEFAULT 'issued',
  `verify_token` TEXT DEFAULT NULL,
  `issued_by` CHAR(36) DEFAULT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_issued_certificates_template` (`template_id`),
  INDEX `idx_issued_certificates_status` (`status`),
  INDEX `idx_issued_certificates_org` (`org_id`),
  FOREIGN KEY (`template_id`) REFERENCES `certificate_templates`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Form Management
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lead_forms` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `fields_json` JSON DEFAULT NULL,
  `meta_json` JSON DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lead_forms_slug_org` (`slug`, `org_id`),
  KEY `idx_lead_forms_org` (`org_id`),
  KEY `idx_lead_forms_active` (`is_active`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lead_form_assignments` (
  `id` CHAR(36) NOT NULL,
  `form_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `assigned_by` CHAR(36) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_form_member` (`form_id`, `member_id`),
  KEY `idx_lfa_form` (`form_id`),
  KEY `idx_lfa_member` (`member_id`),
  FOREIGN KEY (`form_id`) REFERENCES `lead_forms`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Password reset tokens (forgot password)
-- --------------------------------------------------------

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

-- --------------------------------------------------------
-- Profiles View
-- --------------------------------------------------------

CREATE VIEW IF NOT EXISTS `profiles` AS
SELECT id, id AS user_id, full_name, email, phone, avatar_url, referral_code, org_id, created_at, updated_at
FROM users;

-- Lv4 organization admins only (role admin); aligns with Team flat admin list / GET team payload rows filtered client-side.
CREATE OR REPLACE VIEW `v_lv4_organization_admins` AS
SELECT
  u.`id`,
  u.`email`,
  u.`full_name`,
  u.`phone`,
  u.`avatar_url`,
  u.`referral_code`,
  u.`role`,
  u.`is_active`,
  u.`created_at`,
  u.`created_by`,
  u.`org_id`,
  u.`reports_to_id`,
  tl.`full_name` AS `reports_to_name`,
  CASE
    WHEN LOWER(TRIM(u.`role`)) = 'super_admin' AND (o.`name` IS NULL OR TRIM(o.`name`) = '') THEN 'Syncpedia'
    ELSE o.`name`
  END AS `org_name`,
  adm.`full_name` AS `org_admin_name`,
  adm.`email` AS `org_admin_email`
FROM `users` u
LEFT JOIN `users` tl ON u.`reports_to_id` = tl.`id`
LEFT JOIN `organizations` o ON u.`org_id` = o.`id`
LEFT JOIN `users` adm ON o.`owner_id` = adm.`id`
WHERE LOWER(TRIM(u.`role`)) = 'admin';

-- --------------------------------------------------------
-- Trash (soft-delete archive; purged after ~30 days via trash.php)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `trash_items` (
  `id` CHAR(36) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` CHAR(36) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `deleted_by` CHAR(36) DEFAULT NULL,
  `deleted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trash_entity` (`entity_type`, `entity_id`),
  KEY `idx_trash_org_deleted` (`org_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Sales call logs (rep activity)
-- FK types match this schema: users.id / organizations.id / leads.id = CHAR(36)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `call_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `sales_rep_id` CHAR(36) NOT NULL COMMENT 'FK users.id',
  `org_id` CHAR(36) NOT NULL COMMENT 'FK organizations.id',
  `lead_id` CHAR(36) DEFAULT NULL COMMENT 'FK leads.id, optional',
  `call_type` ENUM('incoming','outgoing','missed','rejected') NOT NULL,
  `call_status` ENUM('connected','never_attended','not_pickup_by_client') NOT NULL DEFAULT 'connected',
  `duration_seconds` INT NOT NULL DEFAULT 0,
  `client_phone` VARCHAR(20) DEFAULT NULL,
  `client_name` VARCHAR(255) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `attachment_path` VARCHAR(500) DEFAULT NULL,
  `call_date` DATE NOT NULL,
  `call_time` TIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_calllog_rep_id` (`sales_rep_id`),
  INDEX `idx_calllog_date` (`call_date`),
  INDEX `idx_calllog_org` (`org_id`),
  INDEX `idx_calllog_type` (`call_type`),
  INDEX `idx_calllog_rep_date` (`sales_rep_id`, `call_date`),
  INDEX `idx_calllog_org_date` (`org_id`, `call_date`),
  CONSTRAINT `fk_calllog_rep` FOREIGN KEY (`sales_rep_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_calllog_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_calllog_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Razorpay Payment Links (CRM-generated links; webhook: razorpay_webhook.php)
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
  `first_min_partial_amount` BIGINT UNSIGNED DEFAULT NULL COMMENT 'paise',
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
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pl_rzp_id` (`razorpay_payment_link_id`),
  KEY `idx_pl_salesperson` (`salesperson_id`),
  KEY `idx_pl_org` (`org_id`),
  KEY `idx_pl_status` (`status`),
  KEY `idx_pl_created` (`created_at`),
  KEY `idx_pl_invoice_number` (`invoice_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sales Fresher Salary Tracker (JSON payload per member; org-scoped like other CRM data)
CREATE TABLE IF NOT EXISTS `fresher_salary_members` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `payload` LONGTEXT NOT NULL,
  `created_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fsm_org` (`org_id`),
  KEY `idx_fsm_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
