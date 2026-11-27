CREATE TABLE IF NOT EXISTS dj_push_config (
    id TINYINT PRIMARY KEY,
    private_pem TEXT NOT NULL,
    public_key VARCHAR(100) NOT NULL,
    token_cache TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dj_push_devices (
    id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh VARCHAR(100) NOT NULL,
    auth_key VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dj_push_outbox (
    request_id BIGINT UNSIGNED NOT NULL,
    device_id CHAR(64) CHARACTER SET ascii NOT NULL,
    payload TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    available_at BIGINT NOT NULL,
    PRIMARY KEY (request_id, device_id),
    INDEX idx_push_available (available_at),
    CONSTRAINT fk_push_device FOREIGN KEY (device_id) REFERENCES dj_push_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
