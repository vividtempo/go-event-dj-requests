# Event automation API

Base URL: `https://requests.goeventdj.com/api/v1`

## Enable

After deploying this update, sign in at `/admin`, open **Settings → Automation API**, and choose **Create API key**. Copy the key into an n8n Header Auth credential with header name `X-API-Key`. It is shown once and only its SHA-256 hash is stored in MySQL. Replacing or revoking it immediately disables the previous key. Use HTTPS. Never place the key in a URL, GitHub, or a workflow body.

The first authenticated Settings visit creates the new tables if absent. Existing events, requests, passwords, and configuration are preserved; no schema reimport is needed. This requires the application's MySQL user to have CREATE TABLE permission. If it does not, an administrator can create the three new tables from the end of `schema.sql` before opening Settings.

## n8n: create or sync a booking

HTTP Request node:
- Method: **POST**
- URL: `https://requests.goeventdj.com/api/v1/events`
- Authentication: **Generic Credential Type → Header Auth**, using the credential above
- Body content type: **JSON**

```json
{
  "external_id": "booking-system:12345",
  "name": "Smith Wedding Reception",
  "date": "2027-06-12",
  "venue": "Example Venue"
}
```

`external_id` is required and must be a stable, unique, case-sensitive ID (maximum 120 characters). Prefix it with the source system when combining sources. Repeated POSTs with that ID update the same event instead of duplicating it, including retries. The ID cannot be reassigned. `name` is required on creation (maximum 120 characters). `date` is optional, a real YYYY-MM-DD date or an empty string; `venue` is optional (maximum 160 characters).

Creation returns HTTP 201; an update/retry returns 200:

```json
{"created":true,"event":{"id":42,"external_id":"booking-system:12345","name":"Smith Wedding Reception","date":"2027-06-12","venue":"Example Venue","is_active":false,"requests_open":false,"archived":false,"created_at":1800000000}}
```

The numeric event ID and timestamp shown are examples. Save the returned ID if you plan to use PATCH.

## Edit one event

**PATCH** `https://requests.goeventdj.com/api/v1/events/42`

Use the same Header Auth credential and JSON body:

```json
{"date":"2027-06-13","venue":"New Venue"}
```

Only `name`, `date`, and `venue` can be changed. Omitted fields are preserved. Empty date or venue clears that value; name cannot be empty. PATCH also works for events created manually in the dashboard. Missing IDs return 404. An empty PATCH returns 400.

## Read events

- **GET** `/events/42` returns `{"event":{...}}`.
- **GET** `/events` returns up to 100 records in ascending ID order and `next_after_id`.
- For more records, use **GET** `/events?after_id=100` with the returned cursor until `next_after_id` is null.

All routes require the key. Event responses include name, date, venue, external ID, creation timestamp, and active/open/archive flags. Guest requests, guest notes, votes, passwords, and API key hashes are not exposed.

## Behavior and errors

New events are inactive with requests closed. Imports and PATCH never activate, open, close, archive, or restore an event. The DJ controls those actions in the dashboard. API imports do not interrupt a live event.

- 400: invalid fields, invalid calendar date, missing external ID/name, or empty PATCH.
- 401: missing, invalid, or revoked key.
- 404: missing event or unknown endpoint.
- 405: unsupported HTTP method.
- 429: rate limit; wait before retrying (120 calls per 60 seconds per key; shared rate limiter is approximate under concurrency).
- 503: database/configuration problem; initialize API settings first.

Errors return `{"detail":"Explanation"}`. Use POST with the same external ID when retrying an uncertain creation result. Do not retry validation failures unchanged.

No n8n workflow is installed by this update. Date-based closing is not implemented yet.

## Direct Planner sync

`POST /api/v1/events/planner-sync` uses the same Automation key. It accepts an
`external_id` of `planner:<32-character Planner event ID>`, `name`, `date`,
`venue`, integer UNIX timestamps `opens_at` and `closes_at`, IANA
`timezone`, and a positive `source_revision`. The exclusive closing
timestamp may fall on the next local day. Send zero for both timestamps to
disable the window. The first authorized sync creates the schedule table.

An optional numeric `target_event_id` links an existing session without
recreating it or moving its request history. If already linked, the stable
external ID selects the same session. A stale revision or a link to another
booking is rejected rather than replacing the newer booking data. The returned
event includes its numeric ID and the saved window. Existing API endpoints
continue to support manually run events without changing their behavior.

A single eligible schedule opens automatically. A manual DJ selection takes
priority. Two overlapping scheduled sessions with no DJ selection leave the
board closed. The DJ can close or resume a session, and resync does not reset
a manual pause. Guests submit to the session they loaded, so a stale browser
cannot send a song to a different event during a changeover.
