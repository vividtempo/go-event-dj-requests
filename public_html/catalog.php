<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

function catalog_signature(array $track): string {
    return hash_hmac('sha256', json_encode([$track['title'], $track['artist'], $track['artwork_url'], $track['store_url']], JSON_THROW_ON_ERROR), conf()['app_secret']);
}

function catalog_track(array $item): ?array {
    if (($item['kind'] ?? '') !== 'song') return null;
    $title = trim($item['trackName'] ?? '');
    $artist = trim($item['artistName'] ?? '');
    $store = $item['trackViewUrl'] ?? '';
    $art = $item['artworkUrl100'] ?? '';
    if ($title === '' || $artist === '' || preg_match('/^.{1,120}$/usD', $title) !== 1 || preg_match('/^.{1,120}$/usD', $artist) !== 1) return null;
    if (strlen($store) > 480 || !preg_match('~^https://(?:music|itunes)\.apple\.com/[^\s]+$~D', $store)) return null;
    if (strlen($art) > 500 || !preg_match('~^https://[a-z0-9-]+\.mzstatic\.com/image/[^\s]+$~D', $art)) $art = '';
    $track = ['title'=>$title, 'artist'=>$artist, 'artwork_url'=>$art, 'store_url'=>$store.(str_contains($store,'?')?'&':'?').'app=itunes'];
    $track['signature'] = catalog_signature($track);
    return $track;
}

function search_catalog(string $term): array {
    $cache = 'gedj:catalog:'.hash('sha256', norm($term).conf()['app_secret']);
    $cached = function_exists('apcu_fetch') ? apcu_fetch($cache) : false;
    if (is_array($cached)) return $cached;
    rate(iphash(), 'catalog_ip', 100, 60);
    rate(hash('sha256','itunes-search'), 'catalog', 20, 60);
    $url = 'https://itunes.apple.com/search?'.http_build_query(['term'=>$term,'country'=>'US','media'=>'music','entity'=>'song','limit'=>8]);
    if (!function_exists('curl_init')) err(503,'Song search is unavailable. Enter your song manually.');
    $curl = curl_init($url);
    curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>9,CURLOPT_HTTPHEADER=>['Accept: application/json']]);
    $raw = curl_exec($curl);
    if (curl_getinfo($curl,CURLINFO_RESPONSE_CODE)!==200 || !is_string($raw)) err(503,'Song search is unavailable. Enter your song manually.');
    $data = json_decode($raw,true);
    if (!is_array($data['results']??null)) err(503,'Song search is unavailable. Enter your song manually.');
    $songs=[];
    foreach ($data['results'] as $item) {
        $song=catalog_track($item);
        if ($song!==null) $songs[]=$song;
    }
    if (function_exists('apcu_store')) apcu_store($cache,$songs,600);
    return $songs;
}

if ($path==='/api/catalog' && $method==='GET') {
    $event=active();
    if (!$event || !$event['requests_open']) err(409,'Requests are closed.');
    $term=clean($_GET['q']??'',120);
    if (!preg_match('/^.{2}/us',$term)) out(['songs'=>[]]);
    out(['songs'=>search_catalog($term)]);
}
