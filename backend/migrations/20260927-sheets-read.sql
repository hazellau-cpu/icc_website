ALTER TABLE students
  ADD COLUMN paid_status VARCHAR(64) NULL,
  ADD COLUMN hours_completed DECIMAL(8, 2) NULL,
  ADD COLUMN new_bill_start DATE NULL,
  ADD COLUMN source_row_number INT NULL;

CREATE TABLE progress_log_entries (
  progress_log_entry_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  row_number INT NOT NULL,
  record_date DATE NOT NULL,
  start_time TIME NULL,
  programme_id VARCHAR(64),
  programme_name VARCHAR(255),
  tutor_id VARCHAR(64),
  tutor_name VARCHAR(255),
  course_type VARCHAR(64) NOT NULL,
  attendance_status VARCHAR(64),
  comment TEXT,
  progress TEXT,
  remarks TEXT,
  lesson_time VARCHAR(128),
  current_robot VARCHAR(255),
  robot_status VARCHAR(64),
  starting_level VARCHAR(64),
  finished_level VARCHAR(64),
  progress_percent VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_progress_log_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  UNIQUE KEY uq_progress_log_source_row (student_id, row_number, record_date),
  INDEX idx_progress_log_latest (student_id, course_type, record_date, start_time, row_number)
);