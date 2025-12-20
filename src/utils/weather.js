// Simple Open‑Meteo client (no API key needed)
// Docs: https://open-meteo.com/en/docs
import fetch from 'node-fetch';

const WMO_FR = {
  0: 'ciel dégagé',
  1: 'principalement dégagé',
  2: 'partiellement nuageux',
  3: 'couvert',
  45: 'brouillard',
  48: 'brouillard givrant',
  51: 'bruine légère',
  53: 'bruine modérée',
  55: 'bruine forte',
  56: 'bruine verglaçante légère',
  57: 'bruine verglaçante forte',
  61: 'pluie faible',
  63: 'pluie modérée',
  65: 'pluie forte',
  66: 'pluie verglaçante légère',
  67: 'pluie verglaçante forte',
  71: 'neige faible',
  73: 'neige modérée',
  75: 'fortes chutes de neige',
  77: 'grains de neige',
  80: 'averses de pluie faibles',
  81: 'averses de pluie modérées',
  82: 'fortes averses de pluie',
  85: 'averses de neige faibles',
  86: 'averses de neige fortes',
  95: 'orage',
  96: 'orage avec grêle faible',
  99: 'orage avec grêle forte',
};

function labelFromCode(code) {
  return WMO_FR[Number(code)] || 'conditions inconnues';
}

export async function fetchCurrentWeather(lat, lon, opts = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Invalid coordinates');
  }
  const tz = opts.timezone || 'auto';
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone: tz,
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error(`Open-Meteo error: ${res.status}`);
  }
  const data = await res.json();
  const c = (data && data.current) || {};
  const temperature = typeof c.temperature_2m === 'number' ? c.temperature_2m : null;
  const apparent = typeof c.apparent_temperature === 'number' ? c.apparent_temperature : null;
  const code = typeof c.weather_code === 'number' ? c.weather_code : null;
  const windKmh = typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : null;
  const windGustKmh = typeof c.wind_gusts_10m === 'number' ? c.wind_gusts_10m : null;
  const windDir = typeof c.wind_direction_10m === 'number' ? c.wind_direction_10m : null;
  const timeISO = c.time || null;

  return {
    temperature,
    apparent,
    windKmh,
    windGustKmh,
    windDir,
    code,
    label: labelFromCode(code),
    timeISO,
    provider: 'open-meteo',
    url,
  };
}

export default { fetchCurrentWeather };
