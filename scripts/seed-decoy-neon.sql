-- DECOY-ONLY seed for Neon SQL Editor
-- Paste & run in Neon Console → SQL Editor
-- Creates schema + 2 admins + 20,000 fake leads
--
-- Login (after deploy):
--   ops.admin@legacycrm.local   /  DecoyAdmin1!
--   crm.legacy@legacycrm.local  /  DecoyAdmin2!

BEGIN;

CREATE TABLE IF NOT EXISTS decoy_users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_decoy_users_email ON decoy_users (email);

CREATE TABLE IF NOT EXISTS decoy_leads (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'website',
  status VARCHAR(64) NOT NULL DEFAULT 'new',
  company VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_decoy_leads_created ON decoy_leads (created_at);
CREATE INDEX IF NOT EXISTS idx_decoy_leads_status ON decoy_leads (status);
CREATE INDEX IF NOT EXISTS idx_decoy_leads_source ON decoy_leads (source);

DELETE FROM decoy_leads;
DELETE FROM decoy_users;

INSERT INTO decoy_users (id, email, full_name, password_hash, role, is_active) VALUES
(
  'a1111111-1111-4111-8111-111111111111',
  'ops.admin@legacycrm.local',
  'Ops Admin',
  '$2b$10$rpWK9Be3nVxxeyBM3tzxw./XI1Rd/Szb8XaNqKn/.S/Zvxf6ZKdUW',
  'admin',
  TRUE
),
(
  'a2222222-2222-4222-8222-222222222222',
  'crm.legacy@legacycrm.local',
  'Legacy CRM Admin',
  '$2b$10$Jkb8CgnilPKTtlV6JmTRH.vQ8TUse1PNWqiHLK/Vc9QCXdPyRw9Km',
  'admin',
  TRUE
);

INSERT INTO decoy_leads (id, name, email, phone, source, status, company, notes, created_at)
SELECT
  gen_random_uuid()::text,
  first_names[1 + ((i * 7) % 20)] || ' ' || last_names[1 + ((i * 11) % 20)],
  lower(first_names[1 + ((i * 7) % 20)]) || '.' || lower(last_names[1 + ((i * 11) % 20)]) || i::text
    || '@' || domains[1 + ((i * 3) % 5)],
  '9' || lpad((((i * 7919) % 900000000) + 100000000)::text, 9, '0'),
  sources[1 + ((i * 5) % 8)],
  statuses[1 + ((i * 13) % 8)],
  last_names[1 + ((i * 11) % 20)] || ' Solutions',
  'Synthetic decoy lead',
  (NOW() AT TIME ZONE 'Asia/Kolkata')
    - ((i % 730) || ' days')::interval
    - (((i * 17) % 24) || ' hours')::interval
    - (((i * 29) % 60) || ' minutes')::interval
FROM generate_series(1, 20000) AS g(i)
CROSS JOIN LATERAL (
  SELECT
    ARRAY[
      'Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan',
      'Ananya','Aadhya','Aarohi','Diya','Myra','Anika','Sara','Pari','Anvi','Kiara'
    ]::text[] AS first_names,
    ARRAY[
      'Sharma','Patel','Reddy','Nair','Iyer','Gupta','Khan','Singh','Mehta','Joshi',
      'Chopra','Desai','Malhotra','Rao','Verma','Kapoor','Pillai','Banerjee','Das','Kulkarni'
    ]::text[] AS last_names,
    ARRAY['website','google_ads','referral','whatsapp','walkin','college_seminar','facebook','youtube']::text[] AS sources,
    ARRAY['new','contacted','qualified','interested','demo_scheduled','enrolled','lost','not_answered']::text[] AS statuses,
    ARRAY['example.com','mail.test','demo.local','leads.fake','inbox.sample']::text[] AS domains
) AS dict;

COMMIT;

-- Verify:
-- SELECT COUNT(*) FROM decoy_users;   -- expect 2
-- SELECT COUNT(*) FROM decoy_leads;   -- expect 20000
