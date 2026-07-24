-- WhatsApp 24h customer-care window columns (Jul 2026)
-- Safe to re-run: ignore "Duplicate column" / "Duplicate key" errors.

ALTER TABLE wa_conversations
  ADD COLUMN window_open TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE wa_conversations
  ADD COLUMN window_expires_at DATETIME NULL DEFAULT NULL;

ALTER TABLE wa_conversations
  ADD INDEX idx_wa_conv_window (window_open, window_expires_at);

-- Optional one-shot: close any already-expired open windows
UPDATE wa_conversations
SET window_open = 0
WHERE window_open = 1
  AND window_expires_at IS NOT NULL
  AND window_expires_at < NOW();
