import { Locations } from '../../database/index.js';
import { broadcast, setLastPosition } from '../ws/index.js';

async function loadLastLocation() {
  const sql = 'SELECT id, lat, lon, timestamp, acc, alt, vel, city, address, timezone FROM locations ORDER BY timestamp DESC LIMIT 1';
  const rows = await Locations.orm.all(sql, []);
  return rows && rows.length ? rows[0] : null;
}

export async function getLastLocationRaw() {
  return loadLastLocation();
}

export async function getLastLocation(req, res) {
  try {
    const last = await loadLastLocation();
    if (!last) return res.status(404).json({ error: 'no location' });
    return res.json({ status: 'ok', data: last });
  } catch (e) {
    console.error('GET /locations/last failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export async function postBroadcastLastLocation(req, res) {
  try {
    const last = await loadLastLocation();
    if (!last) return res.status(404).json({ error: 'no location' });

    // Build the same payload shape used for WS 'position' messages
    const { id, ...rest } = last;
    const payload = { type: 'position', ...rest };

    // Update WS lastPosition so new WS clients also receive it on connect
    setLastPosition(rest);
    // Broadcast to all connected WS clients
    broadcast(payload);

    return res.json({ status: 'ok', action: 'broadcasted', data: rest });
  } catch (e) {
    console.error('POST /locations/broadcast-last failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

// Update helper: for all locations of a given day (default 24 Dec current UTC year),
// if |timestamp - createdAt| > 1h, set timestamp = createdAt (in seconds).
export async function updateTemp(req, res) {
  try {
    // Accept query ?date=YYYY-MM-DD, default to current UTC year on 12-24
    const now = new Date();
    const year = now.getUTCFullYear();
    const dateStr = (req.query.date || `${year}-12-24`).toString();

    // Build UTC day range [start, end)
    const start = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ error: 'invalid date, expected YYYY-MM-DD' });
    }
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' '); // YYYY-MM-DD HH:MM:SS
    const startSql = fmt(start);
    const endSql = fmt(end);

    // Fetch rows of that day by createdAt window (createdAt is in UTC by SQLite CURRENT_TIMESTAMP)
    const rows = await Locations.orm.all(
      'SELECT id, timestamp, createdAt FROM locations WHERE createdAt >= ? AND createdAt < ? ORDER BY createdAt ASC',
      [startSql, endSql]
    );

    let total = rows.length;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const ONE_HOUR = 3600; // seconds

    for (const r of rows) {
      try {
        const createdAt = new Date(r.createdAt + 'Z'); // treat as UTC
        const createdSec = Math.floor(createdAt.getTime() / 1000);
        const ts = Number(r.timestamp);
        if (!Number.isFinite(ts)) {
          // If timestamp invalid, set it from createdAt
          await Locations.orm.run('UPDATE locations SET timestamp = ? WHERE id = ?', [createdSec, r.id]);
          updated++;
          continue;
        }
        const diff = Math.abs(ts - createdSec);
        if (diff > ONE_HOUR) {
          await Locations.orm.run('UPDATE locations SET timestamp = ? WHERE id = ?', [createdSec, r.id]);
          updated++;
        } else {
          unchanged++;
        }
      } catch (e) {
        console.error('updateTemp row failed:', e);
        failed++;
      }
    }

    // Return a simple OK message for browser use
    res.type('text/plain').send(`OK (${dateStr}) - total: ${total}, updated: ${updated}, unchanged: ${unchanged}, failed: ${failed}`);
  } catch (e) {
    console.error('GET /locations/update-temp failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export default { getLastLocation, getLastLocationRaw, postBroadcastLastLocation };
