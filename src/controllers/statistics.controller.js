import { Locations } from '../../database/index.js';
import { haversineMeters } from '../utils/distance.js';

function parseRange(query) {
  const from = query.from ? Number(query.from) : null;
  const to = query.to ? Number(query.to) : null;
  const validFrom = Number.isFinite(from) ? from : null;
  const validTo = Number.isFinite(to) ? to : null;
  return { from: validFrom, to: validTo };
}

async function loadLocationsOrdered(from = null, to = null) {
  // Build SQL manually to leverage ordering and range filtering
  let sql = 'SELECT lat, lon, timestamp FROM locations';
  const params = [];
  const where = [];
  if (from != null) { where.push('timestamp >= ?'); params.push(from); }
  if (to != null) { where.push('timestamp <= ?'); params.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY timestamp ASC';
  return Locations.orm.all(sql, params);
}

function dayKeyUTC(tsSec) {
  const d = new Date(tsSec * 1000);
  // Use UTC day to avoid timezone drift; can be adapted later based on stored timezone
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // ISO date
}

function computeDistances(points) {
  let total = 0;
  const daily = new Map(); // dateStr -> meters
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    // Skip duplicates or zero movement
    if (a.lat === b.lat && a.lon === b.lon) continue;
    const dist = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    if (!Number.isFinite(dist)) continue;
    total += dist;
    const key = dayKeyUTC(b.timestamp);
    daily.set(key, (daily.get(key) || 0) + dist);
  }
  // Convert map to sorted array
  const perDay = Array.from(daily.entries())
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([date, meters]) => ({ date, meters, km: Math.round((meters / 1000) * 100) / 100 }));
  return { totalMeters: total, totalKm: Math.round((total / 1000) * 100) / 100, perDay };
}

export async function getDailyDistance(req, res) {
  try {
    const { from, to } = parseRange(req.query || {});
    const pts = await loadLocationsOrdered(from, to);
    const { perDay } = computeDistances(pts);
    return res.json({ status: 'ok', data: perDay });
  } catch (e) {
    console.error('GET /stats/distance/daily failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export async function getTotalDistance(req, res) {
  try {
    const { from, to } = parseRange(req.query || {});
    const pts = await loadLocationsOrdered(from, to);
    const { totalMeters, totalKm } = computeDistances(pts);
    return res.json({ status: 'ok', data: { meters: totalMeters, km: totalKm } });
  } catch (e) {
    console.error('GET /stats/distance/total failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export default { getDailyDistance, getTotalDistance };
