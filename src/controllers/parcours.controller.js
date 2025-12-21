import fetch from 'node-fetch';
import sharp from 'sharp';
import { GEOAPIFY_API_KEY } from '../config.js';
import { Locations } from '../../database/index.js';

// Fixed center/zoom to show entire Réunion
const REUNION_CENTER = { lon: 55.53, lat: -21.115 };
// Slightly more zoomed-out to ensure the whole island is always visible
const REUNION_ZOOM = 9; // was 10

// Simple in-memory cache for the generated PNG (buffers) for a short TTL
const cache = new Map(); // key -> { buffer, contentType, expiresAt }
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item;
}

function setCache(key, buffer, contentType = 'image/png') {
  cache.set(key, { buffer, contentType, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Encoded polyline algorithm (Google style) for signed integer deltas in 1e5
function encodeSignedInt(value) {
  let s = value << 1;
  if (value < 0) s = ~s;
  let output = '';
  while (s >= 0x20) {
    output += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
    s >>= 5;
  }
  output += String.fromCharCode(s + 63);
  return output;
}

function encodePolyline(points) {
  // points: array of [lat, lon]
  let lastLat = 0;
  let lastLon = 0;
  let result = '';
  for (const [lat, lon] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    const dLat = latE5 - lastLat;
    const dLon = lonE5 - lastLon;
    result += encodeSignedInt(dLat);
    result += encodeSignedInt(dLon);
    lastLat = latE5;
    lastLon = lonE5;
  }
  return result;
}

async function loadAllLocationsOrdered() {
  const sql = 'SELECT lat, lon, timestamp FROM locations ORDER BY timestamp ASC';
  return Locations.orm.all(sql, []);
}

export async function getParcoursPage(req, res) {
  // Minimal HTML containing a responsive image pointing to /parcours.png
  const w = Number.parseInt(req.query.w, 10) || 800; // hint width
  const h = Number.parseInt(req.query.h, 10) || 600; // hint height
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Parcours — La Réunion</title>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, Arial, sans-serif; background: #111; color: #eee; }
    .wrap { max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    img { max-width: 100%; height: auto; display: block; }
    .hint { opacity: 0.8; font-size: 0.9rem; }
  </style>
  <script>
    // Auto-refresh only the image every 10 minutes with a cache-busting param
    window.addEventListener('DOMContentLoaded', () => {
      const img = document.getElementById('parcours-img');
      if (!img) return;
      const refresh = () => {
        try {
          const url = new URL(img.src, window.location.href);
          url.searchParams.set('cb', String(Date.now()));
          img.src = url.toString();
        } catch (_) {}
      };
      // 10 minutes interval
      setInterval(refresh, 10 * 60 * 1000);
    });
  </script>
  </head>
  <body>
    <div class="wrap">
      <img id="parcours-img" src="/parcours.png?w=${encodeURIComponent(w)}&h=${encodeURIComponent(h)}" alt="Parcours La Réunion" />
    </div>
  </body>
</html>`;
  res.type('html').send(html);
}

export async function getParcoursImage(req, res) {
  try {
    if (!GEOAPIFY_API_KEY) {
      return res.status(500).json({ error: 'GEOAPIFY_API_KEY manquant côté serveur' });
    }

    // Parse width/height with sane bounds
    let width = Number.parseInt(req.query.w, 10);
    let height = Number.parseInt(req.query.h, 10);
    if (!Number.isFinite(width)) width = 800; // default size divided by two
    if (!Number.isFinite(height)) height = 600;
    width = Math.max(180, Math.min(1600, width));
    height = Math.max(120, Math.min(1200, height));

    // Optional parameters for debugging/tuning
    const modulo = Number.isFinite(Number.parseInt(req.query.modulo, 10))
      ? Math.max(1, Number.parseInt(req.query.modulo, 10))
      : 10;
    const weight = Number.isFinite(Number.parseInt(req.query.weight, 10))
      ? Math.max(1, Math.min(32, Number.parseInt(req.query.weight, 10)))
      : 8;
    // Normalize color to Geoapify expected hex without prefix (e.g., ff0000ff)
    let color = (req.query.color || 'ff0000ff').toString();
    if (color.startsWith('0x') || color.startsWith('0X')) color = color.slice(2);
    if (color.startsWith('#')) color = color.slice(1);
    color = color.toLowerCase();
    const order = (req.query.order || 'latlon').toLowerCase(); // 'latlon' (default) or 'lonlat'
    const zoomOverride = Number.parseInt(req.query.z, 10);
    const debug = (req.query.debug || '') === '1';
    // Tile size used for Web Mercator world size at given zoom. For some providers (512px tiles),
    // using 256 here causes the overlay to look "more zoomed out" than the background.
    // Geoapify renders static maps compatible with 512px tiles — set 512 by default.
    const tileSizeParam = Number.parseInt(req.query.ts, 10);
    const TILE_SIZE = Number.isFinite(tileSizeParam) ? Math.max(128, Math.min(1024, tileSizeParam)) : 512;
    const renderMode = (req.query.render || 'server').toLowerCase(); // 'server' (compose PNG) or 'geoapify'

    const rows = await loadAllLocationsOrdered();
    if (!rows.length) {
      // If no data, return a simple empty map image centered on Réunion
      const emptyUrl = new URL('https://maps.geoapify.com/v1/staticmap');
      emptyUrl.searchParams.set('style', 'osm-carto');
      emptyUrl.searchParams.set('width', String(width));
      emptyUrl.searchParams.set('height', String(height));
      emptyUrl.searchParams.set('format', 'png');
      emptyUrl.searchParams.set('center', `lonlat:${REUNION_CENTER.lon},${REUNION_CENTER.lat}`);
      emptyUrl.searchParams.set('zoom', String(REUNION_ZOOM));
      emptyUrl.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const cacheKey = `empty-${width}x${height}`;
      const cached = getCache(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        return res.send(cached.buffer);
      }
      const r = await fetch(emptyUrl.toString());
      const buf = Buffer.from(await r.arrayBuffer());
      setCache(cacheKey, buf, r.headers.get('content-type') || 'image/png');
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
      return res.send(buf);
    }

    // Downsample points (modulo), ensure last point is included
    const filtered = rows.filter((_, idx) => idx % modulo === 0);
    if (filtered[filtered.length - 1] !== rows[rows.length - 1]) {
      filtered.push(rows[rows.length - 1]);
    }

    const z = Number.isFinite(zoomOverride) ? zoomOverride : REUNION_ZOOM;
    // If renderMode=geoapify, fallback to provider-drawn polyline (kept for comparison)
    if (renderMode === 'geoapify') {
      const points = filtered.map((r) => (order === 'lonlat' ? [r.lon, r.lat] : [r.lat, r.lon]));
      const enc = encodePolyline(points);
      const url = new URL('https://maps.geoapify.com/v1/staticmap');
      url.searchParams.set('style', 'osm-carto');
      url.searchParams.set('width', String(width));
      url.searchParams.set('height', String(height));
      url.searchParams.set('format', 'png');
      url.searchParams.set('center', `lonlat:${REUNION_CENTER.lon},${REUNION_CENTER.lat}`);
      url.searchParams.set('zoom', String(z));
      url.searchParams.set('path', `stroke:${color};strokeWidth:${weight};line:round;enc:${enc}`);
      url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const lastTs = rows[rows.length - 1].timestamp;
      const cacheKey = `${width}x${height}:${lastTs}:geo:m${modulo}:w${weight}:o${order}:z${z}`;
      if (debug) {
        return res.json({
          mode: 'geoapify',
          totalPoints: rows.length,
          filteredPoints: filtered.length,
          url: url.toString().replace(GEOAPIFY_API_KEY, '***')
        });
      }
      const cached = getCache(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        return res.send(cached.buffer);
      }
      const response = await fetch(url.toString());
      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({ error: 'Geoapify error', details: text });
      }
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const contentType = response.headers.get('content-type') || 'image/png';
      setCache(cacheKey, buf, contentType);
      res.setHeader('Content-Type', contentType);
      return res.send(buf);
    }

    // renderMode=server: compose background + our own polyline overlay
    // 1) Fetch background map without path
    const bgUrl = new URL('https://maps.geoapify.com/v1/staticmap');
    bgUrl.searchParams.set('style', 'osm-carto');
    bgUrl.searchParams.set('width', String(width));
    bgUrl.searchParams.set('height', String(height));
    bgUrl.searchParams.set('format', 'png');
    bgUrl.searchParams.set('center', `lonlat:${REUNION_CENTER.lon},${REUNION_CENTER.lat}`);
    bgUrl.searchParams.set('zoom', String(z));
    bgUrl.searchParams.set('apiKey', GEOAPIFY_API_KEY);

    // 2) Project lat/lon to pixel coordinates in the image (Web Mercator)
    const toWorldPixels = (lat, lon, zoom) => {
      const sinLat = Math.sin((lat * Math.PI) / 180);
      const worldSize = TILE_SIZE * Math.pow(2, zoom);
      const x = ((lon + 180) / 360) * worldSize;
      const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
      return { x, y };
    };
    const centerPx = toWorldPixels(REUNION_CENTER.lat, REUNION_CENTER.lon, z);
    const toImagePx = (lat, lon) => {
      const p = toWorldPixels(lat, lon, z);
      return {
        x: Math.round((p.x - centerPx.x) + width / 2),
        y: Math.round((p.y - centerPx.y) + height / 2)
      };
    };

    // Build polyline points (clip to image bounds gently)
    const svgPoints = [];
    for (const r of filtered) {
      const { x, y } = toImagePx(r.lat, r.lon);
      svgPoints.push(`${x},${y}`);
    }

    // Build day-change markers based on all rows (not only filtered)
    const markers = [];
    const DAY_SEC = 86400;
    const REUNION_TZ_OFFSET_SEC = 4 * 3600; // UTC+4
    const dayKey = (ts) => Math.floor((Number(ts) + REUNION_TZ_OFFSET_SEC) / DAY_SEC);
    const formatDayLabel = (ts) => {
      // Shift epoch by +4h then read using UTC getters to avoid local TZ
      const d = new Date((Number(ts) + REUNION_TZ_OFFSET_SEC) * 1000);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}`; // ex: 21/12
    };
    // Also add a marker at the start of the very first day with its date
    let prevKey = null;
    if (rows.length > 0) {
      const first = rows[0];
      const firstLabel = formatDayLabel(first.timestamp);
      const { x: fx, y: fy } = toImagePx(first.lat, first.lon);
      const ftextX = Math.max(4, Math.min(width - 4, fx));
      const ftextY = Math.max(12, Math.min(height - 4, fy + 14));
      markers.push({ x: fx, y: fy, label: firstLabel, textX: ftextX, textY: ftextY });
    }
    for (const r of rows) {
      const k = dayKey(r.timestamp);
      if (prevKey !== null && k !== prevKey) {
        // day changed at this row
        const { x, y } = toImagePx(r.lat, r.lon);
        const label = formatDayLabel(r.timestamp);
        // Place label slightly below the point; keep inside image bounds
        const textX = Math.max(4, Math.min(width - 4, x));
        const textY = Math.max(12, Math.min(height - 4, y + 14));
        markers.push({ x, y, label, textX, textY });
      }
      prevKey = k;
    }

    // Parse color to #rrggbb + opacity
    const parseRgbaHex = (hex) => {
      // hex: rrggbb or rrggbbaa
      const clean = hex.toLowerCase();
      const rr = parseInt(clean.slice(0, 2), 16);
      const gg = parseInt(clean.slice(2, 4), 16);
      const bb = parseInt(clean.slice(4, 6), 16);
      let a = 1;
      if (clean.length >= 8) a = Math.round((parseInt(clean.slice(6, 8), 16) / 255) * 1000) / 1000;
      const hex6 = `#${clean.slice(0, 6)}`;
      return { hex6, opacity: a, r: rr, g: gg, b: bb };
    };
    const { hex6, opacity } = parseRgbaHex(color);

    // 3) Create SVG overlay (polyline + day-change markers)
    const circles = markers
      .map((m) => `<circle cx="${m.x}" cy="${m.y}" r="5" fill="#ffffff" stroke="#000000" stroke-width="2" />`)
      .join('');
    const labels = markers
      .map((m) => `
    <text x="${m.textX}" y="${m.textY}" text-anchor="middle" font-family="system-ui, Arial, sans-serif" font-size="12" font-weight="600" fill="#000000" stroke="#ffffff" stroke-width="2" paint-order="stroke">
      ${m.label}
    </text>`)
      .join('');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <polyline points="${svgPoints.join(' ')}" fill="none" stroke="${hex6}" stroke-opacity="${opacity}" stroke-width="${weight}" stroke-linejoin="round" stroke-linecap="round" />
  ${circles}
  ${labels}
</svg>`;

    const lastTs = rows[rows.length - 1].timestamp;
    const cacheKey = `${width}x${height}:${lastTs}:srv:m${modulo}:w${weight}:z${z}`;
    if (debug) {
      return res.json({
        mode: 'server',
        totalPoints: rows.length,
        filteredPoints: filtered.length,
        svgPoints: svgPoints.length,
        bgUrl: bgUrl.toString().replace(GEOAPIFY_API_KEY, '***'),
        tileSize: TILE_SIZE,
        zoomUsed: z,
        dayMarkers: markers.length
      });
    }
    const cached = getCache(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.buffer);
    }

    const bgResp = await fetch(bgUrl.toString());
    if (!bgResp.ok) {
      const text = await bgResp.text();
      return res.status(502).json({ error: 'Geoapify background error', details: text });
    }
    const bgBuf = Buffer.from(await bgResp.arrayBuffer());
    // Composite with sharp
    let outBuf;
    try {
      outBuf = await sharp(bgBuf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
    } catch (e) {
      console.error('Sharp composite failed, returning background only:', e);
      outBuf = bgBuf; // fallback
    }
    setCache(cacheKey, outBuf, 'image/png');
    res.setHeader('Content-Type', 'image/png');
    return res.send(outBuf);
  } catch (e) {
    console.error('GET /parcours.png failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export default { getParcoursPage, getParcoursImage };
