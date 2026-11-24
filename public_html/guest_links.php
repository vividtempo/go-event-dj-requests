<?php
declare(strict_types=1);
if (!function_exists('sql')) { http_response_code(404); exit; }

function guest_links_schema(): void {
    sql("CREATE TABLE IF NOT EXISTS guest_links (
        position INT PRIMARY KEY, label VARCHAR(40) NOT NULL, url VARCHAR(500) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function guest_links(): array {
    try {
        return sql('SELECT label,url FROM guest_links ORDER BY position')->fetchAll();
    } catch (PDOException $e) {
        // Existing installations can serve guests before the DJ opens Settings.
        if (($e->errorInfo[1] ?? null) === 1146) return [];
        throw $e;
    }
}

function contact_url(mixed $value): string {
    if (!is_string($value) || strlen($value) > 500) err(400, 'Invalid guest link.');
    $value = trim($value);
    if (str_starts_with($value, 'mailto:')) {
        if (!filter_var(substr($value, 7), FILTER_VALIDATE_EMAIL)) err(400, 'Use mailto: followed by one email address.');
        return $value;
    }
    if (str_starts_with($value, 'tel:')) {
        if (!preg_match('/^tel:\+?[0-9][0-9 ()-]{5,24}$/', $value)) err(400, 'Use tel: followed by a phone number.');
        return $value;
    }
    $url = safeurl($value);
    if ($url === '') err(400, 'Each guest link needs a URL.');
    return $url;
}

function validate_guest_links(mixed $items): array {
    if (!is_array($items) || !array_is_list($items) || count($items) > 5) err(400, 'Add up to five extra links.');
    $result = [];
    foreach ($items as $item) {
        if (!is_array($item)) err(400, 'Invalid guest link.');
        $result[] = ['label' => clean($item['label'] ?? null, 40), 'url' => contact_url($item['url'] ?? null)];
    }
    return $result;
}
