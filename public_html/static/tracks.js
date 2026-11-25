function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function musicTile() {
    const tile = el('span', 'music-tile');
    tile.append(interfaceIcon('music-note'));
    return tile;
}
function trackIdentity(song, {status, titleTag = 'span', details = []} = {}) {
    const identity = el('div', 'track-identity');
    const info = el('div', 'song');
    info.append(el(titleTag, 'song-title', song.title), el('span', 'song-artist', song.artist), ...details);
    if (status) info.append(el('span', 'song-status '+status, status[0].toUpperCase()+status.slice(1)));
    const tile = musicTile();
    identity.append(tile, info);
    if (/^https:\/\/[a-z0-9-]+\.mzstatic\.com\/image\//i.test(song.artwork_url)
        && /^https:\/\/(music|itunes)\.apple\.com\//i.test(song.store_url)) {
        const cover = el('img', 'track-cover');
        cover.alt = '';
        cover.loading = 'lazy';
        cover.decoding = 'async';
        const link = el('a', 'store-badge');
        link.href = song.store_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', song.title+' by '+song.artist+' on the iTunes Store');
        const badge = el('img');
        badge.alt = 'iTunes Store';
        badge.src = '/static/images/itunes-store-small.svg';
        link.append(badge);
        cover.addEventListener('error', () => { cover.replaceWith(tile); link.remove(); }, {once:true});
        tile.replaceWith(cover);
        identity.append(link);
        cover.src = song.artwork_url;
    }
    return identity;
}
