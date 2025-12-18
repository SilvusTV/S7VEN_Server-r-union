import { Tombolas } from '../../database/index.js';
import { normalizePseudo } from '../utils/normalize.js';
import { makeRng, weightedSampleWithoutReplacement } from '../utils/random.js';

// POST /tombola/new — add tickets or create entrant
export async function postNewTombola(req, res) {
  try {
    const { pseudo, tickets, ticket, nb, count } = req.body || {};
    const rawCount = tickets ?? ticket ?? nb ?? count;
    const name = normalizePseudo(pseudo);

    const n = Number(rawCount);
    if (!name) return res.status(400).json({ error: 'pseudo requis' });
    if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'nombre de tickets invalide' });

    const existing = (await Tombolas.where({ name }))[0] || null;
    if (existing) {
      const newCount = (Number(existing.ticket_count) || 0) + n;
      await Tombolas.updateById(existing.id, {
        ticket_count: newCount,
        updatedAt: new Date().toISOString()
      });
      const fresh = await Tombolas.findById(existing.id);
      return res.json({ status: 'ok', action: 'updated', data: fresh });
    } else {
      const inserted = await Tombolas.insert({ name, ticket_count: n });
      const fresh = await Tombolas.findById(inserted.id);
      return res.json({ status: 'ok', action: 'created', data: fresh });
    }
  } catch (e) {
    console.error('POST /tombola/new failed:', e);
    return res.status(500).json({ error: 'server error' });
  }
}

// POST /tombola/draw — weighted draw without replacement (dry-run)
export async function postDrawTombola(req, res) {
  try {
    const { count, seed, preview } = req.body || {};
    const k = count === undefined ? 1 : Number(count);
    if (!Number.isInteger(k) || k <= 0) {
      return res.status(400).json({ error: 'count invalide (entier > 0 requis)' });
    }

    const rows = await Tombolas.all();
    const entrants = rows
      .map((r) => ({ id: r.id, name: r.name, ticket_count: Number(r.ticket_count) || 0 }))
      .filter((r) => r.ticket_count > 0);

    const totalTickets = entrants.reduce((acc, e) => acc + e.ticket_count, 0);
    if (entrants.length === 0 || totalTickets <= 0) {
      return res.status(400).json({ error: 'aucun participant avec des tickets' });
    }

    const rng = makeRng(seed);
    const winners = weightedSampleWithoutReplacement(entrants, 'ticket_count', k, rng);
    const winnerNames = winners.map((w) => w.name);

    if (preview) {
      const enriched = entrants.map((e) => ({
        id: e.id,
        name: e.name,
        ticket_count: e.ticket_count,
        probability: e.ticket_count / totalTickets
      }));
      return res.json({
        status: 'ok',
        meta: {
          totalEntrants: entrants.length,
          totalTickets,
          count: winners.length,
          drawAt: new Date().toISOString(),
          seed: seed ?? null
        },
        entrants: enriched,
        winners: winnerNames
      });
    }

    return res.json({ status: 'ok', winners: winnerNames });
  } catch (e) {
    console.error('POST /tombola/draw failed:', e);
    return res.status(500).json({ error: 'server error' });
  }
}

export default { postNewTombola, postDrawTombola };
