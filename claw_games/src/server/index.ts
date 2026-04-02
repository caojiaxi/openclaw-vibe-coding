// Claw Games — Express + WebSocket server entry point
// See DESIGN.md §1, §4, §5 for server architecture

import express from 'express';
import { createServer } from 'http';
import { initializeDatabase } from './db/index.js';
import { router as apiRoutes } from './routes/index.js';
import { createWebSocketServer } from './ws/index.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DB_PATH = process.env.DB_PATH ?? 'claw_games.db';

// ─── Initialize Database ────────────────────────────────────────────────────

console.log(`[DB] Initializing database at: ${DB_PATH}`);
initializeDatabase(DB_PATH);

// ─── Express App ────────────────────────────────────────────────────────────

const app = express();

// JSON body parsing
app.use(express.json());

// Mount REST routes at /api/v1
app.use('/api/v1', apiRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── HTTP Server ────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = createWebSocketServer(httpServer);
console.log(`[WS] WebSocket server attached at /ws`);

// ─── Start Listening ────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Server] Claw Games server listening on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}/api/v1`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws?token=<JWT>`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function shutdown(): void {
  console.log('\n[Server] Shutting down...');
  wss.close(() => {
    console.log('[WS] WebSocket server closed');
  });
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown doesn't complete
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, httpServer, wss };
