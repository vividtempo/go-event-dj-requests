<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://api.qrserver.com https://*.mzstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
$path=parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH)?:'/'; $method=$_SERVER['REQUEST_METHOD']??'GET';
if(str_starts_with($path,'/api/')) header('Cache-Control: no-store');
function err(int $code,string $msg):never{http_response_code($code);header('Content-Type: application/json');echo json_encode(['detail'=>$msg]);exit;}
function out(array $v):never{header('Content-Type: application/json');echo json_encode($v,JSON_INVALID_UTF8_SUBSTITUTE);exit;}
function conf():array{static $c;if($c===null){$p=dirname(__DIR__).'/private/config.php';if(!is_file($p))err(503,'Configuration missing.');$c=require $p;if(!is_array($c)||strlen($c['app_secret']??'')<32||!str_starts_with($c['admin_password_hash']??'','$'))err(503,'Configuration incomplete.');}return $c;}
function db():PDO{static $db;if(!$db){$c=conf();$db=new PDO("mysql:host={$c['db_host']};port=".($c['db_port']??3306).";dbname={$c['db_name']};charset=utf8mb4",$c['db_user'],$c['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);}return $db;}
function sql(string $q,array $args=[]):PDOStatement{$s=db()->prepare($q);$s->execute($args);return $s;}
function tx(callable $f):mixed{$d=db();$d->beginTransaction();try{$v=$f();$d->commit();return $v;}catch(Throwable $e){if($d->inTransaction())$d->rollBack();throw $e;}}
function input():array{$raw=file_get_contents('php://input');if(strlen($raw)>8192)err(413,'Request too large.');$v=json_decode($raw?:'{}',true);if(!is_array($v))err(400,'Invalid JSON.');return $v;}
function clean(mixed $v,int $max,bool $required=true):string{if(!is_string($v))err(400,'Invalid input.');$v=trim(preg_replace('/\s+/u',' ',$v)??'');if(($required&&$v==='')||preg_match('/[\x00-\x1F\x7F]/u',$v)||(function_exists('mb_strlen')?mb_strlen($v)>$max:strlen($v)>$max))err(400,'Invalid text length.');return $v;}
function norm(string $v):string{$v=function_exists('mb_strtolower')?mb_strtolower($v,'UTF-8'):strtolower($v);if(class_exists('Normalizer'))$v=Normalizer::normalize($v,Normalizer::FORM_KC)?:$v;return trim(preg_replace('/\s+/u',' ',$v)??$v);}
function https():bool{return isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off';}
function guest():string{$v=$_COOKIE['dj_guest_id']??'';if(!is_string($v)||!preg_match('/^[a-f0-9]{64}$/',$v)){$v=bin2hex(random_bytes(32));setcookie('dj_guest_id',$v,['expires'=>time()+31536000,'path'=>'/','secure'=>https(),'httponly'=>true,'samesite'=>'Lax']);}return hash('sha256','guest:'.$v);}
function iphash():string{return hash_hmac('sha256',$_SERVER['REMOTE_ADDR']??'unknown',conf()['app_secret']);}
function rate(string $who,string $action,int $limit,int $window):void{if((int)sql('SELECT COUNT(*) FROM rate_events WHERE actor_hash=? AND action=? AND created_at>=?',[$who,$action,time()-$window])->fetchColumn()>=$limit)err(429,'Too many actions. Try again later.');sql('INSERT INTO rate_events(actor_hash,action,created_at) VALUES(?,?,?)',[$who,$action,time()]);}
function active():?array{$now=time();return choose_request_event(request_schedule_rows(false,$now),$now)['event'];}
function admin(bool $write=false):string{$token=$_COOKIE['dj_admin']??'';if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/',$token))err(401,'Sign in as DJ.');$r=sql('SELECT csrf_token,expires_at FROM admin_sessions WHERE token_hash=?',[hash('sha256',$token)])->fetch();if(!$r||$r['expires_at']<=time())err(401,'Session expired.');if($write&&!hash_equals($r['csrf_token'],$_SERVER['HTTP_X_CSRF_TOKEN']??''))err(403,'Invalid security token.');return $r['csrf_token'];}
function links():array{$links=sql('SELECT booking_url,contact_url,tip_url,review_url FROM settings WHERE id=1')->fetch()?:['tip_url'=>'','review_url'=>''];$links['custom_links']=guest_links();return $links;}
function safeurl(mixed $v):string{if(!is_string($v)||strlen($v)>500)err(400,'Invalid link.');$v=trim($v);if($v==='')return ''; $p=parse_url($v);if(!$p||($p['scheme']??'')!=='https'||empty($p['host'])||isset($p['user'])||isset($p['pass']))err(400,'Use an HTTPS link.');return $v;}
try{
require __DIR__.'/guest_links.php';
require __DIR__.'/schedule.php';
require __DIR__.'/automation.php';
require __DIR__.'/catalog.php';
require __DIR__.'/request_queue.php';
if($path==='/'&&$method==='GET'){header('Location: /requests',true,307);exit;}
if($method==='GET'&&in_array($path,['/requests','/admin','/qr'],true)){if($path==='/qr')admin();$file=['/requests'=>'guest.html','/admin'=>'admin.html','/qr'=>'qr.html'][$path];header('Content-Type: text/html; charset=utf-8');readfile(__DIR__.'/static/'.$file);exit;}
if ($path==='/api/board' && $method==='GET') out(request_board());
if ($path==='/api/requests' && $method==='POST') out(submit_request(input()));
if ($method==='POST' && preg_match('#^/api/requests/(\d+)/vote$#',$path,$m)) out(record_vote((int)$m[1],input()));
if($path==='/api/admin/login'&&$method==='POST'){$d=input();$pass=$d['password']??null;if(!is_string($pass)||strlen($pass)>256)err(400,'Invalid password.');tx(fn()=>rate(iphash(),'login',8,900));if(!password_verify($pass,conf()['admin_password_hash']))err(401,'Incorrect password.');$token=bin2hex(random_bytes(32));$csrf=bin2hex(random_bytes(32));sql('INSERT INTO admin_sessions(token_hash,csrf_token,expires_at) VALUES(?,?,?)',[hash('sha256',$token),$csrf,time()+28800]);setcookie('dj_admin',$token,['expires'=>time()+28800,'path'=>'/','secure'=>https(),'httponly'=>true,'samesite'=>'Strict']);out(['ok'=>true,'csrf'=>$csrf]);}
if($path==='/api/admin/me'&&$method==='GET')out(['authenticated'=>true,'csrf'=>admin()]);
if($path==='/api/admin/logout'&&$method==='POST'){admin(true);sql('DELETE FROM admin_sessions WHERE token_hash=?',[hash('sha256',$_COOKIE['dj_admin'])]);setcookie('dj_admin','',['expires'=>1,'path'=>'/','secure'=>https(),'httponly'=>true,'samesite'=>'Strict']);out(['ok'=>true]);}
if($path==='/api/admin/events'&&$method==='GET'){
    admin();$now=time();$r=request_schedule_rows(true);$live=choose_request_event($r,$now);
    foreach($r as &$e){
        foreach(['id','created_at','archived'] as $k)$e[$k]=(int)$e[$k];
        $e['scheduled']=isset($e['opens_at']);
        $e['in_window']=$e['scheduled']&&scheduled_window($e,$now);
        $e['is_active']=(int)($live['event']&&(int)$live['event']['id']===$e['id']);
        $e['requests_open']=$e['is_active']?(int)$live['event']['requests_open']:0;
    }
    unset($e);out(['events'=>$r,'schedule_conflict'=>$live['conflict']]);
}
if($path==='/api/admin/events'&&$method==='POST'){admin(true);$d=input();$name=clean($d['name']??null,120);$date=$d['date']??'';$venue=clean($d['venue']??'',160,false);if(!is_string($date)||($date!==''&&!preg_match('/^\d{4}-\d{2}-\d{2}$/',$date)))err(400,'Invalid date.');sql('INSERT INTO events(name,event_date,venue,created_at) VALUES(?,?,?,?)',[$name,$date,$venue,time()]);out(['ok'=>true,'id'=>(int)db()->lastInsertId()]);}
if($method==='POST'&&preg_match('#^/api/admin/events/(\d+)/action$#',$path,$m)){
    admin(true);$action=input()['action']??'';$id=(int)$m[1];$hasSchedule=request_schedule_available();
    tx(function()use($id,$action,$hasSchedule){
        sql('SELECT id FROM events ORDER BY id FOR UPDATE');
        $e=sql('SELECT * FROM events WHERE id=?',[$id])->fetch();
        if(!$e)err(404,'Event not found.');
        $schedule=$hasSchedule?sql('SELECT * FROM planner_request_schedule WHERE event_id=?',[$id])->fetch():false;
        if($schedule){
            if(in_array($action,['activate','open'],true)&&($e['archived']||!scheduled_window($schedule,time())))err(409,'This event is outside its Planner request hours.');
            if(in_array($action,['activate','open','close','deactivate','auto'],true)){
                if(in_array($action,['activate','open'],true)){
                    sql('UPDATE events SET is_active=0,requests_open=0 WHERE is_active=1');
                    sql('UPDATE events SET is_active=1,requests_open=1 WHERE id=?',[$id]);
                } elseif($action==='deactivate'||$action==='auto'){
                    sql('UPDATE events SET is_active=0,requests_open=0 WHERE id=?',[$id]);
                } else {
                    sql('UPDATE events SET requests_open=0 WHERE id=?',[$id]);
                }
                sql('UPDATE planner_request_schedule SET paused=? WHERE event_id=?',[in_array($action,['activate','open','auto'],true)?0:1,$id]);
                return;
            }
        }
        switch($action){
            case 'activate':if($e['archived'])err(409,'Restore event first.');sql('UPDATE events SET is_active=0,requests_open=0 WHERE is_active=1');sql('UPDATE events SET is_active=1,requests_open=1 WHERE id=?',[$id]);break;
            case 'deactivate':sql('UPDATE events SET is_active=0,requests_open=0 WHERE id=?',[$id]);break;
            case 'open':if(!$e['is_active']||$e['archived'])err(409,'Activate event first.');sql('UPDATE events SET requests_open=1 WHERE id=?',[$id]);break;
            case 'close':sql('UPDATE events SET requests_open=0 WHERE id=?',[$id]);break;
            case 'archive':sql('UPDATE events SET archived=1,is_active=0,requests_open=0 WHERE id=?',[$id]);break;
            case 'restore':sql('UPDATE events SET archived=0 WHERE id=?',[$id]);break;
            default:err(400,'Unknown action.');
        }
    });out(['ok'=>true]);
}
if ($method==='GET' && preg_match('#^/api/admin/events/(\d+)/requests$#',$path,$m)) {
    admin();
    $id=(int)$m[1];
    if (!sql('SELECT id FROM events WHERE id=?',[$id])->fetch()) err(404,'Event not found.');
    out(['requests'=>queue_rows($id),'active_guests'=>count_active_guests($id)]);
}
if ($method==='POST' && preg_match('#^/api/admin/requests/(\d+)/status$#',$path,$m)) {
    admin(true);
    $status=input()['status']??'';
    if ($status==='skipped') $status='declined';
    if (!in_array($status,['pending','accepted','played','declined'],true)) err(400,'Invalid status.');
    sql('UPDATE requests SET status=? WHERE id=?',[$status,(int)$m[1]]);
    out(['ok'=>true]);
}
if($path==='/api/admin/settings'&&$method==='GET'){admin();guest_links_schema();out(links());}
if($path==='/api/admin/settings'&&$method==='POST'){admin(true);$d=input();$tip=safeurl($d['tip_url']??'');$review=safeurl($d['review_url']??'');$booking=array_key_exists('booking_url',$d)?safeurl($d['booking_url']):null;
    $contact=array_key_exists('contact_url',$d)?safeurl($d['contact_url']):null;
    $custom=array_key_exists('custom_links',$d)?validate_guest_links($d['custom_links']):null;guest_links_schema();tx(function()use($tip,$review,$custom,$booking,$contact){sql('UPDATE settings SET tip_url=?,review_url=?,booking_url=COALESCE(?,booking_url),contact_url=COALESCE(?,contact_url) WHERE id=1',[$tip,$review,$booking,$contact]);if($custom!==null){sql('DELETE FROM guest_links');foreach($custom as $i=>$link)sql('INSERT INTO guest_links(position,label,url) VALUES(?,?,?)',[$i,$link['label'],$link['url']]);}});out(['ok'=>true]);}
if(($path==='/api/admin/qr-link'||$path==='/api/admin/qr.png')&&$method==='GET'){admin();$base=rtrim(conf()['base_url']??'','/');if(!$base)$base=(https()?'https':'http').'://'.($_SERVER['HTTP_HOST']??'localhost');$url=$base.'/requests';if($path==='/api/admin/qr.png'){header('Location: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data='.rawurlencode($url),true,302);exit;}out(['url'=>$url,'is_configured'=>!empty(conf()['base_url'])]);}
err(404,'Not found.');
}catch(Throwable $e){error_log('Go Event DJ app error: '.$e->getMessage());err(503,'Application or database unavailable.');}
