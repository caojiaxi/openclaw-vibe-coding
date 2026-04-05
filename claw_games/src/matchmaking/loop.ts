// Matchmaking loop — periodically runs the Matcher and creates matches
// See DESIGN.md §9.4 for algorithm details

import { Queue } from './Queue.js';
import { Matcher, MatchGroup } from './Matcher.js';
import { MatchDAO, MatchParticipantDAO, AgentRatingDAO, AgentDAO, getDatabase } from '../server/db/index.js';
import { sendToAgent, setAgentMatch } from '../server/ws/index.js';
import type { WSMessage } from '../server/ws/index.js';
import { clearAgentQueueId, markAgentInMatch, isAgentQueued, isAgentInMatch } from '../server/routes/matchmaking.js';
import { GameRoom } from '../engine/GameRoom.js';
import { GameLoop } from '../engine/GameLoop.js';
import { MahjongEngine } from '../games/mahjong/MahjongEngine.js';
import { WerewolfEngine } from '../games/werewolf/WerewolfEngine.js';
import type { Player } from '../engine/types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MatchmakingLoopHandle {
  /** Stop the matchmaking loop. Returns once the interval is cleared. */
  stop(): void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MATCH_INTERVAL_MS = 5_000; // Run matcher every 5 seconds
const SUPPORTED_GAME_TYPES = ['werewolf', 'mahjong'] as const;

// ─── Disconnect listener registry ────────────────────────────────────────

type DisconnectListener = (agentId: string) => void;
let disconnectListener: DisconnectListener | null = null;

/**
 * Returns the current disconnect listener so external code (ws/index.ts)
 * can call it when an agent's WebSocket closes.
 */
export function getDisconnectListener(): DisconnectListener | null {
  return disconnectListener;
}

// ─── Core Loop ──────────────────────────────────────────────────────────────

/**
 * Start the matchmaking loop.
 *
 * Every `MATCH_INTERVAL_MS` milliseconds, for each game type:
 *   1. Pull queue entries from `queue.getEntries()`
 *   2. Run `matcher.findMatches()`
 *   3. For each match group found:
 *      a. Create a match record in DB via `MatchDAO.create()`
 *      b. Create participant records via `MatchParticipantDAO.create()`
 *      c. Send a `match_found` WS event to every matched agent
 *      d. Remove matched agents from the queue
 *      e. Create a GameRoom and start the GameLoop
 *
 * @returns A handle to stop the loop.
 */
export function startMatchmakingLoop(queue: Queue, matcher: Matcher, gameLoop?: GameLoop): MatchmakingLoopHandle {
  // Register the disconnect listener so WebSocket close removes from queue
  // (only if the agent is actually queued — in-match disconnects are handled
  // separately by the reconnection grace period in ws/index.ts)
  disconnectListener = (agentId: string) => {
    if (isAgentInMatch(agentId)) {
      // Agent is mid-match — don't touch the queue; the WS layer will handle
      // the reconnection grace period and potential forfeit.
      console.log(`[Matchmaking] Agent ${agentId} disconnected mid-match (reconnect grace period active)`);
      return;
    }
    if (isAgentQueued(agentId)) {
      queue.removeAgent(agentId);
      clearAgentQueueId(agentId);
      console.log(`[Matchmaking] Agent ${agentId} removed from queue (disconnect)`);
    }
  };

  const intervalId = setInterval(() => {
    try {
      tick(queue, matcher, gameLoop ?? null);
    } catch (err) {
      console.error('[Matchmaking] Error in matchmaking tick:', err);
    }
  }, MATCH_INTERVAL_MS);

  // Don't let the interval keep the process alive if everything else shuts down
  if (intervalId.unref) {
    intervalId.unref();
  }

  console.log(`[Matchmaking] Loop started — running every ${MATCH_INTERVAL_MS / 1000}s`);

  return {
    stop() {
      clearInterval(intervalId);
      disconnectListener = null;
      console.log('[Matchmaking] Loop stopped');
    },
  };
}

// ─── Single Tick ────────────────────────────────────────────────────────────

function tick(queue: Queue, matcher: Matcher, gameLoop: GameLoop | null): void {
  const now = Date.now();

  for (const gameType of SUPPORTED_GAME_TYPES) {
    const entries = queue.getEntries(gameType);
    if (entries.length === 0) continue;

    const matchGroups = matcher.findMatches(entries, gameType, now);

    for (const group of matchGroups) {
      processMatchGroup(queue, group, gameLoop);
    }
  }
}

// ─── Match Group Processing ────────────────────────────────────────────────

function processMatchGroup(queue: Queue, group: MatchGroup, gameLoop: GameLoop | null): void {
  const { entries, game_type } = group;
  const agentIds = entries.map(e => e.agent_id);

  // 1. Generate a deterministic-replay seed
  const seed = Math.floor(Math.random() * 2_147_483_647);

  // 2. Create match + participants inside a single transaction
  interface PlayerInfo {
    agent_id: string;
    name: string;
    seat: number;
    rating_before: number;
  }

  const { match, players } = getDatabase().transaction(() => {
    const match = MatchDAO.create(game_type, seed);

    const players: PlayerInfo[] = [];

    for (let seat = 0; seat < entries.length; seat++) {
      const entry = entries[seat];
      const agent = AgentDAO.getById(entry.agent_id);
      const name = agent?.name ?? 'Unknown';
      const ratingRow = AgentRatingDAO.getForAgentAndGame(entry.agent_id, game_type);
      const ratingBefore = ratingRow?.rating ?? 1500;

      MatchParticipantDAO.create({
        match_id: match.id,
        agent_id: entry.agent_id,
        seat,
        role: null,
        result: null,
        rating_before: ratingBefore,
      });

      players.push({ agent_id: entry.agent_id, name, seat, rating_before: ratingBefore });
    }

    return { match, players };
  })();

  console.log(`[Matchmaking] Match ${match.id} created (${game_type}, ${entries.length} players)`);

  // 3. Remove matched agents from queue, clear queue-id mappings, and mark as in-match
  queue.removeMany(agentIds);
  for (const id of agentIds) {
    clearAgentQueueId(id);
    markAgentInMatch(id);
  }

  // 4. Send match_found WS event to each matched agent
  for (const player of players) {
    // Associate the WS connection with this match so broadcastToMatch works
    setAgentMatch(player.agent_id, match.id);

    const message: WSMessage = {
      type: 'match_found',
      match_id: match.id,
      payload: {
        match_id: match.id,
        game_type,
        players: players.map(p => ({
          agent_id: p.agent_id,
          name: p.name,
          seat: p.seat,
        })),
        your_seat: player.seat,
      },
      timestamp: new Date().toISOString(),
    };

    const sent = sendToAgent(player.agent_id, message);
    if (!sent) {
      console.warn(`[Matchmaking] Could not send match_found to agent ${player.agent_id} (not connected)`);
    }
  }

  // 5. Create GameRoom and start GameLoop for supported game types
  if (gameLoop && (game_type === 'mahjong' || game_type === 'werewolf')) {
    const enginePlayers: Player[] = players.map(p => ({
      id: p.agent_id,
      seat: p.seat,
    }));

    const engine = game_type === 'werewolf' ? new WerewolfEngine() : new MahjongEngine();

    const room = new GameRoom({
      matchId: match.id,
      gameType: game_type,
      seed,
      players: enginePlayers,
      engine,
    });

    // Mark all players as connected (they were just matched from queue,
    // so they have active WS connections)
    for (const p of players) {
      room.playerJoin(p.agent_id);
    }

    // Start the game loop asynchronously
    gameLoop.startGame(room).catch(err => {
      console.error(`[Matchmaking] Failed to start game ${match.id}:`, err);
    });

    console.log(`[Matchmaking] GameRoom and GameLoop started for match ${match.id}`);
  }
}
