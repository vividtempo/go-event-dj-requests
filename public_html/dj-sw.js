self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data?.json() || {}; } catch { /* Display a basic alert if its details are missing. */ }
    const test = data.test === true;
    const id = Number(data.eventId);
    const url = Number.isSafeInteger(id) && id > 0 ? '/admin?event='+id : '/admin';
    event.waitUntil(self.registration.showNotification(test ? 'DJ Notifications Are On' : 'New Song Request', {
        body: test ? 'Tap to open your Live Queue.' : [data.song && data.artist ? data.song+' by '+data.artist : data.song, data.event].filter(Boolean).join(' · ') || 'Open the Live Queue to see the song.',
        icon: '/static/images/favicon-96x96.png',
        tag: test ? 'dj-test' : data.requestId ? 'dj-request-'+data.requestId : undefined,
        data: {url}
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = event.notification.data?.url || '/admin';
    const url = new URL(/^\/admin(?:\?event=\d+)?$/.test(target) ? target : '/admin',self.location.origin);
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
        const dj = windows.find(client => new URL(client.url).pathname === '/admin');
        if (dj) {
            try {
                const view = await dj.navigate(url.href);
                if (view) return await view.focus();
            } catch { /* The tab may have closed or navigated while waking up. */ }
        }
        return self.clients.openWindow(url.href);
    })());
});
