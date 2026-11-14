CREATE TABLE programmes (
  programme_id VARCHAR(64) PRIMARY KEY,
  programme_name VARCHAR(255) NOT NULL,
  programme_type ENUM('Robot', 'Coding', 'Math') NOT NULL,
  kit_id VARCHAR(64),
  level_number INT,
  variant ENUM('original', 'additional') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE students (
  student_id VARCHAR(64) PRIMARY KEY,
  student_name VARCHAR(255) NOT NULL,
  course_type ENUM('Robot', 'Coding', 'Math') NOT NULL,
  programme_id VARCHAR(64) NOT NULL,
  tutor_name VARCHAR(255),
  attendance_status VARCHAR(64),
  paid_status VARCHAR(64),
  current_robot VARCHAR(255),
  robot_status VARCHAR(64),
  progress TEXT,
  comment TEXT,
  total_hours DECIMAL(8, 2),
  remaining_hours DECIMAL(8, 2),
  hours_completed DECIMAL(8, 2),
  new_bill_start DATE NULL,
  remarks TEXT,
  source_row_number INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  INDEX idx_students_programme (programme_id)
);

CREATE TABLE curriculum_items (
  curriculum_id VARCHAR(96) PRIMARY KEY,
  programme_id VARCHAR(64) NOT NULL,
  level_number INT NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_curriculum_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_curriculum_programme_level_item (programme_id, level_number, item_name)
);

CREATE TABLE robot_library_items (
  robot_id VARCHAR(96) PRIMARY KEY,
  programme_id VARCHAR(64) NOT NULL,
  sequence_number INT NOT NULL,
  robot_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_robot_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_robot_programme_sequence (programme_id, sequence_number)
);

CREATE TABLE components (
  component_id VARCHAR(64) PRIMARY KEY,
  kit_id VARCHAR(64) NOT NULL,
  component_name VARCHAR(255) NOT NULL,
  unit_price DECIMAL(10, 2),
  tier VARCHAR(32),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_component_kit_name (kit_id, component_name)
);

CREATE TABLE component_level_requirements (
  component_id VARCHAR(64) NOT NULL,
  level_number INT NOT NULL,
  level_quantity INT NOT NULL DEFAULT 0,
  cumulative_quantity INT NOT NULL DEFAULT 0,
  PRIMARY KEY (component_id, level_number),
  CONSTRAINT fk_requirement_component FOREIGN KEY (component_id) REFERENCES components(component_id)
);

CREATE TABLE inventory_items (
  inventory_id VARCHAR(64) PRIMARY KEY,
  component_id VARCHAR(64) NOT NULL,
  centre_quantity INT NOT NULL DEFAULT 0,
  last_counted DATE NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_component FOREIGN KEY (component_id) REFERENCES components(component_id),
  UNIQUE KEY uq_inventory_component (component_id)
);

CREATE TABLE student_checklist_items (
  checklist_item_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  component_id VARCHAR(64) NOT NULL,
  required_quantity INT NOT NULL,
  student_quantity INT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Missing',
  notes TEXT,
  generated_for_programme_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_checklist_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_checklist_component FOREIGN KEY (component_id) REFERENCES components(component_id),
  CONSTRAINT fk_checklist_programme FOREIGN KEY (generated_for_programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_checklist_student_component (student_id, component_id),
  INDEX idx_checklist_student (student_id)
);

CREATE TABLE borrowing_logs (
  borrowing_id VARCHAR(64) PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  component_id VARCHAR(64) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  status ENUM('Still borrowing', 'Returned') NOT NULL DEFAULT 'Still borrowing',
  borrowed_on DATE NOT NULL,
  returned_on DATE NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_borrowing_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_borrowing_component FOREIGN KEY (component_id) REFERENCES components(component_id),
  INDEX idx_borrowing_student (student_id),
  INDEX idx_borrowing_status (status)
);

CREATE TABLE robot_lessons (
  robot_lesson_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  tutor_name VARCHAR(255),
  programme_id VARCHAR(64) NOT NULL,
  robot_name VARCHAR(255),
  current_level VARCHAR(64),
  lesson_date DATE NOT NULL,
  robot_status VARCHAR(32),
  attendance VARCHAR(32),
  comment TEXT,
  remarks TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_robot_lesson_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_robot_lesson_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_robot_lesson (student_id, lesson_date, robot_name),
  INDEX idx_robot_lesson_date (lesson_date)
);

CREATE TABLE coding_lessons (
  coding_lesson_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  tutor_name VARCHAR(255),
  programme_id VARCHAR(64) NOT NULL,
  lesson_date DATE NOT NULL,
  attendance VARCHAR(32),
  starting_level VARCHAR(64),
  ending_level VARCHAR(64),
  topic VARCHAR(255),
  comment TEXT,
  remarks TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_coding_lesson_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_coding_lesson_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_coding_lesson (student_id, lesson_date, starting_level, ending_level),
  INDEX idx_coding_lesson_date (lesson_date)
);

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

CREATE TABLE student_robot_progress (
  student_robot_progress_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  programme_id VARCHAR(64) NOT NULL,
  robot_name VARCHAR(255) NOT NULL,
  sequence_number INT,
  status VARCHAR(32),
  notes TEXT,
  finish_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_robot_progress_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_student_robot_progress_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_student_robot_progress (student_id, programme_id, robot_name),
  INDEX idx_student_robot_progress_student (student_id)
);

CREATE TABLE robot_progress_reviews (
  review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  programme_id VARCHAR(64) NOT NULL,
  robot_id VARCHAR(96) NOT NULL,
  submitted_name VARCHAR(255) NOT NULL,
  canonical_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  decision ENUM('accepted', 'rejected') NOT NULL,
  reviewed_by VARCHAR(255) NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'james-api',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_robot_review_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_robot_review_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  CONSTRAINT fk_robot_review_robot FOREIGN KEY (robot_id) REFERENCES robot_library_items(robot_id),
  INDEX idx_robot_review_student (student_id),
  INDEX idx_robot_review_created (created_at)
);

CREATE TABLE student_topic_progress (
  student_topic_progress_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL,
  programme_id VARCHAR(64) NOT NULL,
  level_number VARCHAR(64),
  topic VARCHAR(255) NOT NULL,
  status VARCHAR(32),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_topic_progress_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_student_topic_progress_programme FOREIGN KEY (programme_id) REFERENCES programmes(programme_id),
  UNIQUE KEY uq_student_topic_progress (student_id, programme_id, level_number, topic),
  INDEX idx_student_topic_progress_student (student_id)
);

CREATE TABLE workspace_shared_edits (
  edit_key VARCHAR(64) NOT NULL PRIMARY KEY,
  edit_value JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(254) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
