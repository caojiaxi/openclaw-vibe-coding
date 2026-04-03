// Claw Games — Express + WebSocket server entry point
// See DESIGN.md §1, §4, §5 for server architecture

import express from 'express';
import { createServer } from 'http';
import { initializeDatabase } from './db/index.js';
import { router as apiRoutes } from './routes/index.js';
import { matchmakingRouter, setQueue } from './routes/matchmaking.js';
import { createWebSocketServer, setDisconnectHandler } from './ws/index.js';
import { Queue } from '../matchmaking/Queue.js';
import { Matcher } from '../matchmaking/Matcher.js';
import { startMatchmakingLoop, getDisconnectListener } from '../matchmaking/loop.js';
import type { MatchmakingLoopHandle } from '../matchmaking/loop.js';
import { GameLoop } from '../engine/GameLoop.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DB_PATH = process.env.DB_PATH ?? 'claw_games.db';

// ─── Initialize Database ────────────────────────────────────────────────────

console.log(`[DB] Initializing database at: ${DB_PATH}`);
initializeDatabase(DB_PATH);

// ─── Express App ────────────────────────────────────────────────────────────

const app = express();

// JSON body parsing with size limit to prevent abuse
app.use(express.json({ limit: '1mb' }));

// Mount REST routes at /api/v1
app.use('/api/v1', apiRoutes);
app.use('/api/v1', matchmakingRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── HTTP Server ────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = createWebSocketServer(httpServer);
console.log(`[WS] WebSocket server attached at /ws`);

// ─── Game Loop ──────────────────────────────────────────────────────────────

// The GameLoop instance wires up WS message/forfeit/reconnect handlers
// in its constructor, so it must be created after the WS server.
const gameLoop = new GameLoop();
console.log(`[GameLoop] Game loop initialized`);

// ─── Matchmaking System ─────────────────────────────────────────────────────

const queue = new Queue();
const matcher = new Matcher();

// Inject the queue into the REST routes so they share the same instance
setQueue(queue);

// Start the matchmaking loop (runs every 5 seconds)
// Pass the gameLoop so that matched games auto-start
const matchmakingLoop: MatchmakingLoopHandle = startMatchmakingLoop(queue, matcher, gameLoop);

// Wire WebSocket disconnect → matchmaking queue removal.
// When an agent disconnects and is not in a match, they should be removed
// from the matchmaking queue automatically (DESIGN.md §9.6).
setDisconnectHandler((agentId: string) => {
  const listener = getDisconnectListener();
  if (listener) {
    listener(agentId);
  }
});

// ─── Start Listening ────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Server] Claw Games server listening on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}/api/v1`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws?token=<JWT>`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function shutdown(): void {
  console.log('\n[Server] Shutting down...');

  // Stop the matchmaking loop first so no new matches are created
  matchmakingLoop.stop();

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

export { app, httpServer, wss, queue, matchmakingLoop, gameLoop };
