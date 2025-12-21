import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const WS_PATH = process.env.WS_PATH || '/ws';
export const OWNTRACKS_TOKEN = process.env.OWNTRACKS_TOKEN || '';
// Nominatim requires a valid User-Agent and recommends including contact email
export const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || `gps-owntracks-ws-server/1.0 (${process.env.NOMINATIM_EMAIL || 'you@example.com'})`;
export const NOMINATIM_LANGUAGE = process.env.NOMINATIM_LANGUAGE || 'fr';
export const REVERSE_GEOCODE = (process.env.REVERSE_GEOCODE || 'true').toLowerCase() !== 'false';
// Geoapify Static Maps API key (for /parcours map image)
export const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';
// SQLite database path (default to ./database/datas.sqlite)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Clean accidental surrounding quotes in DB_PATH to avoid sqlite open errors
const rawDbPath = (process.env.DB_PATH || '').replace(/^['"]|['"]$/g, '');
export const DB_PATH = rawDbPath
  ? path.resolve(__dirname, '..', rawDbPath)
  : path.resolve(__dirname, '..', 'database', 'datas.sqlite');

export const CHANNEL_NAME = process.env.TWITCH_CHANNEL;
export const OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN;
export const BOT_USERNAME = process.env.TWITCH_BOT_USERNAME;
