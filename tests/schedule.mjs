// Run with PHP_WASM_DIR pointing to node_modules containing @php-wasm/node and universal.
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {testDjPush} from './dj-push.mjs';
const runtime=resolve(process.env.PHP_WASM_DIR||'node_modules');
const {PHP,loadPHPRuntime}=await import(pathToFileURL(resolve(runtime,'@php-wasm/universal/index.js')));
const {getPHPLoaderModule}=await import(pathToFileURL(resolve(runtime,'@php-wasm/node/index.js')));
const php=new PHP(await loadPHPRuntime(await getPHPLoaderModule('8.3'),{processId:7}));
const read=(p)=>readFileSync(new URL('../public_html/'+p,import.meta.url),'utf8');
php.mkdir('/app');
// The WASM filesystem lacks the OpenSSL configuration provided by a normal PHP installation.
php.mkdir('/root/install/ssl');
php.writeFile('/root/install/ssl/openssl.cnf','[req]\ndefault_bits=2048\ndistinguished_name=req_dn\n[req_dn]\n');
for(const f of ['event_controls.php','schedule.php','automation.php','catalog.php','request_queue.php','dj_push.php'])php.writeFile('/app/'+f,read(f));
php.writeFile('/app/guest_links.php','<?php function guest_links():array{return [];}');
const mockDb="function db():PDO{static $db;if(!$db)$db=new PDO('sqlite:/app/fixture.db',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);return $db;}";
const index=read('index.php').replace(/^function db\(\):PDO[^\n]+/m,mockDb).replace("function sql(string $q,array $args=[]):PDOStatement{","function sql(string $q,array $args=[]):PDOStatement{\$q=str_replace([' FOR UPDATE','INSERT IGNORE','ON DUPLICATE KEY UPDATE last_seen=?','ON DUPLICATE KEY UPDATE direction=?','ON DUPLICATE KEY UPDATE p256dh=?,auth_key=?'],['','INSERT OR IGNORE','ON CONFLICT(event_id,guest_key) DO UPDATE SET last_seen=?','ON CONFLICT(request_id,voter_key) DO UPDATE SET direction=? WHERE direction<>excluded.direction','ON CONFLICT(id) DO UPDATE SET p256dh=?,auth_key=?'],\$q);");
// The production adapter uses InnoDB. Preseed its SQLite equivalent and bypass the equivalent DDL.
const schedule=read('schedule.php').replace(/function request_schedule_schema\(\): void \{[\s\S]*?\n\}/,'function request_schedule_schema(): void {}');
php.writeFile('/app/schedule.php',schedule);
// Capture only the provider HTTP operation. Real signing, encryption, queue and subscription routes still run.
const push=read('dj_push.php').replace(/    \$ch=curl_init\(\$endpoint\);[\s\S]*?return \(int\)curl_getinfo\(\$ch,CURLINFO_RESPONSE_CODE\);/,
    "    file_put_contents('/deliveries',json_encode(['id'=>$device['id'],'auth'=>$auth,'body'=>base64_encode($body)]).PHP_EOL,FILE_APPEND); return is_file('/push-status') ? (int)file_get_contents('/push-status') : 201;");
assert.ok(push.includes("'/deliveries'"));
php.writeFile('/app/dj_push.php',push);
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
CREATE TABLE request_event_controls(event_id INTEGER PRIMARY KEY,overrides_json TEXT,song_limit INTEGER DEFAULT 6,window_minutes INTEGER DEFAULT 10,manual_paused INTEGER DEFAULT 0);
CREATE TABLE dj_push_config(id INTEGER PRIMARY KEY,private_pem TEXT,public_key TEXT,token_cache TEXT);
CREATE TABLE dj_push_devices(id TEXT PRIMARY KEY,endpoint TEXT,p256dh TEXT,auth_key TEXT);
CREATE TABLE dj_push_outbox(request_id INTEGER,device_id TEXT REFERENCES dj_push_devices(id) ON DELETE CASCADE,payload TEXT,expires_at INTEGER,available_at INTEGER,PRIMARY KEY(request_id,device_id));
CREATE TABLE rate_events(id INTEGER PRIMARY KEY,actor_hash TEXT,action TEXT,created_at INTEGER);
CREATE TABLE admin_sessions(token_hash TEXT,csrf_token TEXT,expires_at INTEGER);
CREATE TABLE settings(id INTEGER,tip_url TEXT,review_url TEXT,booking_url TEXT,contact_url TEXT);
CREATE TABLE requests(id INTEGER PRIMARY KEY,event_id INTEGER,title TEXT,artist TEXT,note TEXT,norm_title TEXT,norm_artist TEXT,created_at INTEGER,status TEXT DEFAULT 'pending',requester_name TEXT,artwork_url TEXT,store_url TEXT);
CREATE TABLE request_submitters(request_id INTEGER PRIMARY KEY,guest_key TEXT NOT NULL);
CREATE TABLE votes(request_id INTEGER,voter_key TEXT,created_at INTEGER,direction INTEGER DEFAULT 1,PRIMARY KEY(request_id,voter_key));
CREATE TABLE guest_presence(event_id INTEGER,guest_key TEXT,last_seen INTEGER,PRIMARY KEY(event_id,guest_key));");
$db->prepare("INSERT INTO automation_settings VALUES(1,?)")->execute([hash('sha256','${key}')]);
$db->prepare("INSERT INTO admin_sessions VALUES(?,'fixture-csrf',?)")->execute([hash('sha256','${dj}'),time()+600]);
$db->exec("ALTER TABLE events ADD COLUMN genres TEXT;
INSERT INTO events(id,name,event_date,venue,created_at,is_active,requests_open,archived) VALUES(7,'Legacy queue','2027-12-30','Hall',1,0,0,0);
INSERT INTO requests(id,event_id,title,artist,note,norm_title,norm_artist,created_at,status) VALUES(40,7,'Old Song','An Artist','','old song','an artist',1,'pending');");
mkdir('/private');file_put_contents('/private/config.php','<?php return '.var_export(['base_url'=>'https://requests.goeventdj.com','app_secret'=>str_repeat('s',32),'admin_password_hash'=>password_hash('test-only',PASSWORD_DEFAULT)],true).';');`});
assert.equal(setup.errors,'');
php.writeFile('/private/web_push.php',readFileSync(new URL('../private/web_push.php',import.meta.url),'utf8'));
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
const activeId=(await req('/api/board')).data.event.id;
const sendSong=(title, cookie, name='', event_id=activeId)=>req('/api/requests','POST',{event_id,title,artist:'Test Artist',requester_name:name},{Cookie:'dj_guest_id='+cookie});
const alice='e'.repeat(64), bob='f'.repeat(64);
const first=(await sendSong('One',alice,'Sam')).data.request_id;
const secondGuest=(await sendSong('Two',bob)).data.request_id;
const third=(await sendSong('Three',alice)).data.request_id;
assert.equal((await sendSong('One',bob)).data.duplicate,true);
await req('/api/admin/requests/'+first+'/status','POST',{status:'declined'});
await req('/api/admin/requests/'+third+'/status','POST',{status:'accepted'});
const adminRows=(await req('/api/admin/events/'+activeId+'/requests')).data.requests;
const byId=id=>adminRows.find(row=>row.id===id);
assert.deepEqual([byId(first).request_number,byId(third).request_number,byId(third).request_total],[1,2,2]);
assert.equal(byId(first).guest_number,byId(third).guest_number);
assert.notEqual(byId(first).guest_number,byId(secondGuest).guest_number);
assert.equal(byId(secondGuest).request_total,1);
assert.ok(!('guest_number' in byId(40)));
assert.ok(adminRows.every(row=>!('guest_key' in row)));
assert.ok((await req('/api/board')).data.requests.every(row=>!('request_number' in row)&&!('guest_number' in row)&&!('request_total' in row)&&!('guest_key' in row)));
await req(otherAction,'POST',{action:'activate'});
const another=await sendSong('Another Event',alice,'Sam',otherManual.data.id);
assert.equal(another.status,200);
const otherRow=(await req('/api/admin/events/'+otherManual.data.id+'/requests')).data.requests.find(row=>row.id===another.data.request_id);
assert.deepEqual([otherRow.guest_number,otherRow.request_number,otherRow.request_total],[1,1,1]);
// Sam's queue: same guest submitted six songs. A second vote always outranks requester activity.
const edit=(id,data,headers)=>req('/api/admin/events/'+id+'/edit','POST',data,headers);
const eventById=async id=>(await req('/api/admin/events')).data.events.find(e=>e.id===id);
const newEvent=await req('/api/admin/events','POST',{name:'Fairness test',song_limit:6,window_minutes:10});
const fairId=newEvent.data.id;
await req('/api/admin/events/'+fairId+'/action','POST',{action:'activate'});
const full=[];
for(let i=0;i<6;i++) full.push((await sendSong('Guest A '+i,alice,'',fairId)).data.request_id);
const single=(await sendSong('Cupid',bob,'',fairId)).data.request_id;
const aPair=[];
for(let i=0;i<2;i++) aPair.push((await sendSong('Guest C '+i,'3'.repeat(64),'',fairId)).data.request_id);
const cooldown=await sendSong('Over limit',alice,'',fairId);
assert.equal(cooldown.status,429);
assert.equal(cooldown.data.detail,'Easy there, DJ! Give the booth a breather and let a few other guests pick a song. Try again in a bit.');
assert.equal((await sendSong('Cupid',alice,'',fairId)).data.duplicate,true);
await req('/api/requests/'+full[5]+'/vote','POST',{direction:1},guestHeaders);
await req('/api/requests/'+full[5]+'/vote','POST',{direction:1},{Cookie:'dj_guest_id='+'4'.repeat(64)});
await req('/api/admin/requests/'+full[4]+'/status','POST',{status:'accepted'});
const expectedRanks=[full[4],full[5],single,...aPair,...full.slice(0,4)];
for (const url of ['/api/board','/api/admin/events/'+fairId+'/requests']) {
    const rows=(await req(url)).data.requests;
    assert.deepEqual(rows.map(row=>row.id),expectedRanks);
    assert.equal(rows.find(row=>row.id===full[5]).votes,3);
}
// With all three pending songs at one vote, use totals (1, 2, 6) ahead of arrival time.
await req('/api/requests/'+single+'/vote','POST',{direction:-1},{Cookie:'dj_guest_id='+alice});
await req('/api/requests/'+single+'/vote','POST',{direction:1},guestHeaders);
assert.equal((await req('/api/board')).data.requests.find(row=>row.id===single).votes,1);
assert.deepEqual((await req('/api/board')).data.requests.map(row=>row.id),expectedRanks);

assert.equal((await edit(fairId,{window_minutes:0,name:'Invalid save'})).status,400);
assert.equal((await eventById(fairId)).name,'Fairness test');
assert.equal((await edit(fairId,{song_limit:1},{Cookie:''})).status,401);
assert.equal((await edit(fairId,{song_limit:1},{'X-CSRF-Token':'wrong'})).status,403);
assert.equal((await edit(fairId,{song_limit:7,window_minutes:1,name:'Extended show',venue:'New hall',date:'2026-11-26'})).status,200);
assert.equal((await sendSong('Seventh',alice,'',fairId)).status,200);
assert.deepEqual(await sendSong('Eighth',alice,'',fairId),cooldown);
// Move the seven songs outside this event's new rolling window.
await php.run({code:'<?php '+mockDb+' db()->exec("UPDATE requests SET created_at=created_at-61 WHERE event_id='+fairId+'");'});
assert.equal((await sendSong('New minute',alice,'',fairId)).status,200);
assert.equal((await req('/api/board')).data.event.name,'Extended show');
assert.equal((await eventById(otherManual.data.id)).song_limit,6);
assert.equal((await req('/api/admin/events','POST',{name:'Invalid limit',song_limit:0})).status,400);

const march=await edit(fairId,{opens_at:'2027-03-14T02:30',closes_at:'2027-03-14T04:00'});
assert.equal(march.status,400); // nonexistent local time during the spring clock change
assert.equal((await edit(fairId,{opens_at:'2027-12-31T20:00',closes_at:'2027-12-31T23:59'})).status,200);
let manual=await eventById(fairId);
assert.equal(Number(manual.closes_at),Date.parse('2028-01-01T05:59:00Z')/1000);
assert.equal((await edit(fairId,{action:'extend',previous_end:Number(manual.closes_at)})).status,200);
assert.equal(Number((await eventById(fairId)).closes_at),Date.parse('2028-01-01T06:59:00Z')/1000);
assert.equal((await edit(fairId,{opens_at:'',closes_at:''})).status,200);
assert.equal((await eventById(fairId)).scheduled,false);
await req('/api/admin/events/'+fairId+'/action','POST',{action:'deactivate'});

// Extend a synced event across its original closing time. A repeated tap must not add another hour.
const ended={...live,source_revision:6,opens_at:now-7200,closes_at:now-60};
await sync(ended);
assert.equal((await req('/api/board')).data.state,'none');
assert.equal((await edit(7,{action:'extend',previous_end:ended.closes_at})).status,200);
assert.equal((await edit(7,{action:'extend',previous_end:ended.closes_at})).status,409);
assert.equal((await req('/api/board')).data.state,'open');
await edit(7,{name:'Local DJ Name',window_minutes:12,song_limit:3});
await sync({...ended,source_revision:7,name:'Planner Rename',venue:'Planner Ballroom'});
const edited=await eventById(7);
assert.deepEqual([edited.name,edited.venue,Number(edited.closes_at),edited.song_limit,edited.window_minutes],
    ['Local DJ Name','Planner Ballroom',ended.closes_at+3600,3,12]);
assert.equal((await req('/api/admin/events/7/action','POST',{action:'close'})).status,200);
assert.equal((await req('/api/board')).data.state,'closed');
await req('/api/admin/events/7/action','POST',{action:'open'});
assert.equal((await req('/api/board')).data.state,'open');
await sync({...ended,source_revision:8,opens_at:0,closes_at:0});
assert.equal((await req('/api/board')).data.state,'none');
await sync({...ended,source_revision:9,name:'Current Planner'});
assert.equal((await req('/api/board')).data.event.name,'Local DJ Name');
assert.equal((await edit(7,{action:'reset'})).status,200);
const reset=await eventById(7);
assert.deepEqual([reset.name,Number(reset.closes_at),reset.song_limit,reset.window_minutes],['Current Planner',ended.closes_at,3,12]);
assert.equal((await req('/api/board')).data.state,'none');
await testDjPush({req,php,sendSong,mockDb,dj});
console.log('Requests schedule tests passed (SQLite adapter, production MySQL SQL requires deployment smoke test).');
} finally { php.exit(); }
