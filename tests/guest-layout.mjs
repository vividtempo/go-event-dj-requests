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
    for (const width of [320, 390, 768]) {
        const page = await browser.newPage({viewport: {width, height: 850}, isMobile: width < 768, reducedMotion: 'reduce'});
        const localCover = new URL('../public_html/static/images/favicon-96x96.png', import.meta.url);
        await page.route(song.artwork_url, async route => route.fulfill({contentType:'image/png', body:await readFile(localCover)}));
        await page.route('http://fixture.test/**', async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/api/board') return route.fulfill({json: {
                state: 'open', event: {id: 1, name: 'Reception'}, requests: [song, {...song, id:2, title:'Manual entry', artwork_url:'', store_url:''}], active_guests: 1,
                links: {booking_url:'https://example.org/book', tip_url:'https://example.org/tip', review_url:'https://example.org/review',
                    contact_url:'https://example.org/contact', custom_links:[{label:'Instagram', url:'https://instagram.com/example'}]}
            }});
            if (path === '/api/catalog') return route.fulfill({json: {songs: [song]}});
            const file = path === '/requests' ? '/static/guest.html' : path;
            const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png'};
            await route.fulfill({body: await readFile(new URL('../public_html'+file, import.meta.url)), contentType: types[extname(file)]});
        });
        await page.goto('http://fixture.test/requests');
        await page.locator('#entry').waitFor();
        assert.ok(await page.getByLabel('Your name (optional)').isVisible());
        assert.ok(await page.getByLabel('Dedication or special note (optional)').isVisible());
        assert.ok(await page.getByRole('button', {name:'Send Song Request'}).isDisabled());
        await page.getByLabel('Song or artist', {exact:true}).fill('Candy');
        const choose = page.getByRole('button', {name:'Choose '+song.title+' by '+song.artist});
        await choose.waitFor();
        const picker = page.locator('.result-panel');
        assert.ok(await picker.getByRole('button', {name:'Enter request manually'}).isVisible());
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && innerWidth === document.documentElement.clientWidth));
        await choose.click();
        assert.ok(await page.getByRole('button', {name:'Send Song Request'}).isEnabled());
        assert.equal(await picker.locator('img, a').count(), 0);
        const queue = page.locator('#requests-list');
        await queue.locator('.queue-cover').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('.queue-cover')?.naturalWidth > 0);
        assert.equal(await queue.locator('.store-badge').count(), 1);
        assert.equal(await queue.locator('.store-badge').getAttribute('href'), song.store_url);
        assert.equal(await queue.locator('.store-badge img').evaluate(e => e.getBoundingClientRect().height), 16);
        assert.equal(await page.locator('#booking-link a').evaluate(e => e.offsetWidth === e.parentElement.clientWidth), true);
        assert.equal(await page.locator('.tiprow').getByRole('link').count(), 3);
        assert.equal(await page.getByRole('link', {name:'Instagram'}).count(), 1);
        assert.equal(await page.locator('#presence-count').textContent(), '1 active');
        assert.ok(await page.getByRole('button', {name:'Upvote '+song.title}).locator('use[href$="#thumb-up"]').count());
        assert.ok(await page.getByRole('button', {name:'Downvote '+song.title}).locator('use[href$="#thumb-down"]').count());
        await page.route(song.artwork_url, route => route.abort());
        await page.reload();
        await page.locator('.request').first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('.request .music-tile') && !document.querySelector('.store-badge'));
        await page.close();
    }
    console.log('Guest form, voting icons, and responsive layout passed.');
} finally {
    await browser.close();
}
