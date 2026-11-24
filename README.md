# Go Event DJ Song Requests: Cloudways PHP edition

A PHP 8.4 and MySQL/MariaDB conversion of the standalone Python Song Requests app, for Cloudways Flexible Custom PHP apps. This is **not** the Lovable project. The original mobile guest and DJ interfaces are retained. Requires HTTPS before real-world use. Not published or connected to the user's Cloudways server.

## Layout

- `public_html/`: web root, PHP API router, existing UI assets
- `private/config.example.php`: starter config (copy to `private/config.php` and fill in real values)
- `schema.sql`: run in Cloudways Database Manager

Keep the `private` directory **outside** `public_html`. Only the placeholder `private/config.example.php` belongs in Git; keep the real `private/config.php` and all other secrets out of the repository.

## GitHub source layout

The extracted source is stored at the repository root, preserving `public_html/` and its sibling `private/`. The ZIP is not needed and must not be committed. Do not pull this entire repository directly into the server's `public_html/`: that would nest the web root and place private configuration under it. Before any future Git deployment, verify that the destination preserves these sibling directories and that the web root points only to `public_html/`. Cloudways deployment remains on hold.

## Cloudways setup

1. In the Cloudways application, open **Access Details** and note the Application URL, DB Name, DB Username, and DB Password. Do not share passwords in chat.
2. Open **Launch Database Manager**. Select your application's database and use its SQL editor/import to run `schema.sql`. Verify six tables appear: `events`, `requests`, `votes`, `rate_events`, `admin_sessions`, `settings`.
3. Copy `private/config.example.php` to `private/config.php` on your computer. Edit the database values from Cloudways. On Cloudways Flexible MySQL, `127.0.0.1` and port `3306` are typical; check your environment.
4. Make a long unique DJ password and generate a hash locally:

   ```bash
   php -r 'echo password_hash("YOUR_LONG_DJ_PASSWORD", PASSWORD_DEFAULT), PHP_EOL;'
   ```

   Paste only the hash into `admin_password_hash`. Generate `app_secret`:

   ```bash
   php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
   ```

5. Set `base_url` to **your actual temporary Cloudways application URL**, with `https://`, no trailing slash. Do not print the QR sign until the permanent custom domain is configured.
6. Upload the **contents** of `public_html/` into the Cloudways application's `public_html/` using SFTP. Upload `private/config.php` to the app's root-level `private/` folder so it sits beside `public_html/`, not inside it. Uploading via Git is also possible, but never commit the config file or passwords.
7. Verify SSL/HTTPS and the application URL. Visit `/requests` (shows a closed state initially) and `/admin` (DJ login). Sign in with the password you configured, create a test event, Activate, then Open Requests. Use a second browser/device to submit songs. Confirm votes, duplicate behavior, mark played/skip, close, and archive. Then open `/qr` while signed in.
8. When ready, map `requests.goeventdj.com` in **Domain Management**, configure SSL, update `base_url` in `private/config.php` to that HTTPS URL, then print the permanent QR sign.

## Behavior

- Public requests and voting are scoped to the currently active, open event; clients don't see event history or DJ notes.
- One browser cookie can vote once per song. A determined user can reset cookies; this is not a verified identity system.
- DJ login is password-based with 8-hour HttpOnly session and CSRF protection. A request-rate limiter applies to logins, submissions and votes. Strong password and HTTPS are mandatory.
- Requests are stored persistently in MySQL. An event may be closed or archived without deleting its history.
- Guest queue refresh: 12 seconds. DJ dashboard refresh: 12 seconds. No music playback or streaming.
- The QR image uses an external HTTPS QR generation service (`api.qrserver.com`), which sees the public request URL. Replace it with server-side generated QR later if that is undesirable.
- Tip and review URLs require HTTPS and are configured under DJ settings.

## Cloudways note

The PHP application is designed for an Apache rewrite setup through `.htaccess`. If `/requests` works but `/api/board` returns the server's own 404, check the application's Web Rules / routing and whether `.htaccess` rewrites are honored by its web stack. Depending on Cloudways stack and caching, you may need to exclude `/api/*` from cache and flush caches. Don't cache JSON responses or authenticated admin routes.

## Test limitations

This deliverable was syntax-checked with PHP CLI and source asset checks. It was **not live-tested against your Cloudways database or runtime**, because server access and credentials were not provided. Test guest voting, DB permissions, rewrite rules, and authentication on the temporary URL before public launch. Review the QR service and back up your Cloudways database.

## Brand assets

The guest page, DJ dashboard, and QR sign use the original SVG in `public_html/static/images/go-event-dj-logo.svg`. A white background preserves the navy and black artwork on the dark interface and printed sign. Each page uses `favicon-96x96.png` as its browser icon.

The supplied `go-event-dj-logo.json` is a 10-second Lottie animation, retained as a brand asset for future use. The interface uses the static SVG and does not load an animation player.
