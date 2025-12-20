import { Locations } from '../../database/index.js';

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

export default { getLastLocation, getLastLocationRaw };
