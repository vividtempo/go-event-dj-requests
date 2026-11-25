<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

// Loaded by index.php, after its authentication, database, and response helpers.
function automation_schema(): void {
    sql("CREATE TABLE IF NOT EXISTS automation_settings (
        id INT PRIMARY KEY, token_hash CHAR(64) NULL, created_at BIGINT UNSIGNED NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    sql("CREATE TABLE IF NOT EXISTS automation_event_links (
        external_id VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
        event_id BIGINT UNSIGNED NOT NULL UNIQUE,
        CONSTRAINT fk_automation_event FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    sql('INSERT IGNORE INTO automation_settings(id) VALUES(1)');
}

function automation_fields(array $data, bool $creating): array {
    $allowed = ['name', 'date', 'venue', 'external_id'];
    foreach (array_keys($data) as $key) {
        if (!in_array($key, $allowed, true)) err(400, 'Unknown field: '.$key);
    }
    $fields = [];
    if ($creating || array_key_exists('name', $data)) $fields['name'] = clean($data['name'] ?? null, 120);
    if (array_key_exists('venue', $data)) $fields['venue'] = clean($data['venue'], 160, false);
    if (array_key_exists('date', $data)) {
        $date = $data['date'];
        if (!is_string($date)) err(400, 'Date must be YYYY-MM-DD or empty.');
        if ($date !== '') {
            if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $parts)
                || !checkdate((int)$parts[2], (int)$parts[3], (int)$parts[1])) {
                err(400, 'Date must be a real calendar date in YYYY-MM-DD format.');
            }
        }
        $fields['event_date'] = $date;
    }
    return $fields;
}

function automation_event(int $id): array {
    $event = sql('SELECT e.*, l.external_id FROM events e LEFT JOIN automation_event_links l ON l.event_id=e.id WHERE e.id=?', [$id])->fetch();
    if (!$event) err(404, 'Event not found.');
    if (request_schedule_available()) {
        $schedule=sql('SELECT opens_at,closes_at,timezone FROM planner_request_schedule WHERE event_id=?',[$id])->fetch();
        if ($schedule) $event+=$schedule;
    }
    foreach (['id', 'created_at'] as $key) $event[$key] = (int)$event[$key];
    foreach (['is_active', 'requests_open', 'archived'] as $key) $event[$key] = (bool)$event[$key];
    $event['genres']=json_decode($event['genres']??'[]',true)?:[];
    $event['date'] = $event['event_date'];
    unset($event['event_date']);
    return $event;
}

function automation_update(int $id, array $fields): void {
    if (!$fields) err(400, 'Supply at least one of name, date, or venue.');
    // Column names come exclusively from automation_fields, never from request keys.
    $set = implode(',', array_map(fn($key) => $key.'=?', array_keys($fields)));
    sql('UPDATE events SET '.$set.' WHERE id=?', [...array_values($fields), $id]);
}

if ($path === '/api/admin/automation' && in_array($method, ['GET', 'POST'], true)) {
    admin($method === 'POST');
    automation_schema();
    if ($method === 'GET') {
        $row = sql('SELECT token_hash,created_at FROM automation_settings WHERE id=1')->fetch();
        out(['enabled' => !empty($row['token_hash']), 'created_at' => $row['created_at'] ? (int)$row['created_at'] : null]);
    }
    $action = input()['action'] ?? '';
    if ($action === 'revoke') {
        sql('UPDATE automation_settings SET token_hash=NULL,created_at=NULL WHERE id=1');
        out(['ok' => true, 'enabled' => false]);
    }
    if ($action !== 'rotate') err(400, 'Unknown API key action.');
    $key = 'gedj_'.bin2hex(random_bytes(32));
    sql('UPDATE automation_settings SET token_hash=?,created_at=? WHERE id=1', [hash('sha256', $key), time()]);
    out(['ok' => true, 'enabled' => true, 'key' => $key]);
}

if (str_starts_with($path, '/api/v1/')) {
    $key = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if (!is_string($key) || !preg_match('/^gedj_[a-f0-9]{64}$/', $key)) err(401, 'Valid X-API-Key required.');
    // Anonymous callers cannot create tables. Initialize these in DJ Settings first.
    $stored = sql('SELECT token_hash FROM automation_settings WHERE id=1')->fetchColumn();
    if (!$stored || !hash_equals($stored, hash('sha256', $key))) err(401, 'Invalid or revoked API key.');
    rate(hash('sha256', $key), 'automation', 120, 60);
    if ($path === '/api/v1/events/planner-sync') {
        if ($method!=='POST') err(405,'Method not allowed.');
        $data=input();
        $external=$data['external_id']??null;
        if (!is_string($external)||!preg_match('/^planner:[a-f0-9]{32}$/D',$external)) err(400,'A planner booking ID is required.');
        $target=$data['target_event_id']??null;
        if ($target!==null&&(!is_int($target)||$target<1)) err(400,'Invalid existing request event ID.');
        $window=validate_planner_schedule($data);
        $genres=null;
        if (array_key_exists('genres',$data)) {
            if (!is_array($data['genres']) || !array_is_list($data['genres']) || count($data['genres'])>30) err(400,'Send up to 30 genre labels.');
            $genres=array_values(array_unique(array_map(fn($genre)=>clean($genre,80),$data['genres'])));
            unset($data['genres']);
        }
        unset($data['target_event_id'],$data['opens_at'],$data['closes_at'],$data['timezone'],$data['source_revision']);
        $fields=automation_fields($data,true);
        if (($fields['event_date']??'')===''&&$window[0]!==0) err(400,'Event date is required.');
        $fields+=['event_date'=>'','venue'=>''];
        request_schedule_schema();
        $result=tx(function() use ($external,$target,$fields,$window,$key,$genres) {
            $stored=sql('SELECT token_hash FROM automation_settings WHERE id=1 FOR UPDATE')->fetchColumn();
            if (!$stored||!hash_equals($stored,hash('sha256',$key))) err(401,'Invalid or revoked API key.');
            $result=upsert_planner_schedule($external,$target,$fields,$window);
            if ($genres!==null && $result['event']!==null) {
                sql('UPDATE events SET genres=? WHERE id=?',[json_encode($genres,JSON_THROW_ON_ERROR),$result['event']['id']]);
                $result['event']['genres']=$genres;
            }
            return $result;
        });
        http_response_code($result['created']?201:200);
        out($result);
    }
    $match = [];
    $single = preg_match('#^/api/v1/events/([1-9][0-9]*)$#', $path, $match);
    if ($path !== '/api/v1/events' && !$single) err(404, 'API endpoint not found.');
    if ($single && $method === 'GET') out(['event' => automation_event((int)$match[1])]);
    if ($path === '/api/v1/events' && $method === 'GET') {
        $after = filter_var($_GET['after_id'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($after === false) err(400, 'after_id must be a non-negative integer.');
        $ids = sql('SELECT id FROM events WHERE id>? ORDER BY id LIMIT 101', [$after])->fetchAll();
        $more = count($ids) > 100;
        $ids = array_slice($ids, 0, 100);
        $events = array_map(fn($row) => automation_event((int)$row['id']), $ids);
        out(['events' => $events, 'next_after_id' => $more ? (int)end($ids)['id'] : null]);
    }
    if (($single && $method === 'PATCH') || (!$single && $method === 'POST')) {
        $data = input();
        if ($single && array_key_exists('external_id', $data)) err(400, 'external_id cannot be changed.');
        $external = !$single ? clean($data['external_id'] ?? null, 120) : null;
        $fields = automation_fields($data, false);
        $result = tx(function() use ($single, $match, $external, $fields, $key) {
            // Serialize imports, including duplicate retries, and key revocation.
            $stored = sql('SELECT token_hash FROM automation_settings WHERE id=1 FOR UPDATE')->fetchColumn();
            if (!$stored || !hash_equals($stored, hash('sha256', $key))) err(401, 'Invalid or revoked API key.');
            $id = $single ? (int)$match[1] : (int)sql('SELECT event_id FROM automation_event_links WHERE external_id=?', [$external])->fetchColumn();
            $created = !$id;
            if ($created) {
                if (!isset($fields['name'])) err(400, 'name is required when creating an event.');
                sql('INSERT INTO events(name,event_date,venue,created_at) VALUES(?,?,?,?)', [$fields['name'], $fields['event_date'] ?? '', $fields['venue'] ?? '', time()]);
                $id = (int)db()->lastInsertId();
                sql('INSERT INTO automation_event_links(external_id,event_id) VALUES(?,?)', [$external, $id]);
            } else {
                automation_event($id); // Reject missing IDs rather than silently succeeding.
                if ($fields) automation_update($id, $fields);
                elseif ($single) err(400, 'Supply at least one of name, date, or venue.');
            }
            return ['created' => $created, 'event' => automation_event($id)];
        });
        http_response_code($result['created'] ? 201 : 200);
        out($result);
    }
    header('Allow: '.($single ? 'GET, PATCH' : 'GET, POST'));
    err(405, 'Method not allowed.');
}
