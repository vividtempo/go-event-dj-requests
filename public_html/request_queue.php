<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

function count_active_guests(int $eventId): int {
    return (int)sql('SELECT COUNT(*) FROM guest_presence WHERE event_id=? AND last_seen>=?', [$eventId,time()-60])->fetchColumn();
}

// Existing installations create this additive table before starting a request transaction.
function ensure_request_submitters(): void {
    try {
        sql('SELECT request_id FROM request_submitters LIMIT 0');
    } catch (PDOException $e) {
        if ($e->getCode() !== '42S02') throw $e;
        sql("CREATE TABLE IF NOT EXISTS request_submitters (
    request_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    guest_key CHAR(64) NOT NULL,
    CONSTRAINT fk_submitter_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
}

// Number each browser's songs in submission order, independent of vote rank or moderation.
function add_requester_counts(array &$rows): void {
    $owners = array_column($rows, 'guest_key', 'id');
    ksort($owners, SORT_NUMERIC);
    $totals = array_count_values(array_filter($owners));
    $guestNumbers = $counts = $ordinals = [];
    foreach ($owners as $id => $key) {
        if ($key === null) continue;
        $guestNumbers[$key] ??= count($guestNumbers) + 1;
        $counts[$key] = ($counts[$key] ?? 0) + 1;
        $ordinals[$id] = $counts[$key];
    }
    foreach ($rows as &$row) {
        $key = $row['guest_key'];
        unset($row['guest_key']);
        if ($key === null) continue;
        $row['guest_number'] = $guestNumbers[$key];
        $row['request_number'] = $ordinals[$row['id']];
        $row['request_total'] = $totals[$key];
    }
}

function queue_rows(int $eventId, ?string $voter=null): array {
    $public=$voter!==null;
    ensure_request_submitters();
    $fields=$public ? 'COALESCE((SELECT direction FROM votes WHERE request_id=r.id AND voter_key=?),0) AS my_vote' : 'r.event_id,r.note,r.requester_name';
    // Include the whole event when counting submissions, even songs already moderated.
    $rows=sql("SELECT r.id,r.title,r.artist,r.status,r.created_at,r.artwork_url,r.store_url,submitter.guest_key,$fields,
        COALESCE((SELECT SUM(direction) FROM votes WHERE request_id=r.id),0) AS votes
        FROM requests r LEFT JOIN request_submitters submitter ON submitter.request_id=r.id WHERE r.event_id=?",
        $public ? [$voter,$eventId] : [$eventId])->fetchAll();
    add_requester_counts($rows);
    if ($public) $rows=array_filter($rows, fn($r)=>in_array($r['status'],['accepted','pending','played'],true));
    $order=['accepted'=>0,'pending'=>1,'played'=>2];
    usort($rows, static function($a,$b) use ($order) {
        $group=($order[$a['status']] ?? 3) <=> ($order[$b['status']] ?? 3);
        if ($group) return $group;
        if (in_array($a['status'],['accepted','pending'],true)) {
            // Older anonymous songs have no browser identity. Give each single-request priority.
            return ($b['votes'] <=> $a['votes'])
                ?: (($a['request_total'] ?? 1) <=> ($b['request_total'] ?? 1))
                ?: ($a['created_at'] <=> $b['created_at'])
                ?: ($a['id'] <=> $b['id']);
        }
        return ($b['votes'] <=> $a['votes']) ?: ($b['created_at'] <=> $a['created_at']) ?: ($b['id'] <=> $a['id']);
    });
    foreach ($rows as &$row) {
        foreach (['id','created_at','votes'] as $key) $row[$key]=(int)$row[$key];
        if ($public) {
            unset($row['guest_number'], $row['request_number'], $row['request_total']);
            $row['my_vote']=(int)$row['my_vote'];
            $row['voted']=$row['my_vote']!==0;
        } else {
            $row['event_id']=(int)$row['event_id'];
            if ($row['status']==='skipped') $row['status']='declined';
        }
    }
    return $rows;
}

function request_board(): array {
    $guest=guest();
    $event=active();
    $links=links();
    if (!$event) return ['state'=>'none','links'=>$links];
    $id=(int)$event['id'];
    // Each visible guest page polls. Tabs in the same browser share a single row.
    sql('INSERT INTO guest_presence(event_id,guest_key,last_seen) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last_seen=?', [$id,$guest,time(),time()]);
    sql('DELETE FROM guest_presence WHERE last_seen<?', [time()-300]);
    return [
        'state'=>$event['requests_open']?'open':'closed',
        'event'=>['id'=>$id,'name'=>$event['name'],'genres'=>json_decode($event['genres']??'[]',true)?:[],
            'timezone'=>$event['timezone']??'America/Chicago'],
        'active_guests'=>count_active_guests($id),'links'=>$links,'requests'=>queue_rows($id,$guest)
    ];
}

function submit_request(array $data): array {
    if (!empty($data['website'])) return ['ok'=>true];
    $title=clean($data['title']??null,120);
    $artist=clean($data['artist']??null,120);
    $name=clean($data['requester_name']??'',80,false);
    $note=clean($data['note']??'',240,false);
    $art=$store='';
    if (isset($data['catalog'])) {
        $track=$data['catalog'];
        if (!is_array($track) || !is_string($track['signature']??null) ||
            !is_string($track['artwork_url']??null) || !is_string($track['store_url']??null) ||
            !is_string($track['title']??null) || !is_string($track['artist']??null) ||
            !hash_equals(catalog_signature($track),$track['signature']) ||
            clean($track['title'],120)!==$title || clean($track['artist'],120)!==$artist) err(400,'Select the song again.');
        $art=$track['artwork_url'];
        $store=$track['store_url'];
    }
    $guest=guest();
    ensure_request_submitters();
    $candidate=active();
    if (!$candidate) err(409,'Requests are currently closed.');
    $id=(int)$candidate['id'];
    return tx(function() use($id,$guest,$title,$artist,$name,$note,$art,$store,$data){
        // Lock before the first snapshot read so simultaneous submissions see the latest limits and songs.
        sql('SELECT id FROM events WHERE id=? FOR UPDATE',[$id])->fetch();
        $event=active();
        if (!$event || !$event['requests_open']) err(409,'Requests are currently closed.');
        $expected=$data['event_id']??null;
        if ((int)$event['id']!==$id || ($expected!==null && $expected!==$id) || ($expected===null && isset($event['opens_at']))) err(409,'The event has changed. Refresh and try again.');
        rate(iphash(),'ip_submit',400,600);
        $song=sql('SELECT id,status FROM requests WHERE event_id=? AND norm_title=? AND norm_artist=? FOR UPDATE',[$id,norm($title),norm($artist)])->fetch();
        if ($song) {
            if (in_array($song['status'],['skipped','declined'],true)) return ['ok'=>true];
            $voted=false;
            if ($song['status']!=='played') {
                $voted=sql('INSERT IGNORE INTO votes(request_id,voter_key,created_at) VALUES(?,?,?)',[$song['id'],$guest,time()])->rowCount()>0;
            }
            return ['ok'=>true,'duplicate'=>true,'status'=>$song['status'],'voted'=>$voted];
        }
        $limit=$event['song_limit'];
        $minutes=$event['window_minutes'];
        $recent=(int)sql('SELECT COUNT(*) FROM requests r JOIN request_submitters s ON s.request_id=r.id
            WHERE r.event_id=? AND s.guest_key=? AND r.created_at>?',[$id,$guest,time()-60*$minutes])->fetchColumn();
        if ($recent >= $limit) err(429, 'Easy there, DJ! Give the booth a breather and let a few other guests pick a song. Try again in a bit.');
        if ((int)sql('SELECT COUNT(*) FROM requests WHERE event_id=? FOR UPDATE',[$id])->fetchColumn()>=500) err(409,'Request list is full.');
        sql('INSERT INTO requests(event_id,title,artist,requester_name,note,artwork_url,store_url,norm_title,norm_artist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [$id,$title,$artist,$name,$note,$art,$store,norm($title),norm($artist),time()]);
        $requestId=(int)db()->lastInsertId();
        sql('INSERT INTO request_submitters(request_id,guest_key) VALUES(?,?)',[$requestId,$guest]);
        sql('INSERT INTO votes(request_id,voter_key,created_at) VALUES(?,?,?)',[$requestId,$guest,time()]);
        queue_dj_push($requestId,$id,$event['name'],$title,$artist);
        return ['ok'=>true,'duplicate'=>false,'request_id'=>$requestId];
    });
}

function record_vote(int $requestId,array $data): array {
    $direction=$data['direction']??1;
    if (!in_array($direction,[-1,1],true)) err(400,'Choose an upvote or a downvote.');
    $guest=guest();
    return tx(function() use($requestId,$guest,$direction){
        rate($guest,'vote',30,600);
        rate(iphash(),'ip_vote',1000,600);
        $event=active();
        if (!$event || !$event['requests_open']) err(409,'Requests are closed.');
        if (!sql("SELECT id FROM requests WHERE id=? AND event_id=? AND status IN ('pending','accepted') FOR UPDATE",[$requestId,$event['id']])->fetch()) err(404,'Song unavailable.');
        $saved=sql('INSERT INTO votes(request_id,voter_key,created_at,direction) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE direction=?',
            [$requestId,$guest,time(),$direction,$direction]);
        return ['ok'=>true,'voted'=>$saved->rowCount()>0,'my_vote'=>$direction];
    });
}
