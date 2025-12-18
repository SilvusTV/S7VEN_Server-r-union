import { Challenges } from '../../database/index.js';
import { broadcast } from '../ws/index.js';

// GET /challenges — list all challenges with their done status
export async function getChallenges(req, res) {
  try {
    const rows = await Challenges.all('id ASC');
    return res.json({ status: 'ok', data: rows });
  } catch (e) {
    console.error('GET /challenges failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

// POST /challenges/start — start/broadcast a selected challenge
// Body can contain either { id } or { name }
export async function postStartChallenge(req, res) {
  try {
    const { id, name } = req.body || {};

    let challenge = null;
    if (id != null) {
      const n = Number(id);
      if (!Number.isInteger(n)) {
        return res.status(400).json({ error: 'id invalide' });
      }
      challenge = await Challenges.findById(n);
    } else if (name) {
      const byName = await Challenges.where({ name }, { limit: 1 });
      challenge = byName[0] || null;
    } else {
      return res.status(400).json({ error: 'id ou name requis' });
    }

    if (!challenge) {
      return res.status(404).json({ error: 'challenge introuvable' });
    }

    // Broadcast to all WS clients
    broadcast({
      type: 'challenge',
      action: 'start',
      challenge: {
        id: challenge.id,
        name: challenge.name,
        presentation_video: challenge.presentation_video ?? null,
        challenge_video: challenge.challenge_video ?? null,
        done: !!challenge.done,
      },
      at: new Date().toISOString(),
    });

    return res.json({ status: 'ok', action: 'broadcasted', data: challenge });
  } catch (e) {
    console.error('POST /challenges/start failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

// PUT /challenges/:id/done — mark a challenge as done (or undone with body { done: false })
export async function putChallengeDone(req, res) {
  try {
    const { id } = req.params || {};
    const n = Number(id);
    if (!Number.isInteger(n)) {
      return res.status(400).json({ error: 'id invalide' });
    }

    const { done } = req.body || {};
    const doneFlag = done === undefined ? true : !!done;

    const ok = await Challenges.updateById(n, { done: doneFlag ? 1 : 0 });
    if (!ok) {
      return res.status(404).json({ error: 'challenge introuvable' });
    }

    const fresh = await Challenges.findById(n);

    // Optionally broadcast the done state change
    broadcast({
      type: 'challenge',
      action: doneFlag ? 'done' : 'undone',
      challenge: {
        id: fresh.id,
        name: fresh.name,
        done: !!fresh.done,
      },
      at: new Date().toISOString(),
    });

    return res.json({ status: 'ok', data: fresh });
  } catch (e) {
    console.error('PUT /challenges/:id/done failed:', e);
    return res.status(500).json({ error: 'erreur serveur' });
  }
}

export default { getChallenges, postStartChallenge, putChallengeDone };
