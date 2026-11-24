<?php
return [
    'db_host' => '127.0.0.1',
    'db_port' => '3306',
    'db_name' => 'REPLACE_WITH_CLOUDWAYS_DB_NAME',
    'db_user' => 'REPLACE_WITH_CLOUDWAYS_DB_USERNAME',
    'db_password' => 'REPLACE_WITH_CLOUDWAYS_DB_PASSWORD',
    // Store a password HASH, not plaintext. Generate using: php -r 'echo password_hash("YOUR_PASSWORD", PASSWORD_DEFAULT), PHP_EOL;'
    'admin_password_hash' => 'REPLACE_WITH_PASSWORD_HASH',
    // Generate with: php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
    'app_secret' => 'REPLACE_WITH_64_HEX_CHARACTERS',
    'base_url' => 'https://YOUR-TEMPORARY-CLOUDWAYS-URL',
];
