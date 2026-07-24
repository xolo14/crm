-- Performance + logic-integrity indexes (Jul 18–20, 2026)
-- Run once in phpMyAdmin. If an index already exists, MySQL reports
-- "Duplicate key name" for that statement — safe to ignore and continue.

-- Leads list is `WHERE org_id = ? ... ORDER BY created_at DESC` — without this
-- index MySQL filesorts the whole org's leads on every page load.
ALTER TABLE leads ADD INDEX idx_leads_org_created (org_id, created_at);

-- Super-admin master view lists without an org filter; dashboards also sort by created_at.
ALTER TABLE leads ADD INDEX idx_leads_created (created_at);

-- Assigned-leads views for L1 members sort their own leads by recency.
ALTER TABLE leads ADD INDEX idx_leads_assigned_created (assigned_to, created_at);

-- Remove duplicate assignment rows (keep oldest id) then enforce one row per lead+user.
DELETE la1 FROM lead_assignments la1
INNER JOIN lead_assignments la2
  ON la1.lead_id = la2.lead_id
 AND la1.user_id = la2.user_id
 AND la1.id > la2.id;

ALTER TABLE lead_assignments




  ADD UNIQUE INDEX uq_lead_assignments_lead_user (lead_id, user_id);

-- Optional: payment_links.reconcile_needed is also auto-added by the PHP API
-- on first payment-links request (ALTER TABLE). Manual add if preferred:
-- ALTER TABLE payment_links ADD COLUMN reconcile_needed TINYINT(1) NOT NULL DEFAULT 0;
