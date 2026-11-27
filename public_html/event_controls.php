<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

// Create the additive table only on an authenticated edit, outside its transaction.
function event_controls_available(): bool {
    try { sql('SELECT event_id FROM request_event_controls LIMIT 0'); return true; }
    catch (PDOException $e) {
        if ($e->getCode() === '42S02') return false;
        throw $e;
    }
}

function ensure_event_controls(): void {
    if (!event_controls_available()) {
        sql('CREATE TABLE IF NOT EXISTS request_event_controls (
            event_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            overrides_json TEXT NULL,
            song_limit SMALLINT UNSIGNED NOT NULL DEFAULT 6,
            window_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
            manual_paused TINYINT(1) NOT NULL DEFAULT 0,
            CONSTRAINT fk_controls_event FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    }
}

function effective_event(array $event): array {
    $event['planner_managed'] = isset($event['opens_at']);
    $overrides = json_decode($event['overrides_json'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
    $event['has_overrides'] = (bool)$overrides;
    // A booking cancelled or disabled in the planner must stop accepting requests.
    if ($event['planner_managed'] && !(int)$event['opens_at']) {
        unset($overrides['opens_at'], $overrides['closes_at']);
    }
    $event = array_replace($event, $overrides);
    $event['timezone'] ??= 'America/Chicago';
    $event['song_limit'] = (int)($event['song_limit'] ?? 6);
    $event['window_minutes'] = (int)($event['window_minutes'] ?? 10);
    $event['paused'] = (int)($event['paused'] ?? $event['manual_paused'] ?? 0);
    unset($event['overrides_json'], $event['manual_paused']);
    return $event;
}

function event_wall_time(mixed $value, string $timezone): int {
    if (!is_string($value)) err(400, 'Enter a valid local date and time.');
    $time = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, new DateTimeZone($timezone));
    if (!$time || $time->format('Y-m-d\TH:i') !== $value || $time->getTimestamp() <= 0) {
        err(400, 'Enter a valid date and time in the event timezone.');
    }
    return $time->getTimestamp();
}

function event_request_limits(array $data, int $limit=6, int $minutes=10): array {
    $limits = ['song_limit'=>$limit,'window_minutes'=>$minutes];
    foreach (['song_limit'=>500,'window_minutes'=>1440] as $key=>$max) {
        if (!array_key_exists($key,$data)) continue;
        if (!is_int($data[$key]) || $data[$key] < 1 || $data[$key] > $max) err(400, 'Enter a valid request limit and time window.');
        $limits[$key] = $data[$key];
    }
    return array_values($limits);
}

function change_event_controls(int $id, array $data): array {
    ensure_event_controls();
    $hasSchedule = request_schedule_available();
    return tx(function() use ($id, $data, $hasSchedule) {
        $base = sql('SELECT * FROM events WHERE id=? FOR UPDATE', [$id])->fetch();
        if (!$base) err(404, 'Event not found.');
        $schedule = $hasSchedule ? sql('SELECT * FROM planner_request_schedule WHERE event_id=? FOR UPDATE', [$id])->fetch() : false;
        sql('INSERT IGNORE INTO request_event_controls(event_id) VALUES(?)', [$id]);
        $controls = sql('SELECT * FROM request_event_controls WHERE event_id=? FOR UPDATE', [$id])->fetch();
        $base += $schedule ?: [];
        $event = effective_event($base + $controls);
        $overrides = json_decode($controls['overrides_json'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
        $changedHours = false;
        $action = $data['action'] ?? 'edit';
        if ($action === 'reset') {
            if (!$schedule) err(409, 'This event has no planner schedule.');
            $overrides = [];
        } elseif ($action === 'extend') {
            // Comparing the displayed end makes a double tap or a retried POST idempotent.
            if (empty($event['closes_at']) || $base['archived']) err(409, 'Set request hours before extending this event.');
            if (($data['previous_end'] ?? null) !== (int)$event['closes_at']) err(409, 'The end time changed. Refresh the queue to see the current hours.');
            $overrides['closes_at'] = (int)$event['closes_at'] + 3600;
            $changedHours = true;
        } elseif ($action === 'edit') {
            $details = automation_fields(array_intersect_key($data, array_flip(['name','date','venue'])), false);
            if ($details && !$schedule) automation_update($id, $details);
            if ($schedule) $overrides = array_replace($overrides, $details);
            [$event['song_limit'],$event['window_minutes']] = event_request_limits($data,$event['song_limit'],$event['window_minutes']);
            foreach (['opens_at','closes_at'] as $key) {
                if (!array_key_exists($key, $data)) continue;
                if ($schedule && !$schedule['opens_at']) err(409, 'Request hours are disabled in the planner.');
                if ($data[$key] === '' && !$schedule) unset($overrides[$key]);
                else $overrides[$key] = event_wall_time($data[$key], $event['timezone']);
                $changedHours = true;
            }
        } else err(400, 'Unknown event edit.');
        if ($changedHours) {
            $open = $overrides['opens_at'] ?? $schedule['opens_at'] ?? null;
            $end = $overrides['closes_at'] ?? $schedule['closes_at'] ?? null;
            if (($open || $end) && (!$open || $end <= $open)) err(400, 'Enter both request times, with closing after opening.');
        }
        sql('UPDATE request_event_controls SET overrides_json=?,song_limit=?,window_minutes=? WHERE event_id=?',
            [$overrides ? json_encode($overrides, JSON_THROW_ON_ERROR) : null,$event['song_limit'],$event['window_minutes'],$id]);
        return ['ok'=>true];
    });
}
