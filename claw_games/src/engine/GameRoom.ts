// Game room — lifecycle management (create, join, start, end)
// See DESIGN.md §10 for design decisions

import { GameEngine, Player, MatchResult } from './types.js';
import {
  getDatabase,
  MatchDAO,
  MatchParticipantDAO,
  AgentRatingDAO,
  GameSnapshotDAO,
} from '../server/db/index.js';
import { updateRatingsMultiplayer } from '../ratings/elo.js';
import { clearMatchParticipants } from '../server/routes/matchmaking.js';
import { setAgentMatch, broadcastToMatch, sendToAgent } from '../server/ws/index.js';
import type { WSMessage } from '../server/ws/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GameRoomConfig {
  matchId: string;
  gameType: string;
  seed: number;
  players: Player[];
  engine: GameEngine;
}

export type RoomStatus = 'waiting' | 'in_progress' | 'completed' | 'aborted';

// ─── Active Room Registry ────────────────────────────────────────────────────

const activeRooms = new Map<string, GameRoom>();

export function getRoom(matchId: string): GameRoom | undefined {
  return activeRooms.get(matchId);
}

export function getAllRooms(): Map<string, GameRoom> {
  return activeRooms;
}

// ─── GameRoom ────────────────────────────────────────────────────────────────

export class GameRoom {
  readonly matchId: string;
  readonly gameType: string;
  readonly seed: number;
  readonly players: Player[];
  readonly engine: GameEngine;

  private status: RoomStatus = 'waiting';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private state: any = null;
  private connectedPlayers: Set<string> = new Set();

  constructor(config: GameRoomConfig) {
    this.matchId = config.matchId;
    this.gameType = config.gameType;
    this.seed = config.seed;
    this.players = config.players;
    this.engine = config.engine;

    // Register in global registry
    activeRooms.set(this.matchId, this);
  }

  // ── Getters ────────────────────────────────────────────────────────────

  getStatus(): RoomStatus {
    return this.status;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getState(): any {
    return this.state;
  }

  getPlayerAgentIds(): string[] {
    return this.players.map(p => p.id);
  }

  isAllConnected(): boolean {
    return this.connectedPlayers.size >= this.players.length;
  }

  // ── Player Connection Tracking ─────────────────────────────────────────

  playerJoin(agentId: string): void {
    const player = this.players.find(p => p.id === agentId);
    if (!player) {
      throw new Error(`Agent ${agentId} is not a participant in match ${this.matchId}`);
    }
    this.connectedPlayers.add(agentId);

    // Associate the WS connection with this match
    setAgentMatch(agentId, this.matchId);
  }

  playerLeave(agentId: string): void {
    this.connectedPlayers.delete(agentId);
  }

  isPlayerConnected(agentId: string): boolean {
    return this.connectedPlayers.has(agentId);
  }

  // ── Game Lifecycle ─────────────────────────────────────────────────────

  /** Initialize and start the game */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startGame(): any {
    if (this.status !== 'waiting') {
      throw new Error(`Cannot start game: room is ${this.status}`);
    }

    this.status = 'in_progress';
    this.state = this.engine.initialize(this.players, this.seed);

    // Set the match_id on the state
    if (this.state && typeof this.state === 'object') {
      this.state.match_id = this.matchId;
    }

    // Save initial snapshot
    this.saveSnapshot('initial');

    // Broadcast game_start to all players
    for (const player of this.players) {
      const view = this.engine.getAgentView(this.state, player.id);
      const message: WSMessage = {
        type: 'game_start',
        match_id: this.matchId,
        payload: {
          match_id: this.matchId,
          initial_state: view,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(player.id, message);
    }

    return this.state;
  }

  /** Update the game state (called by GameLoop after applying actions) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateState(newState: any): void {
    this.state = newState;
  }

  /** Send a state update to a specific agent (e.g. on reconnect) */
  sendStateToAgent(agentId: string): void {
    if (!this.state) return;

    const view = this.engine.getAgentView(this.state, agentId);
    const message: WSMessage = {
      type: 'state_update',
      match_id: this.matchId,
      payload: { visible_state: view },
      timestamp: new Date().toISOString(),
    };
    sendToAgent(agentId, message);
  }

  /** Broadcast state update to all players */
  broadcastState(): void {
    if (!this.state) return;

    for (const player of this.players) {
      this.sendStateToAgent(player.id);
    }
  }

  /** End the game: persist results, update ratings, cleanup */
  async endGame(): Promise<void> {
    if (this.status === 'completed' || this.status === 'aborted') return;
    if (!this.state) return;

    this.status = 'completed';

    // Save final snapshot
    this.saveSnapshot('final');

    // Get results
    const results = this.engine.getResults(this.state);

    // Update match record
    MatchDAO.update(this.matchId, {
      status: 'completed',
      ended_at: new Date().toISOString(),
      result_summary: JSON.stringify(results),
    });

    // Update participant records and compute new ratings
    this.updateRatings(results);

    // Broadcast game_end
    const ratingChanges = this.computeRatingChanges(results);
    const gameEndMessage: WSMessage = {
      type: 'game_end',
      match_id: this.matchId,
      payload: {
        results: results.results,
        rating_changes: ratingChanges,
      },
      timestamp: new Date().toISOString(),
    };
    broadcastToMatch(this.matchId, gameEndMessage);

    // Cleanup
    this.cleanup();
  }

  /** Abort the game (e.g. all players disconnected) */
  abortGame(): void {
    if (this.status === 'completed' || this.status === 'aborted') return;

    this.status = 'aborted';

    MatchDAO.update(this.matchId, {
      status: 'aborted',
      ended_at: new Date().toISOString(),
    });

    const abortMessage: WSMessage = {
      type: 'game_end',
      match_id: this.matchId,
      payload: {
        results: [],
        rating_changes: [],
        aborted: true,
      },
      timestamp: new Date().toISOString(),
    };
    broadcastToMatch(this.matchId, abortMessage);

    this.cleanup();
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private saveSnapshot(label: string): void {
    if (!this.state) return;

    const phase = this.engine.getPhase(this.state);
    GameSnapshotDAO.create({
      match_id: this.matchId,
      phase: label === 'initial' ? 'initial' : label === 'final' ? 'final' : phase.name,
      turn: phase.turn,
      state_json: JSON.stringify(this.state),
    });
  }

  private updateRatings(results: MatchResult): void {
    // Determine actual scores for ELO (DESIGN.md §8.3 Mahjong scoring)
    const participants = MatchParticipantDAO.getForMatch(this.matchId);

    // Extract win order from state settlements (if available) for placement-based scoring
    // Settlement finish_order: 1=first winner, 2=second, 3=third, 4=last/loser
    const settlements = this.state?.settlements as Array<{ agent_id: string; finish_order: number; result: string }> | undefined;
    const winnerCount = results.results.filter(r => r.result === 'win').length;

    // Build player data for multi-player ELO
    const eloPlayers = participants.map(mp => {
      const matchResult = results.results.find(r => r.agent_id === mp.agent_id);
      const rating = AgentRatingDAO.ensureRating(mp.agent_id, this.gameType);

      // Determine actual score for Mahjong: based on placement
      // 1st winner: 1.0, 2nd: 0.67, 3rd: 0.33, loser: 0.0
      let actualScore: number;
      if (!matchResult || matchResult.result === 'lose') {
        actualScore = 0.0;
      } else if (matchResult.result === 'draw') {
        actualScore = 0.5;
      } else {
        // Win — score depends on placement order from settlements
        const settlement = settlements?.find(s => s.agent_id === mp.agent_id);
        if (!settlement) {
          // No settlement data for this winner — default to loss score for safety
          actualScore = 0.0;
        } else if (winnerCount <= 1) {
          // Only one winner — full score
          actualScore = 1.0;
        } else {
          // Multiple winners — placement-based scoring
          // 1st: 1.0, 2nd: 0.67, 3rd: 0.33
          const placementScores: Record<number, number> = { 1: 1.0, 2: 0.67, 3: 0.33 };
          actualScore = placementScores[settlement.finish_order] ?? 0.0;
        }
      }

      return {
        agent_id: mp.agent_id,
        rating: rating.rating,
        matchesPlayed: rating.matches_played,
        actualScore,
      };
    });

    // Calculate new ratings
    const newRatings = updateRatingsMultiplayer(
      eloPlayers.map(p => ({
        rating: p.rating,
        matchesPlayed: p.matchesPlayed,
        actualScore: p.actualScore,
      })),
    );

    // Persist updated ratings and participant records (transactional)
    const persistRatings = getDatabase().transaction(() => {
      for (let i = 0; i < eloPlayers.length; i++) {
        const ep = eloPlayers[i];
        const matchResult = results.results.find(r => r.agent_id === ep.agent_id);
        const newRating = newRatings[i];
        const currentRating = AgentRatingDAO.getForAgentAndGame(ep.agent_id, this.gameType)!;

        // Update agent_ratings
        const isWin = matchResult?.result === 'win';
        const isLoss = matchResult?.result === 'lose';
        AgentRatingDAO.update(ep.agent_id, this.gameType, {
          rating: newRating,
          matches_played: currentRating.matches_played + 1,
          wins: currentRating.wins + (isWin ? 1 : 0),
          losses: currentRating.losses + (isLoss ? 1 : 0),
          draws: currentRating.draws + (!isWin && !isLoss ? 1 : 0),
          peak_rating: Math.max(currentRating.peak_rating, newRating),
        });

        // Update match_participants
        MatchParticipantDAO.update(this.matchId, ep.agent_id, {
          result: matchResult?.result ?? null,
          rating_after: newRating,
        });
      }
    });
    persistRatings();
  }

  private computeRatingChanges(results: MatchResult): Array<{ agent_id: string; before: number; after: number }> {
    const changes: Array<{ agent_id: string; before: number; after: number }> = [];

    const participants = MatchParticipantDAO.getForMatch(this.matchId);
    for (const mp of participants) {
      changes.push({
        agent_id: mp.agent_id,
        before: mp.rating_before,
        after: mp.rating_after ?? mp.rating_before,
      });
    }

    return changes;
  }

  private cleanup(): void {
    // Clear in-match flags so agents can re-queue
    const agentIds = this.players.map(p => p.id);
    clearMatchParticipants(agentIds);

    // Clear WS match association
    for (const agentId of agentIds) {
      setAgentMatch(agentId, null);
    }

    // Remove from active rooms
    activeRooms.delete(this.matchId);
  }
}
