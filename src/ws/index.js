import { WebSocketServer } from 'ws';

let wss = null;
let lastPosition = null; // { lat, lon, timestamp, acc, alt, vel, city, address, timezone }

export function initWS(server, path) {
  wss = new WebSocketServer({ server, path });
  wss.on('connection', (ws) => {
    if (lastPosition) {
      ws.send(JSON.stringify({ type: 'position', ...lastPosition }));
    }
  });
  return wss;
}

export function broadcast(obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

export function getLastPosition() {
  return lastPosition;
}

export function setLastPosition(pos) {
  lastPosition = pos;
}

export default { initWS, broadcast, getLastPosition, setLastPosition };
