-- Mobile call sync columns on call_logs + user_locations for Android app
-- Idempotent: safe to re-run in phpMyAdmin (skips existing columns / indexes).

-- device_call_id
SET @db := DATABASE();
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'call_logs' AND COLUMN_NAME = 'device_call_id'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `call_logs` ADD COLUMN `device_call_id` VARCHAR(64) DEFAULT NULL',
  'SELECT ''skip device_call_id'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- latitude
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'call_logs' AND COLUMN_NAME = 'latitude'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `call_logs` ADD COLUMN `latitude` DECIMAL(10,7) DEFAULT NULL',
  'SELECT ''skip latitude'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- longitude
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'call_logs' AND COLUMN_NAME = 'longitude'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `call_logs` ADD COLUMN `longitude` DECIMAL(10,7) DEFAULT NULL',
  'SELECT ''skip longitude'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- synced_at
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'call_logs' AND COLUMN_NAME = 'synced_at'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `call_logs` ADD COLUMN `synced_at` TIMESTAMP NULL DEFAULT NULL',
  'SELECT ''skip synced_at'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- unique (sales_rep_id, device_call_id)
SET @exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'call_logs' AND INDEX_NAME = 'uq_calllog_rep_device'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `call_logs` ADD UNIQUE KEY `uq_calllog_rep_device` (`sales_rep_id`, `device_call_id`)',
  'SELECT ''skip uq_calllog_rep_device'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `user_locations` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `latitude` DECIMAL(10,7) NOT NULL,
  `longitude` DECIMAL(10,7) NOT NULL,
  `recorded_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX (`user_id`),
  INDEX (`org_id`),
  CONSTRAINT `fk_user_locations_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_locations_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
