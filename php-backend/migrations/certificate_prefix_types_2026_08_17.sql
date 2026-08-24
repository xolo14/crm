-- Certificate org prefix + 2-letter types + issued ID format AA-CS-XXXXXX
-- Runtime also applies these in cert_ids.php / helpers.php
-- Run each statement separately in phpMyAdmin if your MySQL version
-- does not support ADD COLUMN IF NOT EXISTS.

ALTER TABLE `organizations`
  ADD COLUMN `cert_prefix` CHAR(2) DEFAULT NULL;

-- Unique across orgs; multiple NULLs allowed
CREATE UNIQUE INDEX `uq_org_cert_prefix` ON `organizations` (`cert_prefix`);

ALTER TABLE `certificate_templates`
  MODIFY COLUMN `cert_type` VARCHAR(8) NOT NULL DEFAULT 'CC';

ALTER TABLE `issued_certificates`
  MODIFY COLUMN `cert_type` VARCHAR(8) NOT NULL DEFAULT 'CC',
  MODIFY COLUMN `id` VARCHAR(80) NOT NULL;

UPDATE `certificate_templates` SET `cert_type` = 'ID' WHERE `cert_type` = 'ACH';
UPDATE `certificate_templates` SET `cert_type` = 'LR' WHERE `cert_type` = 'PRO';
UPDATE `certificate_templates` SET `cert_type` = 'IN' WHERE `cert_type` = 'INT';

UPDATE `issued_certificates` SET `cert_type` = 'ID' WHERE `cert_type` = 'ACH';
UPDATE `issued_certificates` SET `cert_type` = 'LR' WHERE `cert_type` = 'PRO';
UPDATE `issued_certificates` SET `cert_type` = 'IN' WHERE `cert_type` = 'INT';
