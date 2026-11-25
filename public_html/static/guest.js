const $ = id => document.getElementById(id);
let board = {state: 'none', requests: []};
let selected = null;
let manual = false;
let filter = 'pending';
let searchTimer, searchController, flashTimer;
let loadVersion = 0;
let sending = false;

function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
function message(text, bad = false) {
    $('flash').textContent = text;
    $('flash').className = bad ? 'flash bad' : 'flash';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => show('flash', false), 5500);
}
async function api(url, body, signal) {
    const options = {credentials: 'same-origin', signal};
    if (body !== undefined) Object.assign(options, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || 'Please try again.');
    return data;
}

function updateSubmit() {
    const hasSong = manual ? $('title').value.trim() && $('artist').value.trim() : selected;
    $('submit-btn').disabled = sending || board.state !== 'open' || !hasSong;
}
for (const id of ['title','artist']) $(id).addEventListener('input', updateSubmit);

function stopSearch() {
    clearTimeout(searchTimer);
    searchController?.abort();
    $('suggestions').replaceChildren();
    $('search-hint').textContent = '';
}
function clearSelection() {
    selected = null;
    $('selection').replaceChildren();
    show('selection', false);
    updateSubmit();
}
function setManual(value) {
    stopSearch();
    clearSelection();
    manual = value;
    show('manual-entry', manual);
    show('catalog-entry', !manual);
    $('title').required = $('artist').required = manual;
    $('manual-toggle').querySelector('span').textContent = manual ? 'Search the music catalog' : 'Enter request manually';
    updateSubmit();
}
function choose(song) {
    stopSearch();
    selected = song;
    $('lookup').value = song.title+' · '+song.artist;
    const row = el('div', 'track-row');
    row.append(trackIdentity(song));
    $('selection').replaceChildren(row);
    show('selection', true);
    updateSubmit();
    row.tabIndex = -1;
    row.focus({preventScroll: true});
}
$('lookup').addEventListener('input', () => {
    clearSelection();
    stopSearch();
    const term = $('lookup').value.trim();
    if (term.length < 2) return;
    searchTimer = setTimeout(async () => {
        const controller = new AbortController();
        searchController = controller;
        $('search-hint').textContent = 'Searching…';
        try {
            const {songs} = await api('/api/catalog?q='+encodeURIComponent(term), undefined, controller.signal);
            if (controller.signal.aborted) return;
            $('search-hint').textContent = songs.length ? '' : 'No matches. You can enter the song manually.';
            for (const song of songs) {
                const row = el('div', 'search-result');
                const button = el('button', 'choose-song');
                button.type = 'button';
                button.setAttribute('aria-label', 'Choose '+song.title+' by '+song.artist);
                button.append(interfaceIcon('plus'));
                button.addEventListener('click', () => choose(song));
                row.append(trackIdentity(song), button);
                $('suggestions').append(row);
            }
        } catch {
            if (!controller.signal.aborted) $('search-hint').textContent = 'Song search is unavailable. You can enter your song manually.';
        }
    }, 400);
});
$('manual-toggle').addEventListener('click', () => {
    if (!manual && !$('title').value) $('title').value = selected?.title || $('lookup').value.trim();
    if (!manual && selected) $('artist').value = selected.artist;
    setManual(!manual);
    $(manual ? 'title' : 'lookup').focus();
});
function resetEntry() {
    $('request-form').reset();
    setManual(false);
}

function renderSongs() {
    const songs = board.requests || [];
    const query = $('search').value.trim().toLowerCase();
    const items = songs.filter(song => song.status === filter && (song.title+' '+song.artist).toLowerCase().includes(query));
    $('request-count').textContent = songs.length+' song'+(songs.length === 1 ? '' : 's');
    for (const b of document.querySelectorAll('[data-filter]')) {
        b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
        b.classList.toggle('active', b.dataset.filter === filter);
        const status = b.dataset.filter;
        b.textContent = status[0].toUpperCase()+status.slice(1)+' ('+songs.filter(s => s.status === status).length+')';
    }
    const descriptions = {pending:'Popular requests awaiting DJ approval.', accepted:'Requests the DJ has accepted.', played:'Songs the DJ has played.'};
    $('queue-description').textContent = descriptions[filter];
    const list = $('requests-list');
    list.replaceChildren();
    if (!items.length) list.append(el('p','empty',query ? 'No matching requests.' : 'No '+filter+' requests yet.'));
    for (const song of items) {
        const row = el('div','request-row request');
        row.append(trackIdentity(song, {status:song.status}));
        const votes = el('div','request-tools vote-controls');
        for (const direction of [1,-1]) {
            if (direction === -1) votes.append(el('span','number',song.votes));
            if (board.state !== 'open' || song.status === 'played') continue;
            const button = el('button','btn icon-button '+(direction === 1 ? 'vote-up' : 'vote-down'));
            button.append(interfaceIcon(direction === 1 ? 'thumb-up' : 'thumb-down'));
            button.type = 'button';
            button.setAttribute('aria-label',(direction === 1 ? 'Upvote ' : 'Downvote ')+song.title);
            button.setAttribute('aria-pressed',String(song.my_vote === direction));
            button.disabled = song.my_vote === direction;
            button.addEventListener('click', async () => {
                for (const b of votes.querySelectorAll('button')) b.disabled = true;
                try {
                    await api('/api/requests/'+song.id+'/vote',{direction});
                    await load();
                } catch (e) { message(e.message, true); renderSongs(); }
            });
            votes.append(button);
        }
        votes.setAttribute('aria-label',song.votes+' net votes');
        row.append(votes);
        list.append(row);
    }
}
for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { filter = b.dataset.filter; renderSongs(); });
$('search').addEventListener('input',renderSongs);

const platforms = [
    ['instagram.com','instagram'],['facebook.com','facebook'],['fb.me','facebook'],['youtube.com','youtube'],['youtu.be','youtube'],
    ['tiktok.com','tiktok'],['spotify.com','spotify'],['music.apple.com','applemusic'],['popl.co','contact'],['poplme.co','contact'],['linkedin.com','linkedin'],
    ['cash.app','tip'],['venmo.com','tip'],['paypal.me','tip'],['paypal.com','tip'],['x.com','x'],['twitter.com','x']
];
function renderLinks() {
    const links = board.links || {};
    const items = [
        {label:'Book Go Event DJ',url:links.booking_url,icon:'booking'},
        {label:'Save Our Contact',url:links.contact_url,icon:'contact'},
        {label:'Leave a Review',url:links.review_url,icon:'review'},
        {label:'Tip Your DJ',url:links.tip_url,icon:'tip'},
        ...(links.custom_links || [])
    ];
    const box = $('guest-link-buttons');
    const custom = $('custom-link-buttons');
    const booking = $('booking-link');
    booking.replaceChildren();
    box.replaceChildren();
    custom.replaceChildren();
    for (const item of items) {
        let url;
        try { url = new URL(item.url); } catch { continue; }
        if (!['https:','mailto:','tel:'].includes(url.protocol)) continue;
        const platform = platforms.find(([host]) => url.hostname === host || url.hostname.endsWith('.'+host));
        const icon = item.icon || (url.protocol === 'tel:' ? 'phone' : url.protocol === 'mailto:' ? 'email' : platform?.[1] || 'link');
        const link = el('a', 'btn'+(item.icon === 'booking' ? ' primary' : ''));
        link.href = url.href;
        if (url.protocol === 'https:') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        link.append(interfaceIcon(icon));
        if (item.icon === 'booking') {
            link.append(document.createTextNode(item.label));
            booking.append(link);
        } else if (item.icon) {
            link.append(document.createTextNode(item.label));
            box.append(link);
        } else {
            link.title = item.label;
            link.setAttribute('aria-label', item.label);
            // Keep user-defined labels visible when a generic icon cannot identify the destination.
            if (!platform && url.protocol === 'https:') link.append(document.createTextNode(item.label));
            custom.append(link);
        }
    }
    show('social-links',custom.childElementCount > 0);
    show('external-links',booking.childElementCount + box.childElementCount + custom.childElementCount > 0);
}
function render() {
    const event = board.event;
    const open = board.state === 'open';
    show('loading',false);
    show('board',true);
    show('entry',open);
    updateSubmit();
    show('queue',Boolean(event));
    $('event-name').textContent = event?.name || 'Song requests';
    $('state').className = 'request-state '+(open ? 'open' : 'closed');
    $('state').textContent = open ? 'Now accepting requests' : 'Requests closed';
    $('intro').textContent = open ? 'Request a song, vote for a favorite, or see what the DJ has played.' : event ? 'Requests are closed. Thanks for joining us.' : 'Check back when the event begins.';
    show('presence', Boolean(event));
    if (event) {
        $('presence-count').textContent = board.active_guests+' active';
        $('presence').setAttribute('aria-label', board.active_guests+' active guest'+(board.active_guests === 1 ? '' : 's'));
    }
    const genres = event?.genres || [];
    show('vibe', genres.length > 0);
    if (genres.length) {
        const hour = Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:event.timezone}).format(new Date()));
        $('vibe-title').textContent = hour >= 18 || hour < 5 ? "Tonight’s music vibe" : "Today’s music vibe";
        $('genres').replaceChildren(...genres.map(genre => el('span','genre',genre)));
    }
    if (event) renderSongs();
    renderLinks();
}
async function load() {
    const version = ++loadVersion;
    try {
        const next = await api('/api/board');
        if (version !== loadVersion) return;
        if (next.event?.id !== board.event?.id || next.state !== board.state) {
            resetEntry();
            filter = 'pending';
            $('search').value = '';
        }
        board = next;
        render();
    } catch (e) { if (version === loadVersion) message(e.message,true); }
}
$('request-form').addEventListener('submit',async e => {
    e.preventDefault();
    if (sending || board.state !== 'open') return;
    if (!manual && !selected) { message('Choose a song from the results or enter it manually.',true); $('lookup').focus(); return; }
    const data = {event_id:board.event.id,title:manual ? $('title').value : selected.title,artist:manual ? $('artist').value : selected.artist,
        requester_name:$('requester').value,note:$('note').value,website:$('website').value};
    if (!manual) data.catalog = selected;
    sending = $('submit-btn').disabled = true;
    try {
        const result = await api('/api/requests',data);
        message(result.duplicate ? (result.voted ? 'Already requested. Your vote was added.' : 'That song is already on the board.') : 'Request received. Thanks!');
        resetEntry();
        await load();
    } catch (err) { message(err.message,true); }
    finally { sending = false; updateSubmit(); }
});
load();
setInterval(() => { if (!document.hidden) load(); },12000);
document.addEventListener('visibilitychange',() => { if (!document.hidden) load(); });
