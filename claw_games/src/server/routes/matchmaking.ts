// Matchmaking REST route handlers
// See DESIGN.md §4.2 for API specification

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest, authMiddleware } from './index.js';
import { AgentRatingDAO } from '../db/index.js';
import { Queue, QueueEntry } from '../../matchmaking/Queue.js';

// ─── Shared Queue Instance ────────────────────────────────────────────────

let queue: Queue | null = null;

/**
 * Inject the singleton queue instance used by both the routes and the
 * matchmaking loop.  Must be called before any request is served.
 */
export function setQueue(q: Queue): void {
  queue = q;
}

function getQueue(): Queue {
  if (!queue) {
    throw new Error('Matchmaking queue not initialized. Call setQueue() first.');
  }
  return queue;
}

// ─── Queue-ID Registry ───────────────────────────────────────────────────
// Maps agent_id → queue_id so that the caller can correlate join / status
// responses (DESIGN.md §4.2 response shape).

const agentQueueIds = new Map<string, string>();

/**
 * Remove the queue-id mapping for an agent. Called when the agent leaves
 * the queue (either explicitly or via the matchmaking loop).
 */
export function clearAgentQueueId(agentId: string): void {
  agentQueueIds.delete(agentId);
}

/**
 * Check if an agent is currently in the queue.
 */
export function isAgentQueued(agentId: string): boolean {
  return agentQueueIds.has(agentId);
}

// ─── Active Match Tracking ──────────────────────────────────────────────
// Tracks agents that are currently in a match. Prevents re-queuing while
// a match is in progress.

const activeMatchAgents = new Set<string>();

/**
 * Mark an agent as being in an active match. Called by the matchmaking loop
 * when a match is created.
 */
export function markAgentInMatch(agentId: string): void {
  activeMatchAgents.add(agentId);
}

/**
 * Clear an agent's active-match flag. Called when the match ends or the
 * agent forfeits.
 */
export function clearAgentInMatch(agentId: string): void {
  activeMatchAgents.delete(agentId);
}

/**
 * Clear the active-match flag for every participant of a given match.
 * Should be called when a match transitions to completed or aborted so
 * all participants can re-queue.
 */
export function clearMatchParticipants(agentIds: string[]): void {
  for (const id of agentIds) {
    activeMatchAgents.delete(id);
  }
}

/**
 * Check if an agent is currently in an active match.
 */
export function isAgentInMatch(agentId: string): boolean {
  return activeMatchAgents.has(agentId);
}

// ─── Supported game types ────────────────────────────────────────────────

const VALID_GAME_TYPES = new Set(['werewolf', 'mahjong']);

// ─── Route Handlers ─────────────────────────────────────────────────────

const router = Router();

/**
 * POST /matchmaking/join — Join a game queue (requires auth)
 * Body: { game_type: string }
 * Returns 200: { queue_id, position, estimated_wait_seconds }
 */
router.post('/matchmaking/join', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { game_type } = req.body as { game_type?: string };
  const agentId = req.agentId!;

  // Validate game_type
  if (!game_type || typeof game_type !== 'string') {
    res.status(400).json({ error: 'Field "game_type" is required and must be a string' });
    return;
  }
  if (!VALID_GAME_TYPES.has(game_type)) {
    res.status(400).json({ error: `Invalid game_type "${game_type}". Must be one of: ${[...VALID_GAME_TYPES].join(', ')}` });
    return;
  }

  // Enforce single-queue-per-agent: reject if already queued
  if (agentQueueIds.has(agentId)) {
    res.status(409).json({ error: 'Agent is already in a queue. Leave the current queue first.' });
    return;
  }

  // Reject if the agent is already in an active match (no re-queuing mid-game)
  if (activeMatchAgents.has(agentId)) {
    res.status(409).json({ error: 'Agent is currently in a match. Cannot join queue while in a match.' });
    return;
  }

  // Fetch the agent's current rating for this game type
  const ratingRow = AgentRatingDAO.ensureRating(agentId, game_type);

  const now = Date.now();
  const entry: QueueEntry = {
    agent_id: agentId,
    game_type: game_type as 'werewolf' | 'mahjong',
    rating: ratingRow.rating,
    enqueued_at: now,
  };

  const q = getQueue();
  q.enqueue(entry);

  // Assign a stable queue_id
  const queueId = `q-${uuidv4().slice(0, 8)}`;
  agentQueueIds.set(agentId, queueId);

  // Calculate position (1-indexed) — entries sorted oldest-first
  const entries = q.getEntries(game_type);
  const position = entries.findIndex(e => e.agent_id === agentId) + 1;

  console.log(`[Matchmaking] Agent ${agentId} joined ${game_type} queue (position ${position}, rating ${ratingRow.rating})`);

  res.status(200).json({
    queue_id: queueId,
    position,
    estimated_wait_seconds: estimateWait(entries.length, game_type),
  });
});

/**
 * DELETE /matchmaking/leave — Leave the queue (requires auth)
 * Returns 200: { message }
 */
router.delete('/matchmaking/leave', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const agentId = req.agentId!;

  if (!agentQueueIds.has(agentId)) {
    res.status(404).json({ error: 'Agent is not in any queue' });
    return;
  }

  getQueue().removeAgent(agentId);
  agentQueueIds.delete(agentId);

  console.log(`[Matchmaking] Agent ${agentId} left queue`);

  res.status(200).json({ message: 'Left the queue' });
});

/**
 * GET /matchmaking/status — Get queue position and estimated wait (requires auth)
 * Returns 200: { queue_id, position, estimated_wait_seconds }
 */
router.get('/matchmaking/status', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const agentId = req.agentId!;

  const queueId = agentQueueIds.get(agentId);
  if (!queueId) {
    res.status(404).json({ error: 'Agent is not in any queue' });
    return;
  }

  const q = getQueue();

  // Determine the game type by scanning all types (agent can only be in one)
  let gameType: string | null = null;
  let position = 0;
  let totalInQueue = 0;

  for (const gt of VALID_GAME_TYPES) {
    const entries = q.getEntries(gt);
    const idx = entries.findIndex(e => e.agent_id === agentId);
    if (idx >= 0) {
      gameType = gt;
      position = idx + 1;
      totalInQueue = entries.length;
      break;
    }
  }

  if (!gameType) {
    // Agent was removed from queue externally (e.g. matched)
    agentQueueIds.delete(agentId);
    res.status(404).json({ error: 'Agent is not in any queue' });
    return;
  }

  res.status(200).json({
    queue_id: queueId,
    game_type: gameType,
    position,
    estimated_wait_seconds: estimateWait(totalInQueue, gameType),
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

const GAME_SIZES: Record<string, number> = {
  werewolf: 8,
  mahjong: 4,
};

/**
 * Rough ETA: how many more players are needed divided by an assumed
 * arrival rate of 1 player every 15 seconds, with a minimum of 5s.
 */
function estimateWait(currentQueueSize: number, gameType: string): number {
  const needed = GAME_SIZES[gameType] ?? 4;
  const remaining = Math.max(0, needed - currentQueueSize);
  const ASSUMED_ARRIVAL_RATE_S = 15; // 1 player per 15 seconds average
  return Math.max(5, remaining * ASSUMED_ARRIVAL_RATE_S);
}

export { router as matchmakingRouter };
