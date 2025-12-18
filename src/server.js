import express from 'express';
import fs from 'fs';
import { PORT, WS_PATH, DB_PATH } from './config.js';
import { initWS } from './ws/index.js';
import { postOwnTracks } from './controllers/owntracks.controller.js';
import { postNewTombola, postDrawTombola } from './controllers/tombola.controller.js';
import { getChallenges, postStartChallenge, putChallengeDone } from './controllers/challenges.controller.js';
import { getDailyDistance, getTotalDistance } from './controllers/statistics.controller.js';

const app = express();
app.use(express.json());
app.use('/public', express.static('public'));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // ou mettre l'origine exacte au lieu de '*'
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
})

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`HTTP server listening on http://localhost:${PORT}`);
  console.log(`WebSocket path at ws://localhost:${PORT}${WS_PATH}`);
});
// Init WebSocket server
initWS(server, WS_PATH);

app.get('/', (req, res) => {
  res.type('text/plain').send('OwnTracks -> WebSocket relay is running. POST to /owntracks and connect to WebSocket at ' + WS_PATH);
});

app.post('/owntracks', postOwnTracks);

// Tombola routes
app.post('/tombola/new', postNewTombola);

app.post('/tombola/draw', postDrawTombola);

// Challenges routes
app.get('/challenges', getChallenges);
app.post('/challenges/start', postStartChallenge);
app.put('/challenges/:id/done', putChallengeDone);

// Statistics routes
app.get('/stats/distance/daily', getDailyDistance);
app.get('/stats/distance/total', getTotalDistance);

// Download database file
app.get('/download/datas.sqlite', (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    // Force download with a friendly filename
    res.download(DB_PATH, 'datas.sqlite', (err) => {
      if (err) {
        // If headers already sent, delegate to Express default error handler
        if (res.headersSent) return;
        res.status(500).json({ error: 'Failed to download database file' });
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected server error' });
  }
});
