import fetch from 'node-fetch';
import { NOMINATIM_LANGUAGE, NOMINATIM_USER_AGENT, REVERSE_GEOCODE } from '../config.js';

export async function reverseGeocode(lat, lon) {
  if (!REVERSE_GEOCODE) return { city: undefined, address: undefined };
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    addressdetails: '1',
    zoom: '18',
    'accept-language': NOMINATIM_LANGUAGE
  });
  const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': NOMINATIM_LANGUAGE
      }
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county;

    const streetName =
      a.road || a.street || a.pedestrian || a.footway || a.path || a.cycleway ||
      a.residential || a.industrial || a.tertiary || a.secondary || a.primary ||
      a.place || a.square || a.boulevard || a.avenue || a.drive || a.lane;
    const streetNumber = a.house_number || a.house_name || a.building;

    let street = [streetNumber, streetName].filter(Boolean).join(' ').trim();
    if (!street) {
      if (data.name) {
        street = data.name;
      } else if (a.neighbourhood || a.suburb || a.hamlet || a.quarter || a.locality) {
        street = a.neighbourhood || a.suburb || a.hamlet || a.quarter || a.locality;
      }
    }

    const line2 = [a.postcode, city].filter(Boolean).join(' ').trim();
    const address = [street, line2].filter(Boolean).join(', ');

    if (!street) {
      console.info('Reverse geocoding: no street-level info at', lat, lon, '-> returning', address);
    }

    return { city, address };
  } catch (e) {
    console.warn('Reverse geocoding failed:', e.message);
    return { city: undefined, address: undefined };
  }
}

export default { reverseGeocode };
