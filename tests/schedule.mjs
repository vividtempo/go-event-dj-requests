// Run with PHP_WASM_DIR pointing to node_modules containing @php-wasm/node and universal.
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const runtime=resolve(process.env.PHP_WASM_DIR||'node_modules');
const {PHP}=await import(pathToFileURL(resolve(runtime,'@php-wasm/universal/index.js')));
const {loadNodeRuntime}=await import(pathToFileURL(resolve(runtime,'@php-wasm/node/index.js')));
const php=new PHP(await loadNodeRuntime('8.3',{emscriptenOptions:{processId:7}}));
const read=(p)=>readFileSync(new URL('../public_html/'+p,import.meta.url),'utf8');
php.mkdir('/app');
for(const f of ['schedule.php','automation.php','catalog.php','request_queue.php'])php.writeFile('/app/'+f,read(f));
php.writeFile('/app/guest_links.php','<?php function guest_links():array{return [];}');
const mockDb="function db():PDO{static $db;if(!$db)$db=new PDO('sqlite:/app/fixture.db',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);return $db;}";
const index=read('index.php').replace(/^function db\(\):PDO[^\n]+/m,mockDb).replace("function sql(string $q,array $args=[]):PDOStatement{","function sql(string $q,array $args=[]):PDOStatement{\$q=str_replace([' FOR UPDATE','INSERT IGNORE','ON DUPLICATE KEY UPDATE last_seen=?','ON DUPLICATE KEY UPDATE direction=?'],['','INSERT OR IGNORE','ON CONFLICT(event_id,guest_key) DO UPDATE SET last_seen=?','ON CONFLICT(request_id,voter_key) DO UPDATE SET direction=? WHERE direction<>excluded.direction'],\$q);");
// The production adapter uses InnoDB. Preseed its SQLite equivalent and bypass the equivalent DDL.
const schedule=read('schedule.php').replace(/function request_schedule_schema\(\): void \{[\s\S]*?\n\}/,'function request_schedule_schema(): void {}');
php.writeFile('/app/schedule.php',schedule);
php.writeFile('/app/index.php',index);
const key='gedj_'+'b'.repeat(64);
const dj='a'.repeat(64);
const setup=await php.run({code:`<?php
${mockDb}
$db=db();
$db->exec("CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT,event_date TEXT,venue TEXT,created_at INTEGER,is_active INTEGER DEFAULT 0,requests_open INTEGER DEFAULT 0,archived INTEGER DEFAULT 0);
CREATE TABLE automation_settings(id INTEGER PRIMARY KEY,token_hash TEXT);
CREATE TABLE automation_event_links(external_id TEXT PRIMARY KEY,event_id INTEGER UNIQUE);
CREATE TABLE planner_request_schedule(event_id INTEGER PRIMARY KEY,opens_at INTEGER DEFAULT 0,closes_at INTEGER DEFAULT 0,timezone TEXT,source_revision INTEGER,paused INTEGER DEFAULT 0);
CREATE TABLE rate_events(id INTEGER PRIMARY KEY,actor_hash TEXT,action TEXT,created_at INTEGER);
CREATE TABLE admin_sessions(token_hash TEXT,csrf_token TEXT,expires_at INTEGER);
CREATE TABLE settings(id INTEGER,tip_url TEXT,review_url TEXT,booking_url TEXT,contact_url TEXT);
CREATE TABLE requests(id INTEGER PRIMARY KEY,event_id INTEGER,title TEXT,artist TEXT,note TEXT,norm_title TEXT,norm_artist TEXT,created_at INTEGER,status TEXT DEFAULT 'pending',requester_name TEXT,artwork_url TEXT,store_url TEXT);
CREATE TABLE votes(request_id INTEGER,voter_key TEXT,created_at INTEGER,direction INTEGER DEFAULT 1,PRIMARY KEY(request_id,voter_key));
CREATE TABLE guest_presence(event_id INTEGER,guest_key TEXT,last_seen INTEGER,PRIMARY KEY(event_id,guest_key));");
$db->prepare("INSERT INTO automation_settings VALUES(1,?)")->execute([hash('sha256','${key}')]);
$db->prepare("INSERT INTO admin_sessions VALUES(?,'fixture-csrf',?)")->execute([hash('sha256','${dj}'),time()+600]);
$db->exec("ALTER TABLE events ADD COLUMN genres TEXT;
INSERT INTO events(id,name,event_date,venue,created_at,is_active,requests_open,archived) VALUES(7,'Legacy queue','2027-12-30','Hall',1,0,0,0);
INSERT INTO requests(id,event_id,title,artist,note,norm_title,norm_artist,created_at,status) VALUES(40,7,'Old Song','An Artist','','old song','an artist',1,'pending');");
mkdir('/private');file_put_contents('/private/config.php','<?php return '.var_export(['base_url'=>'https://requests.goeventdj.com','app_secret'=>str_repeat('s',32),'admin_password_hash'=>password_hash('test-only',PASSWORD_DEFAULT)],true).';');`});
assert.equal(setup.errors,'');
async function req(url,method='GET',data,headers={}) {
    const r=await php.run({scriptPath:'/app/index.php',relativeUri:url,method,
        headers:{Host:'requests.goeventdj.com',Cookie:'dj_admin='+dj,'X-CSRF-Token':'fixture-csrf','Content-Type':'application/json',...headers},
        body:data===undefined?undefined:new TextEncoder().encode(JSON.stringify(data)),
        $_SERVER:{REQUEST_URI:url,REQUEST_METHOD:method,HTTPS:'on',SERVER_PORT:'443',HTTP_HOST:'requests.goeventdj.com',REMOTE_ADDR:'192.0.2.15'}});
    assert.equal(r.errors,'',r.errors);
    return {status:r.httpStatusCode,data:JSON.parse(r.text)};
}
try {
// Exercise the same PHP entry points Cloudways serves, including the authenticated QR sign.
php.mkdir('/app/static');
php.mkdir('/app/static/vendor');
const templates = new URL('../public_html/static/', import.meta.url);
for (const file of readdirSync(templates).filter(name => /\.(html|css|js)$/.test(name))) {
    php.writeFile('/app/static/'+file, read('static/'+file));
}
php.writeFile('/app/static/vendor/lottie_light.min.js', read('static/vendor/lottie_light.min.js'));
const css = read('static/style.css');
for (const theme of [css, css+'\n/* test updated theme */']) {
    php.writeFile('/app/static/style.css', theme);
    const hash = createHash('sha256').update(theme).digest('hex').slice(0, 12);
    for (const route of ['/requests', '/admin', '/qr']) {
        const page = await php.run({scriptPath:'/app/index.php', relativeUri:route, headers:{Cookie:'dj_admin='+dj},
            $_SERVER:{REQUEST_URI:route, REQUEST_METHOD:'GET'}});
        assert.equal(page.errors, '');
        assert.equal(page.httpStatusCode, 200);
        const styles = [...page.text.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
        assert.deepEqual(styles, ['/static/style.css?v='+hash]);
        if (route !== '/qr') assert.match(page.text, /src="\/static\/tracks\.js\?v=[a-f0-9]{12}"/);
    }
}
const base='/api/v1/events/planner-sync', now=Math.floor(Date.now()/1000);
const details={external_id:'planner:'+'1'.repeat(32),name:'Planner party',date:'2027-12-31',venue:'Hall',timezone:'America/Chicago',opens_at:now+3600,closes_at:now+7200,source_revision:1,target_event_id:7,genres:['Dance / Electronic','House Music']};
const sync=async data=>req(base,'POST',data,{'X-API-Key':key});
assert.equal((await req(base,'POST',details)).status,401);
assert.equal((await req('/api/admin/events/7/action','POST',{action:'activate'})).status,200);
assert.equal((await req('/api/board')).data.state,'open');
assert.equal((await req('/api/board')).data.event.id,7);
const otherManual=await req('/api/admin/events','POST',{name:'Second manual queue'});
const otherAction='/api/admin/events/'+otherManual.data.id+'/action';
assert.equal((await req(otherAction,'POST',{action:'activate'})).status,200);
assert.equal((await req('/api/board')).data.event.id,otherManual.data.id);
assert.equal((await req('/api/board')).data.state,'open');
assert.equal((await req('/api/admin/events')).data.events.find(event=>event.id===7).requests_open,0);
await req(otherAction,'POST',{action:'close'});
assert.equal((await req('/api/board')).data.state,'closed');
await req(otherAction,'POST',{action:'deactivate'});
const linked=await sync(details);
assert.equal(linked.status,200);
assert.equal(linked.data.event.id,7);
assert.equal(linked.data.event.opens_at,details.opens_at);
assert.equal((await req('/api/admin/events/7/requests')).data.requests[0].title,'Old Song');
assert.equal((await req('/api/board')).data.state,'none');
assert.equal((await req('/api/admin/events/7/action','POST',{action:'activate'})).status,409);
const live={...details,source_revision:2,opens_at:now-120,closes_at:now+120};
assert.equal((await sync(live)).data.event.id,7);
assert.deepEqual((await req('/api/board')).data.event.genres,live.genres);
assert.equal((await req('/api/requests','POST',{event_id:8,title:'Wrong',artist:'Artist'})).status,409);
assert.equal((await req('/api/requests','POST',{event_id:7,title:'New Song',artist:'Artist'})).status,200);
assert.equal((await req('/api/admin/events/7/action','POST',{action:'close'})).status,200);
assert.equal((await req('/api/board')).data.state,'closed');
assert.equal((await sync({...live,source_revision:3,name:'Updated Label'})).data.event.id,7);
assert.equal((await req('/api/board')).data.state,'closed');
assert.equal((await sync(live)).status,409);
await req('/api/admin/events/7/action','POST',{action:'open'});
assert.equal((await req('/api/board')).data.state,'open');
await req('/api/admin/events/7/action','POST',{action:'auto'});
const second={...live,external_id:'planner:'+'2'.repeat(32),target_event_id:null};
const next=await sync(second);
assert.equal(next.status,201);
assert.equal((await sync(second)).data.event.id,next.data.event.id);
assert.equal((await req('/api/admin/events')).data.schedule_conflict,true);
assert.equal((await req('/api/board')).data.state,'none');
assert.equal((await req('/api/admin/events/7/action','POST',{action:'activate'})).status,200);
assert.equal((await req('/api/board')).data.event.id,7);
assert.equal((await req('/api/board')).data.state,'open');
await sync({...live,source_revision:4,opens_at:now-500,closes_at:now-100});
assert.equal((await req('/api/board')).data.event.id,next.data.event.id);
assert.equal((await sync({...second,source_revision:3,opens_at:0,closes_at:0})).status,200);
assert.equal((await req('/api/board')).data.state,'none');
assert.equal((await req('/api/admin/events/7/requests')).data.requests.length,2);
await req('/api/admin/events/7/action','POST',{action:'auto'});
await sync({...live,source_revision:5});
const guestHeaders={Cookie:'dj_guest_id='+'c'.repeat(64)};
const vote=direction=>req('/api/requests/40/vote','POST',{direction},guestHeaders);
assert.equal((await vote(1)).data.my_vote,1);
assert.equal((await vote(-1)).data.my_vote,-1);
assert.equal((await vote(-1)).data.voted,false);
assert.equal((await req('/api/board','GET',undefined,guestHeaders)).data.requests.find(s=>s.id===40).votes,-1);
for(const state of ['accepted','played','declined']) {
    await req('/api/admin/requests/40/status','POST',{status:state});
    const publicSong=(await req('/api/board')).data.requests.find(s=>s.id===40);
    if(state==='declined') assert.equal(publicSong,undefined);
    else { assert.equal(publicSong.status,state);assert.ok(!('note' in publicSong)&&!('requester_name' in publicSong)); }
}
assert.equal((await vote(1)).status,404);
assert.deepEqual((await req('/api/requests','POST',{title:'Old Song',artist:'An Artist',event_id:7})).data,{ok:true});
assert.equal((await req('/api/admin/events/7/requests')).data.requests.find(s=>s.id===40).status,'declined');
console.log('Requests schedule tests passed (SQLite adapter, production MySQL SQL requires deployment smoke test).');
} finally { php.exit(); }
