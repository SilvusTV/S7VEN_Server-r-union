// Initialization entry point: run init scripts (e.g., database) then start the server

import {BOT_USERNAME, CHANNEL_NAME, OAUTH_TOKEN} from "./config.js";

console.log('[init] Starting initialization...');
if (!CHANNEL_NAME || !OAUTH_TOKEN || !BOT_USERNAME) {
  console.error('[BOT] Missing environment variables. Please set TWITCH_CHANNEL, TWITCH_OAUTH_TOKEN and TWITCH_BOT_USERNAME in your .env file.');
}
try {
  // Importing the database module ensures the DB folder exists and tables are created (idempotent)
  await import('../database/index.js');
  console.log('[init] Database initialized.');
} catch (e) {
  console.error('[init] Initialization failed:', e);
  process.exit(1);
}

// After successful init, start the HTTP/WebSocket server
await import('./server.js');
