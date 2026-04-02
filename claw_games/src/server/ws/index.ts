// WebSocket connection manager
// See DESIGN.md §5 for WebSocket protocol specification

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server as HTTPServer } from 'http';
import { verifyToken } from '../routes/index.js';
import { AgentDAO, MatchParticipantDAO } from '../db/index.js';
import { clearAgentInMatch } from '../routes/matchmaking.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WSMessage {
  type: string;
  match_id?: string;
  payload: unknown;
  timestamp: string;
}

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  agentName: string;
  matchId: string | null;
  missedHeartbeats: number;
  lastPong: number;
}

interface DisconnectedAgent {
  agentId: string;
  matchId: string | null;
  disconnectedAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;      // Send heartbeat every 15s
const HEARTBEAT_TIMEOUT_MS = 10_000;       // Wait 10s for ack
const MAX_MISSED_HEARTBEATS = 3;           // 3 consecutive timeouts → disconnect + forfeit
const RECONNECTION_GRACE_PERIOD_MS = 60_000; // 60s to reconnect

// ─── Connection Registry ────────────────────────────────────────────────────

/** Active WebSocket connections indexed by agentId */
const connections = new Map<string, AgentConnection>();

/** Agents that disconnected mid-match, eligible for reconnection */
const disconnectedAgents = new Map<string, DisconnectedAgent>();

/** Reconnection cleanup timers */
const reconnectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Public API ─────────────────────────────────────────────────────────────

export function getConnection(agentId: string): AgentConnection | undefined {
  return connections.get(agentId);
}

export function isConnected(agentId: string): boolean {
  return connections.has(agentId);
}

export function getConnectedAgentIds(): string[] {
  return Array.from(connections.keys());
}

/**
 * Send a typed message to a specific agent.
 */
export function sendToAgent(agentId: string, message: WSMessage): boolean {
  const conn = connections.get(agentId);
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  conn.ws.send(JSON.stringify(message));
  return true;
}

/**
 * Send a message to all connected agents in a specific match.
 */
export function broadcastToMatch(matchId: string, message: WSMessage): void {
  for (const conn of connections.values()) {
    if (conn.matchId === matchId && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(message));
    }
  }
}

/**
 * Associate an agent's connection with a match.
 */
export function setAgentMatch(agentId: string, matchId: string | null): void {
  const conn = connections.get(agentId);
  if (conn) {
    conn.matchId = matchId;
  }
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [agentId, conn] of connections.entries()) {
      // Check if the previous heartbeat was acknowledged
      if (now - conn.lastPong > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
        conn.missedHeartbeats++;

        if (conn.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          console.log(`[WS] Agent ${agentId} missed ${MAX_MISSED_HEARTBEATS} heartbeats — disconnecting`);
          handleDisconnect(agentId, conn);
          conn.ws.terminate();
          continue;
        }
      }

      // Send new heartbeat
      if (conn.ws.readyState === WebSocket.OPEN) {
        const heartbeatMsg: WSMessage = {
          type: 'heartbeat',
          payload: {},
          timestamp: new Date().toISOString(),
        };
        conn.ws.send(JSON.stringify(heartbeatMsg));
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ─── Disconnect / Reconnect Handling ────────────────────────────────────────

/** Generic disconnect callback — invoked whenever any agent disconnects (before forfeit logic). */
let onDisconnect: ((agentId: string) => void) | null = null;

export function setDisconnectHandler(handler: (agentId: string) => void): void {
  onDisconnect = handler;
}

/** Forfeit callback — set externally by the game engine to handle forfeit logic */
let onForfeit: ((agentId: string, matchId: string) => void) | null = null;

export function setForfeitHandler(handler: (agentId: string, matchId: string) => void): void {
  onForfeit = handler;
}

/** Reconnection callback — set externally by game code to send resume state on reconnect */
let onReconnect: ((agentId: string, matchId: string) => void) | null = null;

export function setReconnectHandler(handler: (agentId: string, matchId: string) => void): void {
  onReconnect = handler;
}

function handleDisconnect(agentId: string, conn: AgentConnection): void {
  connections.delete(agentId);

  // Notify generic disconnect listeners (e.g. matchmaking queue cleanup)
  if (onDisconnect) {
    try {
      onDisconnect(agentId);
    } catch (err) {
      console.error(`[WS] Error in onDisconnect handler for agent ${agentId}:`, err);
    }
  }

  if (conn.matchId) {
    // Allow reconnection within grace period
    disconnectedAgents.set(agentId, {
      agentId,
      matchId: conn.matchId,
      disconnectedAt: Date.now(),
    });

    // Set a timer to forfeit if they don't reconnect
    const timer = setTimeout(() => {
      const disconnected = disconnectedAgents.get(agentId);
      if (disconnected && disconnected.matchId) {
        console.log(`[WS] Agent ${agentId} did not reconnect within ${RECONNECTION_GRACE_PERIOD_MS / 1000}s — forfeiting`);
        if (onForfeit) {
          onForfeit(agentId, disconnected.matchId);
        }
        // Clear the in-match flag so the agent can re-queue (Issue #2)
        clearAgentInMatch(agentId);
      }
      disconnectedAgents.delete(agentId);
      reconnectionTimers.delete(agentId);
    }, RECONNECTION_GRACE_PERIOD_MS);

    reconnectionTimers.set(agentId, timer);
  }
}

function handleReconnection(agentId: string, ws: WebSocket, agentName: string): boolean {
  let disconnected = disconnectedAgents.get(agentId);

  // Fallback: if the in-memory disconnectedAgents map doesn't have this agent
  // (e.g. the WS was already gone when match was created), check DB for an
  // active match.  This ensures reconnect can restore the match association
  // even without the in-memory entry (DESIGN §5.4).
  if (!disconnected) {
    const activeMatchId = MatchParticipantDAO.getActiveMatchId(agentId);
    if (!activeMatchId) return false;

    // Synthesize a disconnected entry so the rest of the flow works
    disconnected = { agentId, matchId: activeMatchId, disconnectedAt: Date.now() };
  }

  // Close any lingering old socket for this agent
  const existingConn = connections.get(agentId);
  if (existingConn && existingConn.ws.readyState !== WebSocket.CLOSED) {
    existingConn.ws.close(4000, 'Replaced by reconnection');
  }

  // Clear the forfeit timer
  const timer = reconnectionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    reconnectionTimers.delete(agentId);
  }

  // Restore the connection
  const conn: AgentConnection = {
    ws,
    agentId,
    agentName,
    matchId: disconnected.matchId,
    missedHeartbeats: 0,
    lastPong: Date.now(),
  };
  connections.set(agentId, conn);
  disconnectedAgents.delete(agentId);

  console.log(`[WS] Agent ${agentId} reconnected to match ${disconnected.matchId}`);

  // Notify game code so it can send a full state_update (DESIGN.md §5.4)
  if (onReconnect && disconnected.matchId) {
    onReconnect(agentId, disconnected.matchId);
  }

  return true;
}

// ─── Message Handling ───────────────────────────────────────────────────────

/** External handler for game-related messages from agents */
let onAgentMessage: ((agentId: string, message: WSMessage) => void) | null = null;

export function setMessageHandler(handler: (agentId: string, message: WSMessage) => void): void {
  onAgentMessage = handler;
}

function handleMessage(agentId: string, data: string): void {
  let message: WSMessage;
  try {
    message = JSON.parse(data) as WSMessage;
  } catch {
    const conn = connections.get(agentId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { code: 'INVALID_JSON', message: 'Failed to parse message as JSON' },
        timestamp: new Date().toISOString(),
      };
      conn.ws.send(JSON.stringify(errorMsg));
    }
    return;
  }

  // Handle heartbeat_ack from agent
  if (message.type === 'heartbeat_ack') {
    const conn = connections.get(agentId);
    if (conn) {
      conn.missedHeartbeats = 0;
      conn.lastPong = Date.now();
    }
    return;
  }

  // Validate required fields before forwarding (DESIGN.md §5 WSMessage shape)
  if (!message.type || typeof message.type !== 'string') {
    const conn = connections.get(agentId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { code: 'INVALID_MESSAGE', message: 'Message must include a "type" string field' },
        timestamp: new Date().toISOString(),
      };
      conn.ws.send(JSON.stringify(errorMsg));
    }
    return;
  }

  if (message.payload === undefined || message.payload === null) {
    const conn = connections.get(agentId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { code: 'INVALID_MESSAGE', message: 'Message must include a "payload" field' },
        timestamp: new Date().toISOString(),
      };
      conn.ws.send(JSON.stringify(errorMsg));
    }
    return;
  }

  // Forward all other messages to the registered handler
  if (onAgentMessage) {
    onAgentMessage(agentId, message);
  }
}

// ─── WebSocket Server Initialization ────────────────────────────────────────

export function createWebSocketServer(httpServer: HTTPServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate via query param token
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { code: 'AUTH_REQUIRED', message: 'Missing token query parameter' },
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close(4001, 'Authentication required');
      return;
    }

    let agentId: string;
    let agentName: string;
    try {
      const payload = verifyToken(token);
      agentId = payload.sub;
      // Look up current name from DB instead of stale JWT claim
      const agent = AgentDAO.getById(agentId);
      if (!agent) {
        const errorMsg: WSMessage = {
          type: 'error',
          payload: { code: 'AUTH_FAILED', message: 'Agent not found' },
          timestamp: new Date().toISOString(),
        };
        ws.send(JSON.stringify(errorMsg));
        ws.close(4001, 'Authentication failed');
        return;
      }
      agentName = agent.name;
    } catch {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { code: 'AUTH_FAILED', message: 'Invalid or expired token' },
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close(4001, 'Authentication failed');
      return;
    }

    // Check if this is a reconnection
    const isReconnect = handleReconnection(agentId, ws, agentName);

    if (!isReconnect) {
      // Close any existing connection for this agent
      const existingConn = connections.get(agentId);
      if (existingConn) {
        existingConn.ws.close(4000, 'Replaced by new connection');
      }

      // Register new connection
      const conn: AgentConnection = {
        ws,
        agentId,
        agentName,
        matchId: null,
        missedHeartbeats: 0,
        lastPong: Date.now(),
      };
      connections.set(agentId, conn);
    }

    console.log(`[WS] Agent ${agentName} (${agentId}) connected${isReconnect ? ' (reconnected)' : ''}`);

    // Wire up event handlers
    ws.on('message', (rawData) => {
      handleMessage(agentId, rawData.toString());
    });

    ws.on('close', () => {
      console.log(`[WS] Agent ${agentName} (${agentId}) disconnected`);
      const conn = connections.get(agentId);
      if (conn && conn.ws === ws) {
        handleDisconnect(agentId, conn);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for agent ${agentId}:`, err.message);
    });
  });

  // Start the heartbeat loop
  startHeartbeat();

  // Cleanup on server close
  wss.on('close', () => {
    stopHeartbeat();
    connections.clear();
    disconnectedAgents.clear();
    for (const timer of reconnectionTimers.values()) {
      clearTimeout(timer);
    }
    reconnectionTimers.clear();
  });

  return wss;
}
