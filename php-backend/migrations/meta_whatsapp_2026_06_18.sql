-- Meta WhatsApp Cloud API columns for platform_whatsapp_config
ALTER TABLE `platform_whatsapp_config`
  ADD COLUMN IF NOT EXISTS `app_secret` VARCHAR(255) DEFAULT NULL AFTER `api_key`,
  ADD COLUMN IF NOT EXISTS `webhook_verify_token` VARCHAR(128) DEFAULT NULL AFTER `webhook_url`,
  ADD COLUMN IF NOT EXISTS `graph_api_version` VARCHAR(10) NOT NULL DEFAULT 'v21.0' AFTER `provider`;

-- Delivery tracking on outbound messages
ALTER TABLE `comm_whatsapp_messages`
  ADD COLUMN IF NOT EXISTS `delivered_at` TIMESTAMP NULL DEFAULT NULL AFTER `sent_at`,
  ADD COLUMN IF NOT EXISTS `read_at` TIMESTAMP NULL DEFAULT NULL AFTER `delivered_at`;

-- Meta sync status on CRM templates
ALTER TABLE `whatsapp_message_templates`
  ADD COLUMN IF NOT EXISTS `meta_template_id` VARCHAR(100) DEFAULT NULL AFTER `provider_template_id`,
  ADD COLUMN IF NOT EXISTS `meta_status` VARCHAR(30) DEFAULT NULL AFTER `meta_template_id`;
