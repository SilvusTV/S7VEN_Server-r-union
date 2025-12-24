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

export async function getTotalDistanceRaw(){
  const pts = await loadLocationsOrdered();
  const { totalMeters, totalKm } = computeDistances(pts);
  return { meters: totalMeters, km: totalKm };
}

export async function getDailyDistanceRaw(){
  const pts = await loadLocationsOrdered();
  const { perDay } = computeDistances(pts);
  return { perDay };
}

// ---- Comprehensive parcours stats ----

function parseNumber(n, def) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function dayKeyWithTz(tsSec, tzHours) {
  const key = Math.floor((Number(tsSec) + tzHours * 3600) / 86400);
  return key;
}

function formatDayLabelFromKey(dayKey, tzHours) {
  // Recreate date from epoch day key (approx): take midnight UTC then subtract tz
  const ts = (dayKey * 86400 - tzHours * 3600) * 1000;
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function getParcoursStats(req, res) {
  try {
    const q = req.query || {};
    // Accept from/to as epoch seconds; optional
    const from = q.from != null ? Number(q.from) : null;
    const to = q.to != null ? Number(q.to) : null;
    const tz = parseNumber(q.tz, 4); // Réunion UTC+4 by default
    const modulo = Math.max(1, parseInt(q.modulo ?? '1', 10));
    const minSpeedKmh = Math.max(0, parseNumber(q.minSpeedKmh, 1));
    const fillAlt = String(q.fillAlt ?? '1').toLowerCase();
    const fillAltitude = !(fillAlt === '0' || fillAlt === 'false' || fillAlt === 'no');
    const elevMinDelta = Math.max(0, parseNumber(q.elevMinDelta, 1)); // meters threshold to filter noise

    // Load ordered points with relevant fields
    let sql = 'SELECT lat, lon, timestamp, acc, alt, vel, createdAt FROM locations';
    const params = [];
    const where = [];
    if (Number.isFinite(from)) { where.push('timestamp >= ?'); params.push(from); }
    if (Number.isFinite(to)) { where.push('timestamp <= ?'); params.push(to); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY timestamp ASC';
    const rows = await Locations.orm.all(sql, params);

    if (!rows.length) {
      return res.json({ status: 'ok', data: { summary: { points: 0 } } });
    }

    // Downsample if requested
    const points = rows.filter((_, i) => i % modulo === 0);
    if (points[points.length - 1] !== rows[rows.length - 1]) points.push(rows[rows.length - 1]);

    // Aggregates
    let totalMeters = 0;
    let totalTimeSec = Math.max(0, Number(points[points.length - 1].timestamp) - Number(points[0].timestamp));
    let movingTimeSec = 0;
    let maxSpeedKmh = 0;
    let gapsOver1h = 0;

    // Elevation
    let elevGain = 0;
    let elevLoss = 0;
    let minAlt = Number.POSITIVE_INFINITY;
    let maxAlt = Number.NEGATIVE_INFINITY;
    let lastAltKnown = null;

    // Accuracy
    let accSum = 0;
    let accCount = 0;

    // BBox
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;

    // Per-day buckets (metrics) and separate per-day time span from first to last point of the day
    const daily = new Map();
    const dailySpan = new Map(); // key -> { firstTs, lastTs }

    // Build day spans from ALL rows (not downsampled) to ensure we take the true first/last timestamps
    for (const r of rows) {
      const k = dayKeyWithTz(r.timestamp, tz);
      let span = dailySpan.get(k);
      if (!span) {
        span = { firstTs: Number(r.timestamp), lastTs: Number(r.timestamp) };
        dailySpan.set(k, span);
      } else {
        const tsn = Number(r.timestamp);
        if (tsn < span.firstTs) span.firstTs = tsn;
        if (tsn > span.lastTs) span.lastTs = tsn;
      }
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const lat = Number(p.lat), lon = Number(p.lon);
      if (Number.isFinite(p.acc)) { accSum += Number(p.acc); accCount++; }
      if (Number.isFinite(p.alt)) lastAltKnown = Number(p.alt);
      if (Number.isFinite(lastAltKnown)) {
        if (lastAltKnown < minAlt) minAlt = lastAltKnown;
        if (lastAltKnown > maxAlt) maxAlt = lastAltKnown;
      }
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;

      if (i === 0) continue;
      const prev = points[i - 1];
      const dt = Math.max(0, Number(p.timestamp) - Number(prev.timestamp));
      if (dt >= 3600) gapsOver1h++;
      if (dt <= 0) continue;

      // Distance
      const dist = haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      if (Number.isFinite(dist)) {
        totalMeters += dist;
      }

      // Speed and moving time
      const speedKmh = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;
      if (Number.isFinite(speedKmh)) {
        if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh;
        if (speedKmh >= minSpeedKmh) movingTimeSec += dt;
      }

      // Elevation gain/loss
      let prevAlt = Number.isFinite(prev.alt) ? Number(prev.alt) : (fillAltitude ? lastAltKnown : NaN);
      let currAlt = Number.isFinite(p.alt) ? Number(p.alt) : (fillAltitude ? lastAltKnown : NaN);
      if (!Number.isFinite(prevAlt) && Number.isFinite(lastAltKnown)) prevAlt = lastAltKnown;
      if (!Number.isFinite(currAlt) && Number.isFinite(lastAltKnown)) currAlt = lastAltKnown;
      if (Number.isFinite(prevAlt) && Number.isFinite(currAlt)) {
        const delta = currAlt - prevAlt;
        if (Math.abs(delta) >= elevMinDelta) {
          if (delta > 0) elevGain += delta; else elevLoss += -delta;
        }
      }

      // Daily bucket for destination point day
      const key = dayKeyWithTz(p.timestamp, tz);
      if (!daily.has(key)) daily.set(key, {
        date: null,
        meters: 0,
        seconds: 0, // will be replaced by day span (last-first)
        movingSeconds: 0,
        elevationGain: 0,
        elevationLoss: 0,
        maxSpeedKmh: 0,
        points: 0,
      });
      const d = daily.get(key);
      d.meters += Number.isFinite(dist) ? dist : 0;
      if (Number.isFinite(speedKmh) && speedKmh >= minSpeedKmh) d.movingSeconds += dt;
      if (Math.abs(Number.isFinite(prevAlt) && Number.isFinite(currAlt) ? currAlt - prevAlt : 0) >= elevMinDelta) {
        const delta = (Number.isFinite(prevAlt) && Number.isFinite(currAlt)) ? (currAlt - prevAlt) : 0;
        if (delta > 0) d.elevationGain += delta; else d.elevationLoss += -delta;
      }
      if (Number.isFinite(speedKmh) && speedKmh > d.maxSpeedKmh) d.maxSpeedKmh = speedKmh;
      d.points++;
    }

    // Replace per-day seconds with day span (first to last location timestamps for that day)
    for (const [key, d] of daily.entries()) {
      const span = dailySpan.get(key);
      if (span) {
        d.seconds = Math.max(0, Number(span.lastTs) - Number(span.firstTs));
      }
    }

    // Build per-day array
    const perDay = Array.from(daily.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([key, v]) => {
        const km = v.meters / 1000;
        const hours = v.seconds / 3600;
        const movingHours = v.movingSeconds / 3600;
        const avgSpeed = hours > 0 ? km / hours : 0;
        const avgSpeedMoving = movingHours > 0 ? km / movingHours : 0;
        const paceMinPerKm = avgSpeed > 0 ? 60 / avgSpeed : null;
        const paceMovingMinPerKm = avgSpeedMoving > 0 ? 60 / avgSpeedMoving : null;
        return {
          date: formatDayLabelFromKey(key, tz),
          meters: Math.round(v.meters),
          km: Math.round(km * 100) / 100,
          seconds: Math.round(v.seconds),
          movingSeconds: Math.round(v.movingSeconds),
          avgSpeedKmh: Math.round(avgSpeed * 100) / 100,
          avgSpeedMovingKmh: Math.round(avgSpeedMoving * 100) / 100,
          paceMinPerKm: paceMinPerKm != null ? Math.round(paceMinPerKm * 100) / 100 : null,
          paceMovingMinPerKm: paceMovingMinPerKm != null ? Math.round(paceMovingMinPerKm * 100) / 100 : null,
          elevationGain: Math.round(v.elevationGain),
          elevationLoss: Math.round(v.elevationLoss),
          maxSpeedKmh: Math.round(v.maxSpeedKmh * 100) / 100,
          points: v.points,
        };
      });

    const totalKm = totalMeters / 1000;
    const totalHours = totalTimeSec / 3600;
    const movingHours = movingTimeSec / 3600;
    const avgSpeedTotal = totalHours > 0 ? totalKm / totalHours : 0;
    const avgSpeedMoving = movingHours > 0 ? totalKm / movingHours : 0;
    const paceTotal = avgSpeedTotal > 0 ? 60 / avgSpeedTotal : null;
    const paceMoving = avgSpeedMoving > 0 ? 60 / avgSpeedMoving : null;

    const summary = {
      points: rows.length,
      pointsUsed: points.length,
      start: { timestamp: Number(points[0].timestamp), lat: points[0].lat, lon: points[0].lon },
      end: { timestamp: Number(points[points.length - 1].timestamp), lat: points[points.length - 1].lat, lon: points[points.length - 1].lon },
      durationSeconds: totalTimeSec,
      days: perDay.length,
    };

    const data = {
      params: {
        from: Number.isFinite(from) ? from : null,
        to: Number.isFinite(to) ? to : null,
        tz,
        modulo,
        minSpeedKmh,
        fillAltitude,
        elevMinDelta,
      },
      summary,
      totals: {
        meters: Math.round(totalMeters),
        km: Math.round(totalKm * 100) / 100,
        seconds: Math.round(totalTimeSec),
        movingSeconds: Math.round(movingTimeSec),
        avgSpeedKmh: Math.round(avgSpeedTotal * 100) / 100,
        avgSpeedMovingKmh: Math.round(avgSpeedMoving * 100) / 100,
        paceMinPerKm: paceTotal != null ? Math.round(paceTotal * 100) / 100 : null,
        paceMovingMinPerKm: paceMoving != null ? Math.round(paceMoving * 100) / 100 : null,
        maxSpeedKmh: Math.round(maxSpeedKmh * 100) / 100,
        elevationGain: Math.round(elevGain),
        elevationLoss: Math.round(elevLoss),
        minAlt: Number.isFinite(minAlt) ? Math.round(minAlt) : null,
        maxAlt: Number.isFinite(maxAlt) ? Math.round(maxAlt) : null,
      },
      perDay,
      quality: {
        gapsOver1h,
        meanAcc: accCount > 0 ? Math.round((accSum / accCount) * 100) / 100 : null,
      },
      bbox: {
        minLat, minLon, maxLat, maxLon,
        center: { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 }
      }
    };

    return res.json({ status: 'ok', data });
  } catch (e) {
    console.error('GET /parcours/stats failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}
