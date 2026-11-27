import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = path => readFileSync(new URL('../public_html/'+path,import.meta.url),'utf8');

// Drive the settings like a signed-in browser. No real notification permission is requested by the test.
const elements = new Map();
const $ = id => {
    if (!elements.has(id)) elements.set(id,{classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;}});
    return elements.get(id);
};
const calls=[];
const sub={endpoint:'https://fcm.googleapis.com/wp/test',toJSON(){return {endpoint:this.endpoint,keys:{}}},async unsubscribe(){calls.push('local-off')}};
let subscribed=null, gesture=false;
const worker={pushManager:{getSubscription:async()=>subscribed,async subscribe(options){
    assert.ok(gesture);
    assert.equal(options.userVisibleOnly,true);
    calls.push('local-on');return subscribed=sub;
}}};
const navigator={userAgent:'Chrome',serviceWorker:{async register(path,options){assert.equal(path,'/dj-sw.js');assert.equal(options.scope,'/admin');},ready:Promise.resolve(worker)}};
const globals={$,navigator,window:{PushManager:{},Notification:{}},Notification:{permission:'default'},atob,Uint8Array,
    async api(url){calls.push(url);return {publicKey:'YWJj',enabled:true}}};
const setup=vm.runInNewContext(source('static/dj-notifications.js')+'; djAlerts.setup',globals);
await setup();
assert.deepEqual(calls,['/api/admin/push/config']);
gesture=true;await $('dj-alert-toggle').click();gesture=false;
assert.deepEqual(calls.slice(-2),['local-on','/api/admin/push/subscribe']);
await $('dj-alert-test').click();assert.equal(calls.at(-1),'/api/admin/push/test');
await $('dj-alert-toggle').click();assert.deepEqual(calls.slice(-2),['/api/admin/push/unsubscribe','local-off']);
navigator.userAgent='iPhone';globals.window.matchMedia=()=>({matches:false});
await setup();assert.match($('dj-alert-status').textContent,/Home Screen/);

const events={}, banners=[], opened=[];
const dj={url:'https://requests.example/admin',async navigate(url){opened.push(url);return {focus(){opened.push('focused')}}}};
const clients={matchAll:async()=>[dj],openWindow:url=>opened.push(url)};
vm.runInNewContext(source('dj-sw.js'),{URL,self:{location:{origin:'https://requests.example'},clients,
    addEventListener:(k,v)=>events[k]=v,registration:{showNotification:async(title,options)=>banners.push({title,...options})}}});
async function fire(type,data) {let done;events[type]({...data,waitUntil(p){done=p}});await done;}
await fire('push',{data:{json:()=>({requestId:12,eventId:7,event:'Party',song:'Cupid',artist:'112'})}});
assert.equal(banners[0].title,'New Song Request');
assert.equal(banners[0].body,'Cupid by 112 · Party');assert.equal(banners[0].tag,'dj-request-12');
await fire('notificationclick',{notification:{data:banners[0].data,close(){}}});
assert.deepEqual(opened,['https://requests.example/admin?event=7','focused']);
clients.matchAll=async()=>[];
await fire('notificationclick',{notification:{data:banners[0].data,close(){}}});
assert.equal(opened.at(-1),'https://requests.example/admin?event=7');
await fire('push',{data:{json:()=>({test:true})}});
assert.equal(banners[1].title,'DJ Notifications Are On');
console.log('DJ browser controls and notification-click tests passed.');
