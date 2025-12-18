import { OWNTRACKS_TOKEN } from '../config.js';

export function authOwnTracks(req) {
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!OWNTRACKS_TOKEN) return true; // allow when not configured (dev)
  return token === OWNTRACKS_TOKEN;
}

export default { authOwnTracks };
