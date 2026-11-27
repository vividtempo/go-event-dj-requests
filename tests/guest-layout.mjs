// Run with Playwright installed and its Chromium browser available:
// node tests/guest-layout.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH});

try {
    const song = {id: 1, title: 'W'.repeat(120), artist: 'Cameo', status: 'pending', votes: 2, my_vote: 0,
        artwork_url: 'https://is1-ssl.mzstatic.com/image/test/cover.jpg', store_url: 'https://music.apple.com/track'};
    const manualSong = {...song, id:2, title:'Manual entry', artwork_url:'', store_url:''};
    const event = {id:1, name:'Reception', is_active:true, requests_open:true};
    for (const width of [320, 390, 768]) {
        const accepted = {...manualSong, id:3, title:'Accepted song', status:'accepted', votes:0};
        const played = {...manualSong, id:4, title:'Played song', status:'played'};
        let requests = [song, manualSong, accepted, played];
        let submitted;
        const page = await browser.newPage({viewport: {width, height: 850}, isMobile: width < 768, reducedMotion: 'reduce'});
        const localCover = new URL('../public_html/static/images/favicon-96x96.png', import.meta.url);
        await page.route(song.artwork_url, async route => route.fulfill({contentType:'image/png', body:await readFile(localCover)}));
        await page.route('http://fixture.test/**', async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/api/board') return route.fulfill({json: {
                state: 'open', event, requests, active_guests: 1,
                links: {booking_url:'https://example.org/book', tip_url:'https://example.org/tip', review_url:'https://example.org/review',
                    contact_url:'https://example.org/contact', custom_links:[{label:'Instagram', url:'https://instagram.com/example'}]}
            }});
            if (path === '/api/requests') {
                submitted = route.request().postDataJSON();
                return route.fulfill({json:{ok:true, duplicate:true, status:'pending'}});
            }
            if (path === '/api/catalog') return route.fulfill({json: {songs: [song]}});
            if (path.startsWith('/api/admin/')) {
                const responses = {
                    '/api/admin/me': {csrf:'fixture'},
                    '/api/admin/events': {events:[event]},
                    '/api/admin/events/1/requests': {requests:[{...song, status:'accepted', requester_name:'Sam', guest_number:1, request_number:1, request_total:2, note:'For the DJ', created_at:1700000000}, {...manualSong, guest_number:1, request_number:2, request_total:2}], active_guests:1},
                    '/api/admin/qr-link': {url:'http://fixture.test/requests'},
                    '/api/admin/settings': {}, '/api/admin/automation': {enabled:false}
                };
                return route.fulfill({json:responses[path]});
            }
            const file = {'/requests':'/static/guest.html', '/admin':'/static/admin.html'}[path] || path;
            const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png'};
            await route.fulfill({body: await readFile(new URL('../public_html'+file, import.meta.url)), contentType: types[extname(file)]});
        });
        await page.goto('http://fixture.test/requests');
        await page.locator('#entry').waitFor();
        assert.equal(await page.locator('#event-name').textContent(), event.name);
        assert.ok(await page.getByRole('heading', {name:'Request a Song'}).isVisible());
        const search = page.getByRole('searchbox', {name:'Search by Song or Artist'});
        assert.equal(await page.getByRole('searchbox').count(), 1);
        const name = page.getByLabel('Your Name (Optional)');
        const note = page.getByLabel('Dedication or Special Note (Optional)');
        const send = page.locator('#submit-btn');
        assert.ok(await name.isHidden() && await note.isHidden() && await send.isHidden());
        const queue = page.locator('#requests-list');
        const titles = queue.locator('.song-title');
        assert.deepEqual(await titles.allTextContents(), [accepted.title, song.title, manualSong.title]);
        const playedTab = page.getByRole('button', {name:'Played', exact:true});
        const queueTab = page.getByRole('button', {name:'In the Queue', exact:true});
        await playedTab.click();
        assert.deepEqual(await titles.allTextContents(), [played.title]);
        await queueTab.click();
        assert.equal(await queueTab.getAttribute('aria-pressed'), 'true');
        await search.fill('Candy');
        const choose = page.getByRole('button', {name:'Choose '+song.title+' by '+song.artist});
        await choose.waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && innerWidth === document.documentElement.clientWidth));
        const result = page.locator('#suggestions .search-result').first();
        const coverSize = width <= 480 ? 56 : 64;
        await result.locator('.track-cover').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('#suggestions .track-cover')?.naturalWidth > 0);
        await page.context().route(song.store_url, route => route.fulfill({contentType:'text/html', body:'Fixture store'}));
        const [store] = await Promise.all([page.waitForEvent('popup'), result.getByRole('link').click()]);
        await store.waitForLoadState();
        assert.equal(store.url(), song.store_url);
        await store.close();
        assert.ok(await send.isDisabled());
        assert.equal(await result.locator('.track-cover').evaluate(e => e.offsetWidth), coverSize);
        const title = await result.locator('.song-title').boundingBox();
        await page.mouse.click(title.x + 3, title.y + 3);
        assert.ok(await send.isEnabled());
        const selected = page.locator('#selection');
        assert.equal(await selected.locator('.track-cover').getAttribute('src'), song.artwork_url);
        assert.equal(await selected.locator('.track-cover').evaluate(e => e.offsetHeight), coverSize);
        assert.equal(await selected.locator('.store-badge').getAttribute('href'), song.store_url);
        await queue.locator('.track-cover').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('#requests-list .track-cover')?.naturalWidth > 0);
        assert.equal(await queue.locator('.track-cover').evaluate(e => e.offsetWidth), coverSize);
        assert.equal(await queue.locator('.store-badge').count(), 1);
        assert.equal(await queue.locator('.store-badge').getAttribute('href'), song.store_url);
        assert.equal(await queue.locator('.store-badge img').evaluate(e => e.getBoundingClientRect().height), 16);
        assert.equal(await page.locator('#booking-link a').evaluate(e => e.offsetWidth === e.parentElement.clientWidth), true);
        assert.equal(await page.locator('.tiprow').getByRole('link').count(), 3);
        assert.equal(await page.getByRole('link', {name:'Instagram'}).count(), 1);
        assert.equal(await page.locator('#presence-count').textContent(), '1 active');
        assert.ok(await page.getByRole('button', {name:'Upvote '+song.title}).locator('use[href$="#thumb-up"]').count());
        assert.ok(await page.getByRole('button', {name:'Downvote '+song.title}).locator('use[href$="#thumb-down"]').count());
        await name.fill('Sam');
        await note.fill('For the anniversary couple');
        await page.getByRole('button', {name:'Change Song'}).click();
        await choose.waitFor();
        await choose.click();
        assert.equal(await name.inputValue(), 'Sam');
        assert.equal(await note.inputValue(), 'For the anniversary couple');
        await send.click();
        await search.waitFor();
        assert.equal(submitted.catalog.title, song.title);
        assert.equal(submitted.note, 'For the anniversary couple');
        assert.equal(submitted.requester_name, 'Sam');
        assert.equal(await name.inputValue(), 'Sam');
        assert.equal(await note.inputValue(), '');
        assert.ok(await send.isHidden());
        requests = [{...song,status:'accepted'}, manualSong, accepted, played];
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(title => [...document.querySelectorAll('.request')].some(row =>
            row.querySelector('.song-title').textContent === title && row.querySelector('.song-status.accepted')), song.title);
        assert.deepEqual(await titles.allTextContents(), [song.title, accepted.title, manualSong.title]);
        const failedCover = route => route.abort();
        await page.route(song.artwork_url, failedCover);
        await page.reload();
        await page.locator('.request').first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('.request .music-tile') && !document.querySelector('.store-badge'));
        await search.fill('Candy');
        await choose.waitFor();
        await result.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('#suggestions .music-tile') && !document.querySelector('#suggestions .store-badge'));
        await choose.press('Enter');
        assert.ok(await send.isEnabled());
        assert.equal(await name.inputValue(), 'Sam');
        await page.unroute(song.artwork_url, failedCover);
        await page.goto('http://fixture.test/admin');
        const card = page.locator('.queue-card').first();
        await card.locator('.track-cover').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('.queue-card .track-cover')?.naturalWidth > 0);
        assert.equal(await card.locator('.track-cover').evaluate(e => e.offsetWidth), coverSize);
        assert.equal(await card.locator('.store-badge').getAttribute('href'), song.store_url);
        assert.equal(await card.locator('.store-badge img').evaluate(e => e.offsetHeight), 16);
        assert.ok(await card.getByRole('heading', {name:song.title}).isVisible());
        assert.match(await card.locator('.request-by').textContent(), /Accepted · Requested by Sam #1 · Request 1 of 2/);
        assert.match(await page.locator('.queue-card').last().textContent(), /Pending · Requested by Anonymous #1 · Request 2 of 2/);
        assert.equal(await page.getByRole('button', {name:'In the Queue (2)', exact:true}).getAttribute('aria-pressed'), 'true');
        assert.equal(await card.getByRole('button', {name:'Accept', exact:true}).count(), 0);
        assert.ok(await card.getByRole('button', {name:'Mark Played', exact:true}).isVisible());
        assert.equal(await card.locator('.note').textContent(), 'For the DJ');
        assert.equal(await page.locator('.queue-card').last().locator('.music-tile').count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
        await page.close();
    }
    console.log('Guest form, voting, and shared track layouts passed on the guest and DJ pages.');
} finally {
    await browser.close();
}
