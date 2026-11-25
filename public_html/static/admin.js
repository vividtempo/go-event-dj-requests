const $ = id=>document.getElementById(id);
let csrf='', events=[],selectedEvent=null, songs=[], scheduleConflict=false, statusFilter='pending';
function msg(text,bad=false){const x=$('flash');x.textContent=text;x.className='flash'+(bad?' bad':'');clearTimeout(window.flashTimer);window.flashTimer=setTimeout(()=>x.className='hidden',5500)}
async function api(url, method='GET', body=null){const headers={};if(body!==null)headers['content-type']='application/json';if(csrf&&method!=='GET')headers['x-csrf-token']=csrf;const res=await fetch(url,{method,headers,credentials:'same-origin',body:body!==null?JSON.stringify(body):undefined});const data=await res.json().catch(()=>({}));if(!res.ok){if(res.status===401&&url!=='/api/admin/login')showLogin();throw Error(data.detail||'Request failed')}return data;}
function showLogin(){$('login-screen').className='panel login';$('dashboard').className='hidden';csrf='';clearApiKey()}
function showDashboard(){$('login-screen').className='hidden';$('dashboard').className='';}
function node(t,c,s){const n=document.createElement(t);if(c)n.className=c;if(s!==undefined)n.textContent=s;return n}
function btn(text,action,variant='small'){const b=node('button','btn '+variant,text);b.type='button';b.addEventListener('click',action);return b}
function options(parent,items){parent.replaceChildren(...items)}
function selectedTab(name){for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);for(const id of ['live','events','settings'])$(id+'-tab').className=id===name?'stack':'hidden'}
async function refresh(){const data=await api('/api/admin/events');events=data.events;scheduleConflict=data.schedule_conflict;const active=events.find(e=>e.is_active);if(!selectedEvent||!events.some(e=>e.id===selectedEvent))selectedEvent=active?.id||(events[0]?.id??null);renderActive();renderEvents();if(selectedEvent)await loadQueue();else{$('queue-state').classList.add('hidden');songs=[];renderStats(0);renderQueue();$('queue-event-name').textContent='Select an event';$('queue-list').replaceChildren(node('div','empty','Create and activate an event to start.'))}$('qr-url').textContent=(await api('/api/admin/qr-link')).url;}
function renderActive() {
    const active = events.find(event => event.is_active);
    const target = $('active-summary');
    target.replaceChildren();
    if (!active) {
        target.append(node('h2', '', 'No active event'), node('p', 'muted small', scheduleConflict
            ? 'Two scheduled events overlap. Select Activate on the correct event to go live.'
            : 'Scheduled events open automatically. To open a manual event, select Activate under Events.'));
        return;
    }
    if (active.id !== selectedEvent) target.append(node('p', 'muted small', 'Live event · '+active.name));
    const actions = node('div', 'actions');
    actions.append(
        btn(active.requests_open ? 'Close requests' : 'Open requests', () => eventAction(active.id, active.requests_open ? 'close' : 'open'), 'small ghost'),
        btn(active.scheduled ? 'Pause & deselect' : 'Deactivate', () => eventAction(active.id, 'deactivate'), 'small ghost'),
        btn('Print QR', () => window.open('/qr','_blank','noopener'), 'small ghost')
    );
    target.append(actions);
}
function renderEvents(){const list=$('event-list');list.replaceChildren();if(!events.length){list.append(node('div','empty','No events yet.'));return;}for(const e of events){const row=node('div','event-row');const head=node('div','row wrap');const name=node('div');name.append(node('div','event-name',e.name));name.append(node('div','muted small',[e.event_date,e.venue].filter(Boolean).join(' · ')||'No date or venue entered'));if(e.scheduled){const fmt=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:e.timezone});name.append(node('div','muted small',e.opens_at>0?fmt.format(e.opens_at*1000)+' to '+fmt.format(e.closes_at*1000)+' ('+e.timezone+')':'Planner schedule disabled'));}
head.append(name,node('span','badge '+(e.is_active?'open':e.archived?'archived':'closed'),e.is_active?'Active':e.archived?'Archived':e.paused?'Paused':e.scheduled?'Scheduled':'Inactive'));const actions=node('div','actions');actions.style.marginTop='9px';name.append(node('div','muted small','Request event #'+e.id));actions.append(btn('View Queue',async()=>{selectedEvent=e.id;await loadQueue();selectedTab('live')},'small'));if(e.scheduled&&e.paused&&!e.archived)actions.append(btn('Resume Schedule',()=>eventAction(e.id,'auto'),'small ghost'));if(!e.is_active&&!e.archived&&(!e.scheduled||e.in_window))actions.append(btn('Activate',()=>eventAction(e.id,'activate'),'small success'));if(e.archived)actions.append(btn('Restore',()=>eventAction(e.id,'restore'),'small ghost'));else if(!e.is_active)actions.append(btn('Archive',()=>eventAction(e.id,'archive'),'small ghost'));row.append(head,actions);list.append(row);}}
async function eventAction(id,action){try{await api(`/api/admin/events/${id}/action`,'POST',{action});if(action==='activate')selectedEvent=id;msg(action==='activate'?'Event is live. Guests can submit requests.':`Event ${action} successful.`);await refresh();}catch(e){msg(e.message,true)}}
let queueVersion = 0;
async function loadQueue() {
    if (!selectedEvent) return;
    const id = selectedEvent;
    const version = ++queueVersion;
    const data = await api(`/api/admin/events/${id}/requests`);
    if (version !== queueVersion || id !== selectedEvent) return;
    const event = events.find(event => event.id === id);
    $('queue-event-name').textContent = event?.name || 'Event queue';
    const live = event?.is_active && event.requests_open;
    const state = $('queue-state');
    state.className = 'badge '+(live ? 'open' : 'closed');
    state.textContent = live ? 'Live · Requests open' : event?.archived ? 'Archived' : 'Requests closed';
    renderActive();
    songs = data.requests;
    renderStats(data.active_guests);
    renderQueue();
}

function renderStats(activeGuests) {
    $('active-guests').textContent = activeGuests;
    $('total-requests').textContent = songs.length;
    $('played-requests').textContent = songs.filter(song => song.status === 'played').length;
}

function copySongButton(song) {
    const label = 'Copy '+song.title+' by '+song.artist;
    const button = btn('', async () => {
        try {
            await navigator.clipboard.writeText(song.title+' · '+song.artist);
            msg('Song and artist copied.');
        } catch {
            msg('Clipboard unavailable. Select the song title and artist to copy them.', true);
        }
    }, 'icon-button');
    button.append(interfaceIcon('copy'));
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
}

function renderQueue() {
    const box = $('queue-list');
    box.replaceChildren();
    for (const tab of document.querySelectorAll('[data-status]')) {
        const status = tab.dataset.status;
        tab.classList.toggle('active', status === statusFilter);
        tab.setAttribute('aria-pressed', String(status === statusFilter));
        tab.textContent = status[0].toUpperCase()+status.slice(1)+' ('+songs.filter(s => s.status === status).length+')';
    }
    const filtered = songs.filter(song => song.status === statusFilter);
    if (!filtered.length) box.append(node('div', 'empty', 'No '+statusFilter+' requests.'));
    for (const song of filtered) {
        const card = node('article', 'queue-card');
        const info = node('div', 'song');
        info.append(node('h3', 'song-title', song.title), node('div', 'song-artist', song.artist));
        const time = new Date(song.created_at*1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
        info.append(node('div', 'request-by', 'Requested by '+(song.requester_name || 'Anonymous')+' · '+time));
        if (song.note) info.append(node('p', 'note', song.note));

        const tools = node('div', 'queue-tools');
        const votes = node('span', 'vote-score', song.votes);
        votes.setAttribute('aria-label', song.votes+' net votes');
        votes.prepend(interfaceIcon('thumb-up'));
        tools.append(votes, copySongButton(song));

        const actions = node('div', 'actions');
        if (song.status === 'pending') actions.append(btn('Accept', () => setStatus(song.id, 'accepted')));
        if (song.status === 'pending' || song.status === 'accepted') {
            actions.append(btn('Mark played', () => setStatus(song.id, 'played')),
                btn('Decline', () => setStatus(song.id, 'declined'), 'small decline'));
        } else {
            actions.append(btn('Restore', () => setStatus(song.id, 'pending')));
        }
        card.append(info, tools, actions);
        box.append(card);
    }
}
async function setStatus(id,status){try{await api(`/api/admin/requests/${id}/status`,'POST',{status});await loadQueue();}catch(e){msg(e.message,true)}}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-btn').disabled=true;try{const r=await api('/api/admin/login','POST',{password:$('password').value});csrf=r.csrf;$('password').value='';showDashboard();await refresh();await loadSettings();}catch(err){msg(err.message,true)}finally{$('login-btn').disabled=false}});
$('event-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/events','POST',{name:$('event-name').value,date:$('event-date').value,venue:$('event-venue').value});e.target.reset();msg('Event created. Activate it to receive requests.');await refresh();}catch(err){msg(err.message,true)}});
async function loadSettings(){const r=await api('/api/admin/settings');$('booking-url').value=r.booking_url||'';$('contact-url').value=r.contact_url||'';$('tip-url').value=r.tip_url||'';$('review-url').value=r.review_url||'';renderCustomLinks(r.custom_links||[]);await loadApiSettings()}
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/settings','POST',{booking_url:$('booking-url').value,contact_url:$('contact-url').value,tip_url:$('tip-url').value,review_url:$('review-url').value,custom_links:readCustomLinks()});msg('Links saved.');}catch(err){msg(err.message,true)}});
$('logout').addEventListener('click',async()=>{try{await api('/api/admin/logout','POST',{});}finally{showLogin()}});
$('refresh').addEventListener('click',()=>refresh().catch(e=>msg(e.message,true)));
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>selectedTab(b.dataset.tab));
for(const b of document.querySelectorAll('[data-status]'))b.addEventListener('click',()=>{statusFilter=b.dataset.status;renderQueue();});
async function init(){try{const r=await api('/api/admin/me');csrf=r.csrf;showDashboard();await refresh();await loadSettings();}catch{showLogin()}}
init();setInterval(async()=>{if(!csrf)return;try{await refresh()}catch{}},12000);

function clearApiKey(){ $('api-key').value='';$('api-key-result').className='hidden space-top'; }
function apiStatus(enabled){$('api-status').textContent=enabled?'API access is enabled.':'API access is disabled.';$('api-generate').textContent=enabled?'Replace API key':'Create API key';$('api-generate').dataset.enabled=String(enabled);$('api-revoke').classList.toggle('hidden',!enabled);}
async function loadApiSettings(){try{const r=await api('/api/admin/automation');apiStatus(r.enabled);}catch(e){$('api-status').textContent='API setup unavailable: '+e.message;}}
$('api-generate').addEventListener('click',async()=>{if($('api-generate').dataset.enabled==='true'&&!confirm('Replace your API key? Workflows using the old key will stop until you update them.'))return;$('api-generate').disabled=true;clearApiKey();try{const r=await api('/api/admin/automation','POST',{action:'rotate'});apiStatus(true);$('api-key').value=r.key;$('api-key-result').className='space-top';}catch(e){msg(e.message,true)}finally{$('api-generate').disabled=false}});
$('api-revoke').addEventListener('click',async()=>{if(!confirm('Revoke API access? Connected workflows will stop working.'))return;$('api-revoke').disabled=true;try{await api('/api/admin/automation','POST',{action:'revoke'});clearApiKey();apiStatus(false);msg('API access revoked.');}catch(e){msg(e.message,true)}finally{$('api-revoke').disabled=false}});
$('api-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('api-key').value);msg('API key copied. Store it in your n8n credential.');}catch{$('api-key').select();msg('Select and copy the key manually.');}});
$('api-hide').addEventListener('click',clearApiKey);

function renderCustomLinks(links){const box=$('custom-link-fields');box.replaceChildren();for(let i=0;i<5;i++){const row=node('div','grid two');for(const [field,title,placeholder,max] of [['label','Button label',i===0?'Contact / Book me':'e.g. Follow on Instagram',40],['url','Link address','https://…',500]]){const wrap=node('div','field');const label=node('label','',title+' '+(i+1));label.htmlFor=`custom-${field}-${i}`;const input=node('input');input.id=label.htmlFor;input.maxLength=max;input.placeholder=placeholder;input.value=links[i]?.[field]||(i===0&&field==='label'?'Contact / Book me':'');wrap.append(label,input);row.append(wrap);}box.append(row);}}
function readCustomLinks(){const result=[];for(let i=0;i<5;i++){const url=$(`custom-url-${i}`).value.trim();if(url)result.push({label:$(`custom-label-${i}`).value.trim(),url});}return result;}
