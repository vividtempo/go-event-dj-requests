-- Run before deploying the guest experience on an existing MySQL or MariaDB database.
-- Each step can be rerun. Existing votes remain upvotes and existing links stay in place.

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='events' AND column_name='genres'),
    'SELECT 1', 'ALTER TABLE events ADD COLUMN genres TEXT NULL');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='requests' AND column_name='requester_name'),
    'SELECT 1', 'ALTER TABLE requests ADD COLUMN requester_name VARCHAR(80) NOT NULL DEFAULT ''''');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='requests' AND column_name='artwork_url'),
    'SELECT 1', 'ALTER TABLE requests ADD COLUMN artwork_url VARCHAR(500) NOT NULL DEFAULT ''''');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='requests' AND column_name='store_url'),
    'SELECT 1', 'ALTER TABLE requests ADD COLUMN store_url VARCHAR(500) NOT NULL DEFAULT ''''');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='votes' AND column_name='direction'),
    'SELECT 1', 'ALTER TABLE votes ADD COLUMN direction TINYINT NOT NULL DEFAULT 1');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='booking_url'),
    'SELECT 1', 'ALTER TABLE settings ADD COLUMN booking_url VARCHAR(500) NOT NULL DEFAULT ''''');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='contact_url'),
    'SELECT 1', 'ALTER TABLE settings ADD COLUMN contact_url VARCHAR(500) NOT NULL DEFAULT ''''');
PREPARE upgrade_step FROM @ddl; EXECUTE upgrade_step; DEALLOCATE PREPARE upgrade_step;

ALTER TABLE requests MODIFY status ENUM('pending','played','skipped','accepted','declined') NOT NULL DEFAULT 'pending';
UPDATE requests SET status='declined' WHERE status='skipped';

CREATE TABLE IF NOT EXISTS guest_presence (
 event_id BIGINT UNSIGNED NOT NULL,
 guest_key CHAR(64) NOT NULL,
 last_seen BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (event_id,guest_key),
 INDEX idx_presence_seen (last_seen),
 CONSTRAINT fk_presence_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
