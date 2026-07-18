-- Performance indexes (Jul 18, 2026)
-- Run once in phpMyAdmin. If an index already exists, MySQL reports
-- "Duplicate key name" for that statement — safe to ignore and continue.

-- Leads list is `WHERE org_id = ? ... ORDER BY created_at DESC` — without this
-- index MySQL filesorts the whole org's leads on every page load.
ALTER TABLE leads ADD INDEX idx_leads_org_created (org_id, created_at);

-- Super-admin master view lists without an org filter; dashboards also sort by created_at.
ALTER TABLE leads ADD INDEX idx_leads_created (created_at);

-- Assigned-leads views for L1 members sort their own leads by recency.
ALTER TABLE leads ADD INDEX idx_leads_assigned_created (assigned_to, created_at);
