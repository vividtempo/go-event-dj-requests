const djAlerts = (() => {
    const status = $('dj-alert-status');
    const toggle = $('dj-alert-toggle');
    const test = $('dj-alert-test');
    let registration, key, subscription, enabled = false, busy = false;

    function display(message) {
        status.textContent = message;
        toggle.textContent = enabled ? 'Turn Off Notifications' : 'Enable Notifications';
        toggle.disabled = busy || !registration || !key || Notification.permission === 'denied';
        test.classList.toggle('hidden',!enabled);
        test.disabled = busy;
    }

    function keyBytes(value) {
        const base64 = value.replace(/-/g,'+').replace(/_/g,'/');
        return Uint8Array.from(atob(base64),c => c.charCodeAt(0));
    }

    async function setup() {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
        const needsHomeScreen = ios && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
        if (needsHomeScreen || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            status.textContent = needsHomeScreen ? 'Add this dashboard to your Home Screen, then open it there to enable alerts.'
                : 'Open this dashboard in Chrome or Safari to enable alerts.';
            toggle.disabled = true;
            return;
        }
        busy = true;
        display('Checking this device…');
        try {
            const [config,worker] = await Promise.all([
                api('/api/admin/push/config'),
                navigator.serviceWorker.register('/dj-sw.js',{scope:'/admin'}).then(() => navigator.serviceWorker.ready)
            ]);
            registration = worker;
            key = config.publicKey;
            subscription = await registration.pushManager.getSubscription();
            enabled = Boolean(subscription && (await api('/api/admin/push/status','POST',{endpoint:subscription.endpoint})).enabled);
            busy = false;
            display(Notification.permission==='denied' ? 'Allow notifications for this site in your browser settings.'
                : enabled ? 'New song alerts are on for this device.' : 'Get an alert on this device when a guest adds a new song.');
        } catch (err) {
            busy = false;
            display(err.message || 'Notification setup is unavailable.');
        }
    }

    toggle.addEventListener('click',async () => {
        if (busy || !registration || !key) return;
        busy = true;
        display(enabled ? 'Turning off notifications…' : 'Enabling notifications…');
        try {
            if (enabled) {
                await api('/api/admin/push/unsubscribe','POST',{endpoint:subscription.endpoint});
                enabled = false;
                await subscription.unsubscribe();
                subscription = null;
            } else {
                // Run subscribe directly from the button gesture so Safari can prompt for permission.
                subscription = await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(key)});
                await api('/api/admin/push/subscribe','POST',{...subscription.toJSON(),publicKey:key});
                enabled = true;
            }
            busy = false;
            display(enabled ? 'New song alerts are on for this device.' : 'New song alerts are off for this device.');
        } catch (err) {
            busy = false;
            display(Notification.permission==='denied' ? 'Allow notifications for this site in your browser settings.' : err.message);
        }
    });

    test.addEventListener('click',async () => {
        if (busy || !subscription) return;
        busy = true;
        display('Sending test…');
        try {
            await api('/api/admin/push/test','POST',{endpoint:subscription.endpoint});
            busy = false;
            display('Test sent. Check this device’s notifications.');
        } catch (err) {
            await setup();
            display(err.message);
        }
    });

    return {setup};
})();
