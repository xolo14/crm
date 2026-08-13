-- Manual payment submissions with proof + approval workflow
-- Also ensured at runtime by manual-payments.php

CREATE TABLE IF NOT EXISTS `manual_payments` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) DEFAULT NULL,
  `submitted_by` CHAR(36) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
  `payment_method` VARCHAR(80) DEFAULT NULL,
  `customer_name` VARCHAR(200) DEFAULT NULL,
  `customer_email` VARCHAR(255) DEFAULT NULL,
  `customer_phone` VARCHAR(40) DEFAULT NULL,
  `paid_at` DATE DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `proof_path` VARCHAR(500) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` CHAR(36) DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_mp_org` (`org_id`),
  INDEX `idx_mp_submitted` (`submitted_by`),
  INDEX `idx_mp_status` (`status`),
  INDEX `idx_mp_org_status` (`org_id`, `status`),
  INDEX `idx_mp_paid_at` (`paid_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
