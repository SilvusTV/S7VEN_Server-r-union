// Initialization entry point: run init scripts (e.g., database) then start the server

console.log('[init] Starting initialization...');

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
