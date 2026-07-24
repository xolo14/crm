-- Custom questions per assessment (keeps Peaklyy domain bank intact)
ALTER TABLE peaklyy_assessments
  ADD COLUMN IF NOT EXISTS source_mode VARCHAR(20) NOT NULL DEFAULT 'domain_bank'
    COMMENT 'domain_bank | custom' AFTER question_count;

CREATE TABLE IF NOT EXISTS peaklyy_assessment_questions (
  id CHAR(36) PRIMARY KEY,
  assessment_id CHAR(36) NOT NULL,
  q_type ENUM('mcq','task') NOT NULL DEFAULT 'mcq',
  prompt TEXT NOT NULL,
  options_json JSON NULL,
  correct_option CHAR(1) NULL,
  task_schema_json JSON NULL,
  points INT NOT NULL DEFAULT 5,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_peaklyy_aq_assess (assessment_id, is_active, sort_order),
  CONSTRAINT fk_peaklyy_aq_assess FOREIGN KEY (assessment_id) REFERENCES peaklyy_assessments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
