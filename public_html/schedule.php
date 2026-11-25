<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

function request_schedule_available(): bool {
    try { sql('SELECT event_id FROM planner_request_schedule WHERE 1=0'); return true; }
    catch (PDOException $e) {
        if (in_array($e->getCode(), ['42S02'], true)) return false;
        throw $e;
    }
}

function request_schedule_schema(): void {
    sql('CREATE TABLE IF NOT EXISTS planner_request_schedule (
        event_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        opens_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
        closes_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
        timezone VARCHAR(64) NOT NULL,
        source_revision BIGINT UNSIGNED NOT NULL,
        paused TINYINT(1) NOT NULL DEFAULT 0,
        INDEX idx_planner_window (opens_at, closes_at),
        CONSTRAINT fk_planner_schedule_event FOREIGN KEY(event_id) REFERENCES events(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

function scheduled_window(array $event, int $now): bool {
    return (int)($event['opens_at'] ?? 0)>0 && (int)$event['opens_at']<=$now && $now<(int)$event['closes_at'];
}

function choose_request_event(array $events, int $now): array {
    $scheduled=[];
    $closedManual=null;
    foreach ($events as $event) {
        if ($event['archived']) continue;
        $managed=isset($event['opens_at']);
        if ($managed && !scheduled_window($event,$now)) continue;
        if ($event['is_active']) {
            if (!$managed&&!$event['requests_open']) { $closedManual??=$event; continue; }
            if ($managed) $event['requests_open']=(int)$event['requests_open'] && !(int)$event['paused'];
            return ['event'=>$event,'conflict'=>false];
        }
        if ($managed) $scheduled[]=$event;
    }
    if (count($scheduled)!==1) return ['event'=>count($scheduled)>1?null:$closedManual,'conflict'=>count($scheduled)>1];
    $event=$scheduled[0];
    $event['requests_open']=!(int)$event['paused'];
    return ['event'=>$event,'conflict'=>false];
}

function request_schedule_rows(bool $all=false, ?int $now=null): array {
    if (!request_schedule_available()) return sql($all
        ? 'SELECT * FROM events ORDER BY created_at DESC,id DESC'
        : 'SELECT * FROM events WHERE archived=0 AND is_active=1 ORDER BY id')->fetchAll();
    $base='SELECT e.*,s.opens_at,s.closes_at,s.timezone,s.paused FROM events e LEFT JOIN planner_request_schedule s ON s.event_id=e.id';
    if ($all) return sql($base.' ORDER BY created_at DESC,id DESC')->fetchAll();
    $now??=time();
    return sql($base.' WHERE e.archived=0 AND (e.is_active=1 OR (s.opens_at>0 AND s.opens_at<=? AND s.closes_at>?)) ORDER BY e.id',[$now,$now])->fetchAll();
}

function validate_planner_schedule(array $data): array {
    $opens=$data['opens_at']??null;
    $closes=$data['closes_at']??null;
    $rev=$data['source_revision']??null;
    $zone=$data['timezone']??null;
    if (!is_int($opens)||!is_int($closes)||!is_int($rev)||$rev<1||!is_string($zone)||strlen($zone)>64
        ||!in_array($zone,DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true)
        || !(($opens===0 && $closes===0)||($opens>0 && $closes>$opens && $closes-$opens<=26*3600))) {
        err(400,'Send a valid opening and closing window, timezone, and planner revision.');
    }
    return [$opens,$closes,$zone,$rev];
}

function upsert_planner_schedule(string $external, ?int $target, array $fields, array $window): array {
    $linked=(int)sql('SELECT event_id FROM automation_event_links WHERE external_id=?',[$external])->fetchColumn();
    if ($linked && $target!==null && $target!==$linked) err(409,'This planner booking is already linked to another request event.');
    $id=$linked ?: $target;
    if ($id) {
        $event=sql('SELECT id,archived FROM events WHERE id=? FOR UPDATE',[$id])->fetch();
        if (!$event) err(404,'The existing song request event was not found.');
        $other=sql('SELECT external_id FROM automation_event_links WHERE event_id=?',[$id])->fetchColumn();
        if ($other && $other!==$external) err(409,'That request event is already linked to another booking.');
        if ($event['archived'] && $window[0]>0) err(409,'Restore the request event before scheduling it.');
    } elseif ($window[0]===0) {
        return ['created'=>false,'event'=>null];
    }
    $created=!$id;
    if ($created) {
        sql('INSERT INTO events(name,event_date,venue,created_at) VALUES(?,?,?,?)',[$fields['name'],$fields['event_date'],$fields['venue'],time()]);
        $id=(int)db()->lastInsertId();
    }
    $current=sql('SELECT source_revision FROM planner_request_schedule WHERE event_id=?',[$id])->fetchColumn();
    if ($current!==false && (int)$current>$window[3]) err(409,'This request event already has a newer booking schedule.');
    if (!$linked) sql('INSERT INTO automation_event_links(external_id,event_id) VALUES(?,?)',[$external,$id]);
    if (!$created) automation_update($id,$fields);
    if ($current===false) {
        // Reset manual legacy flags when explicitly converting that queue to scheduled mode.
        sql('UPDATE events SET is_active=0,requests_open=0 WHERE id=?',[$id]);
        sql('INSERT INTO planner_request_schedule(event_id,opens_at,closes_at,timezone,source_revision) VALUES(?,?,?,?,?)',[$id,...$window]);
    } else {
        sql('UPDATE planner_request_schedule SET opens_at=?,closes_at=?,timezone=?,source_revision=? WHERE event_id=?',[...$window,$id]);
    }
    return ['created'=>$created,'event'=>automation_event($id)];
}
