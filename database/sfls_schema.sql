-- ============================================================
--  Smart Faculty Locator System (SFLS) - MySQL Schema
--  Version: 1.0 | Engine: InnoDB | Charset: utf8mb4
-- ============================================================

CREATE DATABASE IF NOT EXISTS sfls_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sfls_db;

-- ──────────────────────────────────────────────
--  CORE AUTHENTICATION
-- ──────────────────────────────────────────────
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(180) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','faculty','student') NOT NULL DEFAULT 'student',
  full_name     VARCHAR(120) NOT NULL,
  avatar_url    VARCHAR(512),
  phone         VARCHAR(20),
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login    DATETIME,
  INDEX idx_role (role),
  INDEX idx_email (email)
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  CAMPUS INFRASTRUCTURE
-- ──────────────────────────────────────────────
CREATE TABLE buildings (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  short_code      VARCHAR(10)  NOT NULL UNIQUE,   -- e.g. "CSE-BLOCK"
  description     TEXT,
  lat             DECIMAL(10,7),                   -- GPS for outdoor nav
  lng             DECIMAL(10,7),
  entrance_lat    DECIMAL(10,7),
  entrance_lng    DECIMAL(10,7),
  campus_image_url VARCHAR(512),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_short_code (short_code)
) ENGINE=InnoDB;

CREATE TABLE floors (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  building_id  INT UNSIGNED NOT NULL,
  floor_number TINYINT      NOT NULL,              -- 0 = Ground, 1,2,3...
  floor_name   VARCHAR(60),                         -- "Ground Floor", "Mezzanine"
  svg_map_data LONGTEXT,                            -- SVG floor plan XML
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_building_floor (building_id, floor_number),
  CONSTRAINT fk_floors_building FOREIGN KEY (building_id)
    REFERENCES buildings(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE rooms (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  floor_id    INT UNSIGNED NOT NULL,
  room_number VARCHAR(20)  NOT NULL,               -- "201-A"
  room_name   VARCHAR(80),                          -- "Staff Room", "HOD Cabin"
  room_type   ENUM('office','lab','classroom','cabin','common') DEFAULT 'office',
  capacity    SMALLINT UNSIGNED DEFAULT 1,
  x_position  SMALLINT,                             -- SVG x-coord for floor map
  y_position  SMALLINT,                             -- SVG y-coord for floor map
  width       SMALLINT DEFAULT 60,
  height      SMALLINT DEFAULT 40,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_floor_room (floor_id, room_number),
  CONSTRAINT fk_rooms_floor FOREIGN KEY (floor_id)
    REFERENCES floors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  SEATING ARRANGEMENT
-- ──────────────────────────────────────────────
CREATE TABLE seats (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id    INT UNSIGNED NOT NULL,
  seat_label VARCHAR(10)  NOT NULL,                -- "A1", "B3"
  row_num    TINYINT      NOT NULL,
  col_num    TINYINT      NOT NULL,
  seat_type  ENUM('desk','workstation','cabin','lab_bench') DEFAULT 'desk',
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_room_seat (room_id, seat_label),
  CONSTRAINT fk_seats_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  FACULTY PROFILE
-- ──────────────────────────────────────────────
CREATE TABLE departments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  short_code VARCHAR(10)  NOT NULL UNIQUE,
  hod_user_id INT UNSIGNED,
  INDEX idx_short_code (short_code)
) ENGINE=InnoDB;

CREATE TABLE faculty (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL UNIQUE,
  department_id   INT UNSIGNED NOT NULL,
  employee_id     VARCHAR(30)  NOT NULL UNIQUE,
  designation     VARCHAR(80),                     -- "Asst. Prof", "Professor"
  specialization  VARCHAR(120),
  cabin_room_id   INT UNSIGNED,                    -- primary assigned room
  primary_seat_id INT UNSIGNED,                    -- primary assigned desk
  office_hours    VARCHAR(255),                    -- "Mon-Fri 10AM-12PM"
  -- Status
  status          ENUM('available','busy','not_available','in_class')
                  NOT NULL DEFAULT 'not_available',
  status_message  VARCHAR(255),                    -- custom message
  status_updated_at DATETIME,
  -- Geofence / WiFi tracking
  last_seen_lat   DECIMAL(10,7),
  last_seen_lng   DECIMAL(10,7),
  last_checkin_at DATETIME,
  is_on_campus    TINYINT(1) DEFAULT 0,
  -- Push notification token
  fcm_token       VARCHAR(512),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_faculty_user  FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_faculty_dept  FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_faculty_room  FOREIGN KEY (cabin_room_id)
    REFERENCES rooms(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_faculty_seat  FOREIGN KEY (primary_seat_id)
    REFERENCES seats(id) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_status (status),
  INDEX idx_department (department_id)
) ENGINE=InnoDB;

-- HOD forward-reference fix
ALTER TABLE departments
  ADD CONSTRAINT fk_dept_hod FOREIGN KEY (hod_user_id)
    REFERENCES faculty(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
--  SEAT ALLOCATION (Admin controlled)
-- ──────────────────────────────────────────────
CREATE TABLE seat_allocations (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  seat_id      INT UNSIGNED NOT NULL UNIQUE,       -- one seat → one faculty
  faculty_id   INT UNSIGNED NOT NULL,
  allocated_by INT UNSIGNED NOT NULL,              -- admin user_id
  allocated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        VARCHAR(255),
  CONSTRAINT fk_alloc_seat    FOREIGN KEY (seat_id)
    REFERENCES seats(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alloc_faculty FOREIGN KEY (faculty_id)
    REFERENCES faculty(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alloc_admin   FOREIGN KEY (allocated_by)
    REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  INDOOR NAVIGATION PATHS
-- ──────────────────────────────────────────────
CREATE TABLE nav_waypoints (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  floor_id    INT UNSIGNED NOT NULL,
  label       VARCHAR(60)  NOT NULL,               -- "Staircase-A", "Lift-1"
  wp_type     ENUM('corridor','staircase','lift','entrance','room_door') DEFAULT 'corridor',
  x_pos       SMALLINT,
  y_pos       SMALLINT,
  CONSTRAINT fk_wp_floor FOREIGN KEY (floor_id)
    REFERENCES floors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE nav_edges (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_wp     INT UNSIGNED NOT NULL,
  to_wp       INT UNSIGNED NOT NULL,
  distance_m  FLOAT,                               -- metres
  instruction VARCHAR(255),                        -- "Turn left at corridor B"
  CONSTRAINT fk_edge_from FOREIGN KEY (from_wp)
    REFERENCES nav_waypoints(id) ON DELETE CASCADE,
  CONSTRAINT fk_edge_to   FOREIGN KEY (to_wp)
    REFERENCES nav_waypoints(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  NOTIFICATION SUBSCRIPTIONS
-- ──────────────────────────────────────────────
CREATE TABLE notification_subscriptions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_user_id INT UNSIGNED NOT NULL,
  faculty_id   INT UNSIGNED NOT NULL,
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sub (student_user_id, faculty_id),
  CONSTRAINT fk_sub_student FOREIGN KEY (student_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_faculty FOREIGN KEY (faculty_id)
    REFERENCES faculty(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  title        VARCHAR(120) NOT NULL,
  body         TEXT,
  is_read      TINYINT(1)   NOT NULL DEFAULT 0,
  notif_type   ENUM('status_change','message','system') DEFAULT 'status_change',
  ref_faculty_id INT UNSIGNED,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user    FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_faculty FOREIGN KEY (ref_faculty_id)
    REFERENCES faculty(id) ON DELETE SET NULL,
  INDEX idx_user_read (user_id, is_read)
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  ACTIVITY LOGS (Audit trail)
-- ──────────────────────────────────────────────
CREATE TABLE activity_logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED,
  action       VARCHAR(80)  NOT NULL,              -- "STATUS_CHANGE", "LOGIN"
  target_type  VARCHAR(40),                        -- "faculty", "seat"
  target_id    INT UNSIGNED,
  old_value    VARCHAR(255),
  new_value    VARCHAR(255),
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(512),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_action (action),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────
--  SEED DATA
-- ──────────────────────────────────────────────
INSERT INTO users (email, password_hash, role, full_name) VALUES
  ('admin@campus.edu',   '$2b$12$PLACEHOLDER_HASH_ADMIN',   'admin',   'System Administrator'),
  ('dr.sharma@campus.edu','$2b$12$PLACEHOLDER_HASH_FAC1',  'faculty', 'Dr. Priya Sharma'),
  ('prof.kumar@campus.edu','$2b$12$PLACEHOLDER_HASH_FAC2', 'faculty', 'Prof. Ramesh Kumar'),
  ('student1@campus.edu', '$2b$12$PLACEHOLDER_HASH_STU1',  'student', 'Arjun Mehta');

INSERT INTO departments (name, short_code) VALUES
  ('Computer Science & Engineering', 'CSE'),
  ('Electronics & Communication',    'ECE'),
  ('Mechanical Engineering',         'MECH'),
  ('Mathematics',                    'MATH');

INSERT INTO buildings (name, short_code, lat, lng, entrance_lat, entrance_lng) VALUES
  ('CSE Block',    'CSE-BLK',  28.6139,  77.2090,  28.6140,  77.2091),
  ('Science Block','SCI-BLK',  28.6135,  77.2085,  28.6136,  77.2086),
  ('Admin Block',  'ADM-BLK',  28.6130,  77.2080,  28.6131,  77.2081);
