-- Lead Management: folders for source cards (org-scoped)
CREATE TABLE IF NOT EXISTS lead_source_folders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_by CHAR(36) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lsf_org (org_id),
  KEY idx_lsf_org_sort (org_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lead_source_folder_cards (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  folder_id CHAR(36) NOT NULL,
  source_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lsfc_org_source (org_id, source_key),
  KEY idx_lsfc_folder (folder_id),
  KEY idx_lsfc_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
