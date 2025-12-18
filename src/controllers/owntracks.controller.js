import tzLookup from 'tz-lookup';
import { authOwnTracks } from '../utils/auth.js';
import { Locations } from '../../database/index.js';
import { reverseGeocode } from '../utils/geocode.js';
import { broadcast, setLastPosition } from '../ws/index.js';

function validateOwnTracksPayload(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON body' };
  if (body._type !== 'location') return { ok: false, error: 'Unsupported _type' };
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'lat/lon missing or invalid' };
  const tst = body.tst !== undefined ? Number(body.tst) : Math.floor(Date.now() / 1000);
  return { ok: true, lat, lon, tst, acc: Number(body.acc) || undefined, alt: Number(body.alt) || undefined, vel: Number(body.vel) || undefined };
}

export async function postOwnTracks(req, res) {
  if (!authOwnTracks(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const v = validateOwnTracksPayload(req.body);
  if (!v.ok) {
    return res.status(400).json({ error: v.error });
  }
  const { lat, lon, tst, acc, alt, vel } = v;
  const { city, address } = await reverseGeocode(lat, lon);
  let timezone;
  try {
    timezone = tzLookup(lat, lon);
  } catch (e) {
    console.warn('Timezone lookup failed:', e.message);
    timezone = undefined;
  }
  const enriched = {
    type: 'position',
    lat,
    lon,
    timestamp: tst,
    acc,
    alt,
    vel,
    city,
    address,
    timezone
  };
  // Persist location for statistics
  try {
    await Locations.insert({ lat, lon, timestamp: tst, acc, alt, vel, city, address, timezone });
  } catch (e) {
    console.error('Failed to persist location:', e);
  }
  setLastPosition(enriched);
  broadcast(enriched);
  return res.json({ status: 'ok' });
}

export default { postOwnTracks };
