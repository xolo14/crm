-- WhatsApp conversation ownership / assignment (org-shared Meta number)
-- Managers see all org chats; sales/marketing see started_by or assigned_to only.

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS started_by CHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assigned_to CHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assigned_by CHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP NULL DEFAULT NULL;

-- MySQL <8.0.12 may not support IF NOT EXISTS on ADD COLUMN — PHP ensureTables also alters.
CREATE INDEX IF NOT EXISTS idx_wa_conv_started_by ON wa_conversations (org_id, started_by);
CREATE INDEX IF NOT EXISTS idx_wa_conv_assigned_to ON wa_conversations (org_id, assigned_to);
