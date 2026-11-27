import assert from 'node:assert/strict';
import {createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify} from 'node:crypto';

export async function testDjPush({req,php,sendSong,mockDb,dj}) {
    const route=(name,data,headers)=>req('/api/admin/push/'+name,data?'POST':'GET',data,headers);
    assert.equal((await route('config',undefined,{Cookie:''})).status,401);
    const config=await route('config');
    assert.equal(config.status,200,JSON.stringify(config.data));
    const {publicKey}=config.data;
    assert.equal((await route('config')).data.publicKey,publicKey);
    const byteKey=Buffer.from(publicKey,'base64url');
    assert.equal(byteKey.length,65);
    const signer=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:byteKey.subarray(1,33).toString('base64url'),y:byteKey.subarray(33).toString('base64url')}});
    const ecdh=createECDH('prime256v1'), peer=ecdh.generateKeys(), auth=randomBytes(16);
    const keys={auth:auth.toString('base64url'),p256dh:peer.toString('base64url')};
    const apple={endpoint:'https://web.push.apple.com/Qtest',keys,publicKey};
    const chrome={...apple,endpoint:'https://fcm.googleapis.com/wp/test'};
    assert.equal((await route('subscribe',{...apple,endpoint:'https://example.com/test'})).status,400);
    assert.equal((await route('subscribe',{...apple,keys:{...keys,p256dh:'invalid'}})).status,400);
    assert.equal((await route('subscribe',apple,{'X-CSRF-Token':'wrong'})).status,403);
    for(const sub of [apple,chrome,chrome]) assert.equal((await route('subscribe',sub)).status,200);
    assert.equal((await route('status',apple)).data.enabled,true);
    const deliveries=()=>php.fileExists('/deliveries')?php.readFileAsText('/deliveries').trim().split('\n').map(s=>JSON.parse(s)):[];
    function decode(job,audience) {
        const jwt=job.auth.match(/^vapid t=([^,]+), k=(.+)$/);
        assert.equal(jwt[2],publicKey);
        const [header,claims,sig]=jwt[1].split('.');
        assert.equal(verify('sha256',Buffer.from(header+'.'+claims),{key:signer,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url')),true);
        const exp=JSON.parse(Buffer.from(claims,'base64url'));
        assert.equal(exp.aud,audience);
        assert.ok(exp.exp>Date.now()/1000 && exp.exp<Date.now()/1000+86400);
        const record=Buffer.from(job.body,'base64'), salt=record.subarray(0,16), sender=record.subarray(21,86);
        assert.equal(record.readUInt32BE(16),4096);
        assert.equal(record[20],65);
        const shared=ecdh.computeSecret(sender);
        const ikm=hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),peer,sender]),32);
        const cek=hkdfSync('sha256',ikm,salt,'Content-Encoding: aes128gcm\0',16);
        const nonce=hkdfSync('sha256',ikm,salt,'Content-Encoding: nonce\0',12);
        const decipher=createDecipheriv('aes-128-gcm',cek,nonce);
        decipher.setAuthTag(record.subarray(-16));
        const data=Buffer.concat([decipher.update(record.subarray(86,-16)),decipher.final()]);
        assert.equal(data.at(-1),2);
        return JSON.parse(data.subarray(0,-1));
    }
    assert.equal((await route('test',apple)).status,200);
    assert.deepEqual(decode(deliveries()[0],'https://web.push.apple.com'),{test:true});
    const event=await req('/api/admin/events','POST',{name:'Friday Party'});
    const eventId=event.data.id;
    await req('/api/admin/events/'+eventId+'/action','POST',{action:'activate'});
    const guest='9'.repeat(64), first=await sendSong('Cupid',guest,'Sam',eventId);
    const sent=deliveries();
    assert.equal(sent.length,3);
    const audience=job=>job.id===sent[0].id?'https://web.push.apple.com':'https://fcm.googleapis.com';
    for (const job of sent.slice(1)) {
        assert.deepEqual(decode(job,audience(job)),{requestId:first.data.request_id,eventId,event:'Friday Party',song:'Cupid',artist:'Test Artist'});
        if(job.id===sent[0].id) assert.equal(job.auth,sent[0].auth);
    }
    assert.equal((await sendSong('Cupid','8'.repeat(64),'',eventId)).data.duplicate,true);
    await req('/api/requests/'+first.data.request_id+'/vote','POST',{direction:1},{Cookie:'dj_guest_id='+'7'.repeat(64)});
    await req('/api/admin/requests/'+first.data.request_id+'/status','POST',{status:'accepted'});
    assert.equal(deliveries().length,3);
    await route('unsubscribe',apple);
    assert.equal((await route('status',apple)).data.enabled,false);
    php.writeFile('/push-status','0');
    await sendSong('Retry song',guest,'',eventId);
    const stored=await php.run({code:'<?php '+mockDb+' echo db()->query("SELECT COUNT(*) FROM dj_push_outbox")->fetchColumn(); db()->exec("UPDATE dj_push_outbox SET available_at=0");'});
    assert.equal(stored.text,'1');
    php.writeFile('/push-status','410');
    await req('/api/board');
    assert.equal((await route('status',chrome)).data.enabled,false);
    await route('subscribe',apple);
    await req('/api/admin/logout','POST',{}, {Cookie:'dj_admin='+dj+'; dj_alert_device='+sent[0].id});
    const after=await php.run({code:'<?php '+mockDb+' echo db()->query("SELECT COUNT(*) FROM dj_push_devices")->fetchColumn();'});
    assert.equal(after.text,'0');
    console.log('DJ push passed: opt-in, two providers, verified ES256 signatures, decrypted payloads, event link, duplicates, votes, retries, expiry, opt-out and logout.');
}
