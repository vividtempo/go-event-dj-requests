CREATE TABLE IF NOT EXISTS events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 event_date VARCHAR(10) NOT NULL DEFAULT '',
 venue VARCHAR(160) NOT NULL DEFAULT '',
 is_active TINYINT(1) NOT NULL DEFAULT 0,
 requests_open TINYINT(1) NOT NULL DEFAULT 0,
 archived TINYINT(1) NOT NULL DEFAULT 0,
 created_at BIGINT UNSIGNED NOT NULL,
 INDEX idx_events_active (is_active,archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 event_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(120) NOT NULL,
 artist VARCHAR(120) NOT NULL,
 note VARCHAR(240) NOT NULL DEFAULT '',
 norm_title VARCHAR(255) NOT NULL,
 norm_artist VARCHAR(255) NOT NULL,
 status ENUM('pending','played','skipped') NOT NULL DEFAULT 'pending',
 created_at BIGINT UNSIGNED NOT NULL,
 UNIQUE KEY uniq_song (event_id,norm_title,norm_artist),
 INDEX idx_event_status (event_id,status,created_at),
 CONSTRAINT fk_requests_events FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS votes (
 request_id BIGINT UNSIGNED NOT NULL,
 voter_key CHAR(64) NOT NULL,
 created_at BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (request_id,voter_key),
 CONSTRAINT fk_votes_requests FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rate_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_hash CHAR(64) NOT NULL,
 action VARCHAR(30) NOT NULL,
 created_at BIGINT UNSIGNED NOT NULL,
 INDEX idx_rate (actor_hash,action,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 csrf_token CHAR(64) NOT NULL,
 expires_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS settings (
 id INT PRIMARY KEY,
 tip_url VARCHAR(500) NOT NULL DEFAULT '',
 review_url VARCHAR(500) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO settings (id,tip_url,review_url) VALUES (1,'','');

-- Additive integration tables; also initialized by authenticated DJ settings.
CREATE TABLE IF NOT EXISTS automation_settings (
 id INT PRIMARY KEY, token_hash CHAR(64) NULL, created_at BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO automation_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS automation_event_links (
 external_id VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
 event_id BIGINT UNSIGNED NOT NULL UNIQUE,
 CONSTRAINT fk_automation_event FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS guest_links (
 position INT PRIMARY KEY, label VARCHAR(40) NOT NULL, url VARCHAR(500) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
