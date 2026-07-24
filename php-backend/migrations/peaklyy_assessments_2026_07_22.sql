-- Peaklyy domain screening assessments (Super Admin)
CREATE TABLE IF NOT EXISTS peaklyy_assessments (
  id CHAR(36) PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL DEFAULT 'Communication and Sales Aptitude Test',
  brand_name VARCHAR(120) NOT NULL DEFAULT 'PEAKLYY',
  brand_tagline VARCHAR(255) NOT NULL DEFAULT 'Learn · Earn · Grow',
  duration_minutes INT NOT NULL DEFAULT 30,
  question_count INT NOT NULL DEFAULT 20,
  pass_score INT NOT NULL DEFAULT 70,
  once_per_candidate TINYINT(1) NOT NULL DEFAULT 1,
  anti_cheat TINYINT(1) NOT NULL DEFAULT 1,
  result_webhook_url VARCHAR(500) NULL,
  result_api_key VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_peaklyy_assess_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS peaklyy_question_bank (
  id CHAR(36) PRIMARY KEY,
  domain_key VARCHAR(40) NOT NULL,
  level_key VARCHAR(20) NOT NULL,
  q_type ENUM('mcq','task') NOT NULL DEFAULT 'mcq',
  prompt TEXT NOT NULL,
  options_json JSON NULL,
  correct_option CHAR(1) NULL,
  task_schema_json JSON NULL,
  points INT NOT NULL DEFAULT 5,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_peaklyy_qb_domain (domain_key, level_key, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS peaklyy_attempts (
  id CHAR(36) PRIMARY KEY,
  assessment_id CHAR(36) NOT NULL,
  public_token CHAR(36) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  domain_key VARCHAR(40) NOT NULL,
  degree_branch VARCHAR(255) NULL,
  college_name VARCHAR(255) NULL,
  status ENUM('registered','in_progress','submitted','expired') NOT NULL DEFAULT 'registered',
  score INT NULL,
  stars TINYINT NULL,
  passed TINYINT(1) NULL,
  time_taken_seconds INT NULL,
  violation_count INT NOT NULL DEFAULT 0,
  questions_json JSON NULL,
  started_at DATETIME NULL,
  submitted_at DATETIME NULL,
  unlock_at DATETIME NULL,
  webhook_sent_at DATETIME NULL,
  webhook_status VARCHAR(40) NULL,
  webhook_response TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_peaklyy_attempt_assess (assessment_id),
  INDEX idx_peaklyy_attempt_email (assessment_id, email, domain_key),
  CONSTRAINT fk_peaklyy_attempt_assess FOREIGN KEY (assessment_id) REFERENCES peaklyy_assessments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS peaklyy_attempt_answers (
  id CHAR(36) PRIMARY KEY,
  attempt_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  answer_option CHAR(1) NULL,
  answer_json JSON NULL,
  is_correct TINYINT(1) NULL,
  points_awarded INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_peaklyy_ans (attempt_id, question_id),
  CONSTRAINT fk_peaklyy_ans_attempt FOREIGN KEY (attempt_id) REFERENCES peaklyy_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
