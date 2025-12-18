# OwnTracks → WebSocket Relay Server (with SQLite, stats, and utility APIs)

A minimal Node.js (ESM) server to receive GPS positions from OwnTracks via HTTP POST and broadcast them to stream overlays via WebSocket in real time, with optional reverse geocoding (city/address). The server now persists locations to SQLite, exposes simple statistics, and includes extra helper endpoints (tombola + challenges broadcast).

## Features
- POST `/owntracks` to receive OwnTracks JSON payloads
- Token protection via `Authorization: Bearer <token>` or `?token=` in URL
- WebSocket server at configurable path (default `/ws`) to push latest positions to clients
- Reverse geocoding via OpenStreetMap Nominatim (configurable language/user-agent)
- In-memory cache of the last position (sent immediately to new WS clients)
- SQLite persistence of positions for later analysis
- Distance statistics endpoints (total and per day)
- Extra helper APIs for livestream interactions:
  - Tombola: add tickets and draw weighted winners
  - Challenges: broadcast selected challenge and mark as done (WS messages)

Updated stack and packages:
- Node.js 18+ (ESM only)
- express `^5.2.1`
- ws `^8.18.3`
- node-fetch `^3.3.2` (ESM)
- sqlite3 `^5.1.7`
- tz-lookup `^6.1.25`
- dotenv `^17.2.3`

## Quick Start (local)
1. Install Node.js 18+.
2. In this folder, run:
   ```powershell
   npm install
   # Create .env (see Environment Variables below)
   New-Item -Path . -Name ".env" -ItemType "file" -Force | Out-Null
   notepad .env
   # Then run
   npm start
   ```
3. Open http://localhost:3000/ in your browser.
4. Test WebSocket client: open http://localhost:3000/public/client.html (if served by your reverse proxy) or connect to `ws://localhost:3000/ws`.

Start script and initialization:
- The app starts via `npm start` which runs `src/init.js`. This initializes the SQLite database (tables created if missing) and then launches the HTTP/WS server from `src/server.js`.

Default paths and files:
- Database file at `./database/datas.sqlite` (configurable)
- Public assets served under `/public`

## Environment Variables
- `PORT` (default: `3000`)
- `WS_PATH` (default: `/ws`)
- `OWNTRACKS_TOKEN` (required for `/owntracks`)
- `REVERSE_GEOCODE` (default: `true`) — set to `false` to disable Nominatim lookup
- `NOMINATIM_LANGUAGE` (default: `fr`) — language for reverse geocoding
- `NOMINATIM_EMAIL` — used to build a polite User-Agent if `NOMINATIM_USER_AGENT` is not provided
- `NOMINATIM_USER_AGENT` — full UA string; overrides email-based UA if provided
- `DB_PATH` — custom path to SQLite file; relative to project root if set (quotes are auto-trimmed). Defaults to `database/datas.sqlite`.

Example `.env`:
```
PORT=3000
WS_PATH=/ws
OWNTRACKS_TOKEN=change-me
REVERSE_GEOCODE=true
NOMINATIM_LANGUAGE=fr
NOMINATIM_EMAIL=you@example.com
# NOMINATIM_USER_AGENT=gps-owntracks-ws-server/1.0 (you@example.com)
# DB_PATH=database/datas.sqlite
```

## API
### POST /owntracks
Headers:
- Content-Type: application/json
- Authorization: Bearer YOUR_TOKEN (or provide ?token=YOUR_TOKEN)

Body (example from OwnTracks):
```json
{
  "_type": "location",
  "lat": 43.2965,
  "lon": 5.3698,
  "tst": 1694512345,
  "acc": 20,
  "alt": 50,
  "vel": 0
}
```

Response:
```json
{ "status": "ok" }
```

### WebSocket (default: /ws)
Message format broadcast to all clients on new position:
```json
{
  "type": "position",
  "lat": 43.2965,
  "lon": 5.3698,
  "timestamp": 1694512345,
  "acc": 20,
  "alt": 50,
  "vel": 0,
  "city": "Marseille",
  "address": "10 Rue de la République, 13001 Marseille",
  "timezone": "Europe/Paris"
}
```
Notes:
- address is limited to street + number and up to the city (no region/country).
- timezone is the IANA timezone ID derived from lat/lon.

When a client connects, if a last position is known, it is sent immediately.

Additional WebSocket messages (from helper endpoints):
```json
{
  "type": "challenge",
  "action": "start",
  "challenge": {
    "id": 1,
    "name": "Pushups",
    "presentation_video": null,
    "challenge_video": "https://...",
    "done": false
  },
  "at": "2025-01-01T12:00:00.000Z"
}
```
The `action` can also be `done` or `undone` when marking completion.

#### WebSocket: Events and Front-End Handling

What can be sent over the socket and how to detect it in your frontend.

- Event types currently used:
  - `position` — sent whenever a new OwnTracks location is received. Also sent once on connection if a last position is known.
  - `challenge` — sent when you start a challenge or change its done state via the Challenges API.
    - `action` can be: `start`, `done`, `undone`.

Schemas (examples):

```json
{
  "type": "position",
  "lat": 43.2965,
  "lon": 5.3698,
  "timestamp": 1694512345,
  "acc": 20,
  "alt": 50,
  "vel": 0,
  "city": "Marseille",
  "address": "10 Rue de la République, 13001 Marseille",
  "timezone": "Europe/Paris"
}
```

```json
{
  "type": "challenge",
  "action": "start",
  "challenge": {
    "id": 1,
    "name": "Pushups",
    "presentation_video": null,
    "challenge_video": "https://…",
    "done": false
  },
  "at": "2025-01-01T12:00:00.000Z"
}
```

```json
{
  "type": "challenge",
  "action": "done",
  "challenge": { "id": 1, "name": "Pushups", "done": true },
  "at": "2025-01-01T12:05:00.000Z"
}
```

```json
{
  "type": "challenge",
  "action": "undone",
  "challenge": { "id": 1, "name": "Pushups", "done": false },
  "at": "2025-01-01T12:06:00.000Z"
}
```

Client detection examples (plain JS):

```html
<script>
  const ws = new WebSocket(`ws://${location.host}${'/ws'}`); // or your custom WS_PATH

  ws.addEventListener('open', () => {
    console.log('[WS] connected');
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      console.warn('Non-JSON WS message:', ev.data);
      return;
    }

    switch (msg.type) {
      case 'position': {
        // Example: update map, overlay, or stats
        const { lat, lon, timestamp, city, address, timezone } = msg;
        console.log('Position:', lat, lon, timestamp, city, address, timezone);
        break;
      }
      case 'challenge': {
        // React to challenge lifecycle
        switch (msg.action) {
          case 'start':
            // Show challenge card with videos if provided
            console.log('Challenge started:', msg.challenge);
            break;
          case 'done':
            console.log('Challenge done:', msg.challenge);
            break;
          case 'undone':
            console.log('Challenge undone:', msg.challenge);
            break;
        }
        break;
      }
      default:
        console.log('Unknown WS message type:', msg.type, msg);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] disconnected');
  });
</script>
```

Tip (reconnect): in production UIs, wrap the WebSocket creation in a small function and retry with backoff when `close` fires.

## Reverse Geocoding
This uses OpenStreetMap Nominatim. Set `NOMINATIM_EMAIL` or an explicit `NOMINATIM_USER_AGENT` to be a polite user (used in the `User-Agent`).
You can disable reverse geocoding by setting `REVERSE_GEOCODE=false`.

## Security
- Set `OWNTRACKS_TOKEN` in your `.env` and configure the same token in OwnTracks (HTTP mode) either in Authorization header or as a token query parameter.
- Consider placing this app behind HTTPS via your reverse proxy (Nginx/Apache). OwnTracks may require HTTPS.
- Optionally, secure WebSocket upgrades at the proxy level with a shared token.

## Deployment notes
- Run the app (Node.js) on your server, expose via reverse proxy:
  - Map `POST https://your-domain/owntracks` to `http://localhost:3000/owntracks`
  - Map `WS wss://your-domain/ws` to `ws://localhost:3000/ws` (enable WebSocket upgrades in your proxy)
- Ensure HTTPS is enforced.
- Ensure the process has write access to the `database/` directory (or your custom `DB_PATH`).

## Test with curl
```powershell
$token = "change-me"
$payload = '{"_type":"location","lat":43.2965,"lon":5.3698,"tst":1694512345,"acc":20,"alt":50,"vel":0}'
Invoke-WebRequest -Uri "http://localhost:3000/owntracks" -Method POST -Headers @{"Authorization"="Bearer $token"; "Content-Type"="application/json"} -Body $payload
```
Open a WebSocket client (browser or tool) at ws://localhost:3000/ws to observe the broadcast.

### Tombola examples
- Add tickets (creates or increments user):
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/tombola/new" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"pseudo":"Alice","tickets":5}'
```
- Draw 3 winners (weighted by ticket_count; deterministic with seed):
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/tombola/draw" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"count":3,"seed":12345,"preview":true}'
```

### Challenges examples
- Broadcast a challenge by id:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/challenges/start" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"id":1}'
```
- Mark challenge done:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/challenges/1/done" -Method PUT -Headers @{"Content-Type"="application/json"} -Body '{"done":true}'
```

### Statistics examples
- Total distance (optional range `from`/`to` as seconds since epoch):
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/stats/distance/total?from=1694512000&to=1694599999" -Method GET
```
- Daily distances:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/stats/distance/daily" -Method GET
```

### Download the database file
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/download/datas.sqlite" -OutFile "datas.sqlite"
```


## Timezone format and JavaScript usage
The server sends timezone as an IANA timezone ID (example: "Europe/Paris"). This is the correct format for JavaScript date formatting APIs. In JS, you typically combine:
- locale (e.g., "fr-FR" for French formatting), and
- timeZone (e.g., "Europe/Paris").

Examples:

- Format a timestamp (seconds) into a local string in French for the provided timezone:
```js
const { timestamp, timezone } = message; // timezone like "Europe/Paris"
const date = new Date(timestamp * 1000);
const fmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: timezone,
  dateStyle: 'full',
  timeStyle: 'medium'
});
console.log(fmt.format(date));
```

- Get a short time string:
```js
new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(date)
```

- Get weekday and time:
```js
new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(date)
```

Note:
- Do not replace timezone with "fr-FR". "fr-FR" is a locale; it cannot be used as a timeZone value. Keep timezone as IANA (e.g., "Europe/Paris").
- If you still want the server to also send a suggested locale, we can add a separate field like `locale: "fr-FR"`, but it’s optional; the client can choose any locale.
 
## Database schema (overview)
SQLite tables are created automatically on startup if missing:
- `locations` — raw enriched OwnTracks points: `lat`, `lon`, `timestamp`, `acc`, `alt`, `vel`, `city`, `address`, `timezone`
- `challenges` — id, name, presentation_video, challenge_video, done
- `tombolas` — id, name, ticket_count
- `statistics` — generic key/value store (for future use)

## Changelog (high level)
- Added SQLite persistence and initialization via `src/init.js`
- Added distance statistics endpoints: `/stats/distance/total`, `/stats/distance/daily`
- Added Tombola endpoints: `/tombola/new`, `/tombola/draw`
- Added Challenges endpoints: `/challenges`, `/challenges/start`, `/challenges/:id/done` with WS broadcasts
- Added `/download/datas.sqlite` endpoint to export the database
- Configurable `WS_PATH`, `DB_PATH`, and Nominatim language/UA
- Upgraded to Express 5; ESM-only runtime; updated package versions

— Last updated: 2025‑12‑17
