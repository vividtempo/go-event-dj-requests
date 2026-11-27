<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }
require dirname(__DIR__).'/private/web_push.php';

function push_schema(): void {
    try { sql('SELECT request_id FROM dj_push_outbox LIMIT 0'); }
    catch (PDOException $e) {
        if ($e->getCode() !== '42S02') throw $e;
        $ddl = file_get_contents(dirname(__DIR__).'/migrations/002-dj-push.sql');
        foreach (array_filter(array_map('trim',explode(';',$ddl))) as $statement) sql($statement);
    }
}

function push_public_key(): string {
    push_schema();
    $saved = sql('SELECT public_key FROM dj_push_config WHERE id=1')->fetchColumn();
    if ($saved) return $saved;
    $key = push_ec_key();
    if (!openssl_pkey_export($key,$pem)) throw new RuntimeException('Could not initialize push signing.');
    sql('INSERT IGNORE INTO dj_push_config(id,private_pem,public_key,token_cache) VALUES(1,?,?,?)',[$pem,push_b64(push_point($key)),'{}']);
    return (string)sql('SELECT public_key FROM dj_push_config WHERE id=1')->fetchColumn();
}

function push_endpoint(mixed $value): string {
    if (!is_string($value) || strlen($value)>2048 ||
        !preg_match('~^https://(?:fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.apple\.com)/[A-Za-z0-9_./%?=&:+\~-]+$~D',$value)) {
        err(400,'Choose a Chrome or Safari push subscription.');
    }
    return $value;
}

function push_authorization(string $audience): string {
    return tx(function() use ($audience) {
        $row = sql('SELECT * FROM dj_push_config WHERE id=1 FOR UPDATE')->fetch();
        $cache = json_decode($row['token_cache'],true,512,JSON_THROW_ON_ERROR);
        if (($cache[$audience]['exp'] ?? 0) < time()+300) {
            $expiry = time()+43200;
            $cache[$audience]=['exp'=>$expiry,'token'=>push_vapid($row['private_pem'],$audience,$expiry)];
            sql('UPDATE dj_push_config SET token_cache=? WHERE id=1',[json_encode($cache,JSON_THROW_ON_ERROR)]);
        }
        return 'vapid t='.$cache[$audience]['token'].', k='.$row['public_key'];
    });
}

function send_device_push(array $device, string $payload, int $ttl): int {
    $endpoint=$device['endpoint'];
    $body=push_encrypt($payload,push_decode($device['p256dh']),push_decode($device['auth_key']));
    $auth=push_authorization('https://'.parse_url($endpoint,PHP_URL_HOST));
    $ch=curl_init($endpoint);
    curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>2,CURLOPT_TIMEOUT=>4,
        CURLOPT_HTTPHEADER=>['Authorization: '.$auth,'Content-Encoding: aes128gcm','Content-Type: application/octet-stream',
            'TTL: '.max(0,$ttl),'Urgency: high']]);
    curl_exec($ch);
    return (int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);
}

// Queue inside the same transaction as a new song. Older installations have no devices before the first setup.
function queue_dj_push(int $requestId, int $eventId, string $eventName, string $title, string $artist): void {
    $payload=json_encode(['requestId'=>$requestId,'eventId'=>$eventId,'event'=>$eventName,'song'=>$title,'artist'=>$artist],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    try {
        sql('INSERT INTO dj_push_outbox(request_id,device_id,payload,available_at,expires_at)
            SELECT ?,id,?,?,? FROM dj_push_devices',[$requestId,$payload,time(),time()+300]);
    } catch (PDOException $e) {
        if ($e->getCode() !== '42S02') throw $e;
    }
}

function remove_gone_device(array $device): void {
    sql('DELETE FROM dj_push_devices WHERE id=? AND p256dh=? AND auth_key=?',[$device['id'],$device['p256dh'],$device['auth_key']]);
}

function deliver_dj_push(): void {
    $now=time();
    try {
        $jobs=sql('SELECT o.*,d.id,d.endpoint,d.p256dh,d.auth_key FROM dj_push_outbox o
            JOIN dj_push_devices d ON d.id=o.device_id WHERE o.available_at<=? ORDER BY o.available_at,o.request_id LIMIT 6',[$now])->fetchAll();
    } catch (PDOException $e) {
        if ($e->getCode()==='42S02') return;
        throw $e;
    }
    foreach ($jobs as $job) {
        $key=[$job['request_id'],$job['device_id']];
        if ($job['expires_at']<=time()) {
            sql('DELETE FROM dj_push_outbox WHERE request_id=? AND device_id=?',$key);
            continue;
        }
        // Claim before network I/O. A transient failure becomes eligible on the next poll after 15 seconds.
        if (!sql('UPDATE dj_push_outbox SET available_at=? WHERE request_id=? AND device_id=? AND available_at<=?',
            [time()+15,...$key,$now])->rowCount()) continue;
        try {
            $code=send_device_push($job,$job['payload'],$job['expires_at']-time());
            if ($code===404 || $code===410) remove_gone_device($job);
            if (($code>=200 && $code<300) || $code===404 || $code===410) {
                sql('DELETE FROM dj_push_outbox WHERE request_id=? AND device_id=?',$key);
            } elseif ($code) error_log('DJ push service returned HTTP '.$code);
        } catch (Throwable $e) { error_log('DJ notification delivery deferred.'); }
    }
}

function push_after_response(): void {
    register_shutdown_function(static function(){
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { deliver_dj_push(); } catch (Throwable $e) { error_log('DJ notification delivery unavailable.'); }
    });
}

if (str_starts_with($path,'/api/admin/push/')) {
    admin($method!=='GET');
    if ($path==='/api/admin/push/config' && $method==='GET') {
        if (!function_exists('openssl_pkey_derive') || !function_exists('curl_init')) err(503,'Web Push requires PHP OpenSSL and cURL.');
        out(['publicKey'=>push_public_key()]);
    }
    if ($method!=='POST') err(405,'Method not allowed.');
    $data=input();
    $endpoint=push_endpoint($data['endpoint']??null);
    $id=hash('sha256',$endpoint);
    push_schema();
    if ($path==='/api/admin/push/status') {
        out(['enabled'=>(bool)sql('SELECT id FROM dj_push_devices WHERE id=?',[$id])->fetchColumn()]);
    }
    if ($path==='/api/admin/push/subscribe') {
        $auth=$data['keys']['auth']??null;
        $key=$data['keys']['p256dh']??null;
        if (!is_string($auth)||!is_string($key)||strlen($auth)>32||strlen($key)>100||
            strlen(push_decode($auth))!==16||!push_peer(push_decode($key))) err(400,'Invalid browser subscription.');
        if (($data['publicKey']??null)!==push_public_key()) err(409,'Refresh the dashboard and enable notifications again.');
        sql('INSERT INTO dj_push_devices(id,endpoint,p256dh,auth_key) VALUES(?,?,?,?)
            ON DUPLICATE KEY UPDATE p256dh=?,auth_key=?',[$id,$endpoint,$key,$auth,$key,$auth]);
        setcookie('dj_alert_device',$id,['expires'=>time()+31536000,'path'=>'/','secure'=>https(),'httponly'=>true,'samesite'=>'Strict']);
        out(['ok'=>true]);
    }
    if ($path==='/api/admin/push/unsubscribe') {
        sql('DELETE FROM dj_push_devices WHERE id=?',[$id]);
        setcookie('dj_alert_device','',['expires'=>1,'path'=>'/','secure'=>https(),'httponly'=>true,'samesite'=>'Strict']);
        out(['ok'=>true]);
    }
    if ($path==='/api/admin/push/test') {
        $device=sql('SELECT * FROM dj_push_devices WHERE id=?',[$id])->fetch();
        if (!$device) err(409,'Enable notifications on this device first.');
        $code=send_device_push($device,'{"test":true}',60);
        if ($code===404 || $code===410) { remove_gone_device($device); err(410,'This browser subscription expired. Enable notifications again.'); }
        if ($code<200 || $code>=300) err(503,'The push service could not accept the test. Try again.');
        out(['ok'=>true]);
    }
    err(404,'Unknown notification setting.');
}
