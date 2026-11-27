// Keep an open editor independent of the queue's background refresh.
const eventEditor = $('event-editor');
const editForm = $('edit-event-form');
let editingId = null;
let originalValues = {};
let extendingEvent = null;

function localEventTime(seconds, timezone) {
    if (!Number(seconds)) return '';
    const format = new Intl.DateTimeFormat('en-US', {timeZone:timezone, year:'numeric', month:'2-digit',
        day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
    const parts = Object.fromEntries(format.formatToParts(new Date(seconds*1000)).map(p => [p.type,p.value]));
    return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}

function openEventEditor(event) {
    editingId = event.id;
    const timezone = event.timezone || 'America/Chicago';
    originalValues = {name:event.name, date:event.event_date || '', venue:event.venue || '',
        opens_at:localEventTime(event.opens_at,timezone), closes_at:localEventTime(event.closes_at,timezone),
        song_limit:String(event.song_limit), window_minutes:String(event.window_minutes)};
    for (const [field,value] of Object.entries(originalValues)) editForm.elements.namedItem(field).value = value;
    $('edit-hours-zone').textContent = 'Request Hours ('+timezone+')';
    const disabled = event.planner_managed && !Number(event.opens_at);
    for (const field of ['opens_at','closes_at']) {
        editForm.elements.namedItem(field).disabled = disabled;
        editForm.elements.namedItem(field).required = event.planner_managed && !disabled;
    }
    $('edit-source').textContent = !event.planner_managed ? '' : disabled
        ? 'The planner has disabled request hours for this event.'
        : 'Edited fields apply here even after the planner syncs.';
    $('edit-source').hidden = !event.planner_managed;
    $('edit-reset').hidden = !(event.planner_managed && event.has_overrides);
    $('edit-error').textContent = '';
    eventEditor.showModal();
}

async function saveEventChanges(data) {
    const id = editingId;
    $('edit-save').disabled = $('edit-reset').disabled = true;
    try {
        await api('/api/admin/events/'+id+'/edit','POST',data);
        eventEditor.close();
        msg(data.action === 'reset' ? 'Planner details restored.' : 'Event updated.');
        await refresh();
    } catch (error) {
        if (eventEditor.open) $('edit-error').textContent = error.message;
        else msg(error.message,true);
    } finally {
        $('edit-save').disabled = $('edit-reset').disabled = false;
    }
}

editForm.addEventListener('submit',event => {
    event.preventDefault();
    const changes = {};
    for (const [field,oldValue] of Object.entries(originalValues)) {
        const input = editForm.elements.namedItem(field);
        if (!input.disabled && input.value !== oldValue) changes[field] = input.type === 'number' ? Number(input.value) : input.value;
    }
    if (Object.keys(changes).length) saveEventChanges(changes);
    else eventEditor.close();
});
$('edit-cancel').addEventListener('click', () => eventEditor.close());
$('edit-reset').addEventListener('click', () => saveEventChanges({action:'reset'}));

async function extendRequestHours(event) {
    if (extendingEvent !== null) return;
    extendingEvent = event.id;
    try {
        await api('/api/admin/events/'+event.id+'/edit','POST',{action:'extend',previous_end:Number(event.closes_at)});
        msg('Request hours extended by one hour.');
    } catch (error) { msg(error.message,true); }
    finally {
        extendingEvent = null;
        try { await refresh(); } catch (error) { msg(error.message,true); }
    }
}

function renderQueueEventControls(event) {
    const box = $('queue-event-controls');
    box.replaceChildren();
    if (!event) return;
    box.append(btn('Edit Event', () => openEventEditor(event), 'small ghost'));
    const summary = [event.song_limit+' '+(Number(event.song_limit)===1?'song':'songs')+' per guest every '+event.window_minutes+' '+(Number(event.window_minutes)===1?'minute':'minutes')];
    if (Number(event.closes_at)) {
        const end = new Intl.DateTimeFormat(undefined,{timeZone:event.timezone,dateStyle:'short',timeStyle:'short'}).format(event.closes_at*1000);
        summary.push('Closes '+end);
        if (!event.archived) box.append(btn('+1 Hour', () => extendRequestHours(event), 'small ghost'));
    }
    box.append(el('span','muted small',summary.join(' · ')));
}
