# Go Event DJ Requests: app guide

## What this is

A small PHP 8.1+ / MySQL app hosted on Cloudways. Repository: `vividtempo/go-event-dj-requests`, branch `main`. Public domain: `requests.goeventdj.com`. GitHub contains the implementation and documentation; private credentials live only on the server.

## Main pages

- `/requests`: guest requests, voting, and configured guest links.
- `/admin`: DJ login, live queue, event sessions, and settings.
- `/qr`: authenticated printable QR sign. The same QR points to whichever event is active.

The guest page and DJ queue refresh every 12 seconds. **Activate** selects the event for the permanent QR and opens requests immediately. It takes the previous event off the QR without touching its queue. Use **Close Requests** to pause intake. Requests and votes remain attached to their event. Archived events retain their history. Manual events can use Activate or optional opening and closing hours. Edit Event is available beside the queue title and in Events. +1 Hour extends the displayed closing time. For a planner event, local field edits survive sync until Restore Planner Details is selected. A planner cancellation disables its request hours. Planner-linked events open and close on their saved booking window. The DJ can pause or resume them without clearing the queue.

## Files and data

- `public_html/index.php`: routing, password/session/CSRF protection, event actions, requests, voting, tip/review settings, QR URL.
- `public_html/automation.php`: dedicated hashed API key management and event-only `/api/v1` routes. See [API.md](API.md).
- `public_html/guest_links.php`: additional contact/social links and validation.
- `public_html/static/style.css` defines the app theme in `:root` and the reusable controls, cards, and responsive layouts for the guest board, DJ dashboard, and QR sign.
- `public_html/static/tracks.js` renders each song’s title, artist, cover or fallback icon, and linked store badge in search, the selected-song preview, and both queues.
- `schema.sql`: schema for new installations. New settings tables are also created on authenticated settings access for existing installations.
- `private/config.example.php`: placeholder configuration template. Actual `private/config.php` is ignored by Git and must never be committed.

Original tables: events, requests, votes, rate_events, admin_sessions, settings. Added tables: automation_settings (hashed key), automation_event_links (stable external booking IDs), guest_links (ordered button labels and destinations).

## Guest requests and DJ moderation

The guest form searches the US iTunes catalog by song or artist. Selecting a result reveals the optional name and dedication fields and the Send Request button. Catalog results, the selected-song preview, the guest queue, and the DJ Control Center display available album covers with Apple’s compact, linked iTunes Store badge. Tapping a search result selects the song. Tapping its badge opens the store. Songs with unavailable artwork use a music-note tile. The server verifies selected track metadata. Search requires the PHP cURL extension and outbound HTTPS to itunes.apple.com. An unavailable catalog displays a retry message.

The DJ can accept, mark played, decline, or restore a request. Guests see accepted songs above pending songs in one queue, ranked by net votes within each group. Ties favor guests with fewer submissions for the event, then the oldest song. Each vote counts once. A separate Played view shows completed songs. Guests can vote in either direction on pending or accepted songs while requests are open. A guest’s last submitted name is remembered for that event in the same tab. Only the DJ sees names, dedications, declined songs, and requester activity. The DJ queue combines accepted and pending songs. New requests from the same browser and event share a guest number and show their position in that guest’s total. Voting or requesting a duplicate does not increase the total. Each event has a rolling songs-per-guest limit, initially six new songs in ten minutes. Adjust the song count and window when creating or editing the event. Older requests without a recorded submitter retain their original byline. Active guests counts distinct browser cookies seen on the current event in the last minute. The permanent QR opens the same guest page for every event.


### DJ Browser Notifications

Open **Settings → Song Request Notifications** and enable alerts on each DJ device. Use **Send Test Alert** to verify delivery. On iPhone or iPad, add the dashboard to the Home Screen and open it from that icon first. Tap an alert to open its event’s Live Queue. Turning alerts off or signing out explicitly removes that device from delivery.

The PHP app provisions its signing key and notification tables on the first authenticated setup. It needs OpenSSL, cURL and outbound HTTPS to Chrome and Apple push services. Each new song queues one encrypted message per enabled browser. Votes, duplicates and moderation changes do not enqueue messages. Delivery starts after submission and transient failures retry on subsequent queue activity for up to five minutes. No separate worker or external messaging account is required.

## Guest links

DJ Settings provides optional booking, contact (Popl), review, and tip URLs plus up to five additional labeled buttons for contact, booking, social pages, email, or telephone. HTTPS links are accepted; extra buttons also accept plain `mailto:address@example.com` and `tel:+15551234567`. Blank URL fields are omitted. Links appear both while requests are open and while closed; the entire section hides when all links are empty.

## Deployment

Cloudways app folder is `qdybfwapyt`. Repository is deployed into its outer `public_html/`; webroot is `public_html/public_html/`. Keep server configuration at outer `public_html/private/config.php`. `base_url` should be `https://requests.goeventdj.com`, without `/requests` or a trailing slash. The app adds `/requests` when generating the QR target. QR images currently come from api.qrserver.com.

Pushes to GitHub do not themselves deploy Cloudways. Pull main through Cloudways Deployment via GIT, then refresh. Preserve the untracked private config file. Do not reimport the original schema to apply routine code changes. Keep APIs and authenticated pages out of cache. The public domain has its own TLS certificate and domain mapping.

## Branding

Navy #010E3B, red #D8315B, blue #1955BD, Montserrat. Screen logos are white with a transparent background. The supplied JSON animates the logo icon. Reduced-motion preferences show the static SVG. Print uses the dark SVG on white paper.

## Pending, explicitly on hold

- Close requests automatically at **4 AM America/Chicago on the morning after the event date**, using local calendar time across daylight saving changes. This is requested but NOT implemented. Decide handling of undated events and manual reopen when implementing.
- The direct Planner feature does not require n8n. Configure the existing Automation key on the Planner server and opt in from each booking.

Do not assume either pending item is already active. Do not store passwords/API keys in this repository or this document.

## Validation for the API/link update

PHP syntax and JavaScript syntax checked. API behavior tested under PHP 8.3 with a SQLite test adapter for authentication, CSRF, creation/retry, PATCH, invalid dates/fields, key revocation, guest links, and dangerous URL rejection. Production MySQL concurrency and Cloudways runtime still need deployment smoke checks. No live event or production database was changed during development.
