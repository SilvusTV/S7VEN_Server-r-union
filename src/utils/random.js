// Deterministic RNG helpers and weighted sampling

export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  const seedStr = typeof seed === 'string' ? seed : String(seed);
  const h = xmur3(seedStr)();
  return mulberry32(h);
}

export function weightedSampleWithoutReplacement(items, weightKey, k, rng = Math.random) {
  const pool = items.map((it) => ({ ...it }));
  const winners = [];
  const maxK = Math.min(k, pool.length);
  for (let i = 0; i < maxK; i++) {
    const total = pool.reduce((acc, it) => acc + Number(it[weightKey] || 0), 0);
    if (!Number.isFinite(total) || total <= 0) break;
    const r = rng() * total;
    let cum = 0;
    let idx = -1;
    for (let j = 0; j < pool.length; j++) {
      cum += Number(pool[j][weightKey] || 0);
      if (r < cum) {
        idx = j;
        break;
      }
    }
    if (idx === -1) idx = pool.length - 1;
    const [w] = pool.splice(idx, 1);
    winners.push(w);
  }
  return winners;
}

export default { xmur3, mulberry32, makeRng, weightedSampleWithoutReplacement };
