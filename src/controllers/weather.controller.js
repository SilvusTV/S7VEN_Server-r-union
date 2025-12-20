import { getLastLocationRaw } from './locations.controller.js';
import { fetchCurrentWeather } from '../utils/weather.js';

export async function getCurrentWeather(req, res) {
  try {
    const last = await getLastLocationRaw();
    if (!last) return res.status(404).json({ error: 'no location' });
    const { lat, lon, city, address, timezone } = last;
    const weather = await fetchCurrentWeather(lat, lon, { timezone });
    return res.json({ status: 'ok', data: { location: { lat, lon, city, address, timezone }, weather } });
  } catch (e) {
    console.error('GET /weather/now failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export default { getCurrentWeather };
