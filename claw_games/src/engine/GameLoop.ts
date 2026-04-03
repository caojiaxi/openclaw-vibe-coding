// Game loop — drives phase transitions and action collection
// Orchestrates the game by calling engine methods, managing timeouts,
// and communicating with agents via WebSocket.
// See DESIGN.md §5 (WebSocket), §7 (Mahjong), §10 (Key Design Decisions)

import { GameRoom, getRoom } from './GameRoom.js';
import type { GameEngine, GameState, Phase, Action } from './types.js';
import { ActionLogDAO, GameSnapshotDAO } from '../server/db/index.js';
import { sendToAgent, broadcastToMatch, setMessageHandler, setForfeitHandler, setReconnectHandler } from '../server/ws/index.js';
import type { WSMessage } from '../server/ws/index.js';
import type { MahjongState } from '../games/mahjong/types.js';
import { MahjongActionType } from '../games/mahjong/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingAction {
  matchId: string;
  agentId: string;
  resolve: (action: Action) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_TIMEOUTS = 3;
const MAX_ACTION_RETRIES = 3;

// ─── Action Collection ───────────────────────────────────────────────────────

/** Pending action requests keyed by `${matchId}:${agentId}` */
const pendingActions = new Map<string, PendingAction>();

function pendingKey(matchId: string, agentId: string): string {
  return `${matchId}:${agentId}`;
}

// ─── GameLoop ────────────────────────────────────────────────────────────────

export class GameLoop {
  private running = new Map<string, boolean>();

  constructor() {
    // Wire up WS message handler
    setMessageHandler((agentId: string, message: WSMessage) => {
      this.handleAgentMessage(agentId, message);
    });

    // Wire up forfeit handler
    setForfeitHandler((agentId: string, matchId: string) => {
      this.handleForfeit(agentId, matchId);
    });

    // Wire up reconnect handler
    setReconnectHandler((agentId: string, matchId: string) => {
      this.handleReconnect(agentId, matchId);
    });
  }

  // ── Start a game loop for a room ─────────────────────────────────────

  async startGame(room: GameRoom): Promise<void> {
    const matchId = room.matchId;

    if (this.running.get(matchId)) {
      console.warn(`[GameLoop] Game ${matchId} is already running`);
      return;
    }

    this.running.set(matchId, true);

    try {
      // Initialize the game
      const state = room.startGame();
      console.log(`[GameLoop] Game ${matchId} started`);

      // Run the game loop
      await this.runLoop(room);
    } catch (err) {
      console.error(`[GameLoop] Error in game ${matchId}:`, err);
      room.abortGame();
    } finally {
      this.running.delete(matchId);
    }
  }

  // ── Main Loop ────────────────────────────────────────────────────────

  private async runLoop(room: GameRoom): Promise<void> {
    const matchId = room.matchId;
    const engine = room.engine;

    while (this.running.get(matchId)) {
      const state = room.getState();
      if (!state) break;

      // Check if game is finished
      if (engine.isFinished(state)) {
        console.log(`[GameLoop] Game ${matchId} finished`);
        await room.endGame();
        break;
      }

      // Broadcast current state to all players
      room.broadcastState();

      // Determine which agent(s) need to act
      const actingAgents = this.getActingAgents(room);

      if (actingAgents.length === 0) {
        // No one needs to act — this shouldn't happen, safety valve
        console.warn(`[GameLoop] Game ${matchId}: no acting agents, ending`);
        await room.endGame();
        break;
      }

      // Collect actions from all acting agents (concurrently for simultaneous phases)
      const actions = await this.collectActions(room, actingAgents);

      // Determine timeout for potential retries
      const timeoutMs = (state as MahjongState).action_timeout_ms ?? DEFAULT_ACTION_TIMEOUT_MS;

      // Apply actions to the game state
      let currentState = state;
      for (const { agentId, action } of actions) {
        let applied = false;
        let retries = 0;

        while (!applied && retries < MAX_ACTION_RETRIES) {
          try {
            currentState = engine.applyAction(currentState, agentId, action);
            applied = true;

            // Log the action
            const phase = engine.getPhase(currentState);
            ActionLogDAO.create({
              match_id: matchId,
              agent_id: agentId,
              turn: phase.turn,
              action_type: action.type,
              payload_json: JSON.stringify(action.data),
            });

            // Broadcast action result
            const actionResultMsg: WSMessage = {
              type: 'action_result',
              match_id: matchId,
              payload: {
                actor: agentId,
                action_type: action.type,
                result: action.data,
              },
              timestamp: new Date().toISOString(),
            };
            broadcastToMatch(matchId, actionResultMsg);
          } catch (err) {
            retries++;
            console.error(`[GameLoop] Error applying action from ${agentId} (attempt ${retries}/${MAX_ACTION_RETRIES}):`, err);

            // Send error to the agent
            const errorMsg: WSMessage = {
              type: 'error',
              match_id: matchId,
              payload: {
                code: 'INVALID_ACTION',
                message: err instanceof Error ? err.message : 'Invalid action',
              },
              timestamp: new Date().toISOString(),
            };
            sendToAgent(agentId, errorMsg);

            if (retries < MAX_ACTION_RETRIES) {
              // Re-send action_request with remaining timeout and wait for new response
              const remainingTimeoutMs = Math.max(
                5_000,
                timeoutMs - retries * 10_000,
              );
              const availableActions = engine.getAvailableActions(currentState, agentId);

              if (availableActions.length === 0) break;

              const retryRequestMsg: WSMessage = {
                type: 'action_request',
                match_id: matchId,
                payload: {
                  expected_action: availableActions.map(a => a.type),
                  options: availableActions,
                  timeout_ms: remainingTimeoutMs,
                  retry: retries,
                },
                timestamp: new Date().toISOString(),
              };
              sendToAgent(agentId, retryRequestMsg);

              const retryResult = await this.waitForAction(matchId, agentId, remainingTimeoutMs, room);
              if (retryResult) {
                // Update action for next loop iteration
                action.type = retryResult.action.type;
                action.data = retryResult.action.data;
              } else {
                // Timeout on retry — fall back to default action
                break;
              }
            }
          }
        }

        // After max retries exhausted without success, fall back to engine timeout/default action
        if (!applied) {
          console.warn(`[GameLoop] Max retries exhausted for ${agentId}, falling back to default action`);
          let fallbackAction: Action | null = null;

          if (engine.getTimeoutAction) {
            fallbackAction = engine.getTimeoutAction(currentState, agentId);
          }

          // Generic fallback: use the first available action if the engine
          // does not provide a getTimeoutAction implementation
          if (!fallbackAction) {
            const available = engine.getAvailableActions(currentState, agentId);
            fallbackAction = available.length > 0 ? available[0] : null;
          }

          if (fallbackAction) {
            try {
              currentState = engine.applyAction(currentState, agentId, fallbackAction);
            } catch (fallbackErr) {
              console.error(`[GameLoop] Fallback action also failed for ${agentId}:`, fallbackErr);
            }
          }
        }
      }

      // Update room state
      room.updateState(currentState);

      // Save snapshot at phase transitions
      const newPhase = engine.getPhase(currentState);
      this.saveSnapshotIfNeeded(matchId, newPhase, currentState);
    }
  }

  // ── Agent Action Collection ──────────────────────────────────────────

  /** Determine which agents need to act in the current state */
  private getActingAgents(room: GameRoom): string[] {
    const state = room.getState();
    if (!state) return [];

    const acting: string[] = [];
    for (const player of room.players) {
      const actions = room.engine.getAvailableActions(state, player.id);
      if (actions.length > 0) {
        acting.push(player.id);
      }
    }

    return acting;
  }

  /** Collect actions from multiple agents concurrently */
  private async collectActions(
    room: GameRoom,
    agentIds: string[],
  ): Promise<Array<{ agentId: string; action: Action }>> {
    const state = room.getState();
    if (!state) return [];

    const matchId = room.matchId;
    const engine = room.engine;

    // Determine timeout
    const timeoutMs = (state as MahjongState).action_timeout_ms ?? DEFAULT_ACTION_TIMEOUT_MS;

    // Request actions from all agents concurrently
    const promises = agentIds.map(agentId => {
      const availableActions = engine.getAvailableActions(state, agentId);

      // Send action_request to the agent
      const requestMsg: WSMessage = {
        type: 'action_request',
        match_id: matchId,
        payload: {
          expected_action: availableActions.map(a => a.type),
          options: availableActions,
          timeout_ms: timeoutMs,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, requestMsg);

      return this.waitForAction(matchId, agentId, timeoutMs, room);
    });

    const results = await Promise.all(promises);
    return results.filter((r): r is { agentId: string; action: Action } => r !== null);
  }

  /** Wait for an agent to submit an action, with timeout */
  private waitForAction(
    matchId: string,
    agentId: string,
    timeoutMs: number,
    room: GameRoom,
  ): Promise<{ agentId: string; action: Action } | null> {
    return new Promise(resolve => {
      const key = pendingKey(matchId, agentId);

      const timer = setTimeout(() => {
        // Timeout — generate default action
        pendingActions.delete(key);
        const timeoutAction = this.handleTimeout(room, agentId);
        if (timeoutAction) {
          resolve({ agentId, action: timeoutAction });
        } else {
          resolve(null);
        }
      }, timeoutMs);

      pendingActions.set(key, {
        matchId,
        agentId,
        resolve: (action: Action) => {
          clearTimeout(timer);
          pendingActions.delete(key);
          resolve({ agentId, action });
        },
        timer,
      });
    });
  }

  /** Handle action timeout — auto-pass/auto-discard and track consecutive timeouts */
  private handleTimeout(room: GameRoom, agentId: string): Action | null {
    const state = room.getState() as MahjongState | null;
    if (!state) return null;

    const player = state.players.find(p => p.agent_id === agentId);
    if (!player) return null;

    player.consecutive_timeouts++;
    console.log(`[GameLoop] Agent ${agentId} timed out (${player.consecutive_timeouts}/${MAX_CONSECUTIVE_TIMEOUTS})`);

    // 3 consecutive timeouts → forfeit
    if (player.consecutive_timeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
      console.log(`[GameLoop] Agent ${agentId} forfeited due to ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts`);
      player.is_forfeited = true;

      // Notify the agent
      const forfeitMsg: WSMessage = {
        type: 'error',
        match_id: room.matchId,
        payload: {
          code: 'FORFEITED',
          message: `You have been forfeited due to ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts`,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, forfeitMsg);
    }

    // Generate timeout action
    const engine = room.engine;
    if (engine.getTimeoutAction) {
      return engine.getTimeoutAction(state, agentId);
    }

    // Generic fallback: use the first available action
    const available = engine.getAvailableActions(state, agentId);
    return available.length > 0 ? available[0] : null;
  }

  // ── WS Message Handling ──────────────────────────────────────────────

  private handleAgentMessage(agentId: string, message: WSMessage): void {
    if (message.type !== 'action') return;

    const payload = message.payload as { match_id?: string; action_type?: string; data?: unknown };
    if (!payload.match_id) return;

    const key = pendingKey(payload.match_id, agentId);
    const pending = pendingActions.get(key);
    if (!pending) {
      // No pending action request — send error
      const errorMsg: WSMessage = {
        type: 'error',
        match_id: payload.match_id,
        payload: { code: 'UNEXPECTED_ACTION', message: 'No action was requested from you' },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, errorMsg);
      return;
    }

    // Validate the action against available actions
    const room = getRoom(pending.matchId);
    if (!room) return;

    const state = room.getState();
    if (!state) return;

    const availableActions = room.engine.getAvailableActions(state, agentId);
    const action: Action = {
      type: payload.action_type ?? '',
      data: payload.data,
    };

    // Check if the action type is valid
    const isValid = availableActions.some(a => a.type === action.type);
    if (!isValid) {
      const errorMsg: WSMessage = {
        type: 'error',
        match_id: pending.matchId,
        payload: {
          code: 'INVALID_ACTION',
          message: `Action "${action.type}" is not available. Valid actions: ${availableActions.map(a => a.type).join(', ')}`,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, errorMsg);
      return;
    }

    // Validate action payload against available options
    const payloadError = this.validateActionPayload(action, availableActions);
    if (payloadError) {
      const errorMsg: WSMessage = {
        type: 'error',
        match_id: pending.matchId,
        payload: {
          code: 'INVALID_ACTION_PAYLOAD',
          message: payloadError,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, errorMsg);
      return;
    }

    // Resolve the pending action
    pending.resolve(action);
  }

  private handleForfeit(agentId: string, matchId: string): void {
    const room = getRoom(matchId);
    if (!room) return;

    const state = room.getState() as MahjongState | null;
    if (!state) return;

    const player = state.players.find(p => p.agent_id === agentId);
    if (player) {
      player.is_forfeited = true;
      console.log(`[GameLoop] Agent ${agentId} forfeited match ${matchId}`);
    }

    // Resolve any pending action for this agent with a timeout action
    const key = pendingKey(matchId, agentId);
    const pending = pendingActions.get(key);
    if (pending) {
      const engine = room.engine;
      let timeoutAction: Action | null = null;
      if (engine.getTimeoutAction) {
        timeoutAction = engine.getTimeoutAction(state, agentId);
      }
      if (!timeoutAction) {
        const available = engine.getAvailableActions(state, agentId);
        timeoutAction = available.length > 0 ? available[0] : null;
      }
      if (timeoutAction) {
        pending.resolve(timeoutAction);
      }
    }
  }

  private handleReconnect(agentId: string, matchId: string): void {
    const room = getRoom(matchId);
    if (!room) return;

    // Re-register the player
    room.playerJoin(agentId);

    // Send full state update (DESIGN.md §5.4)
    room.sendStateToAgent(agentId);

    console.log(`[GameLoop] Agent ${agentId} reconnected to match ${matchId} — state sent`);

    // If there's a pending action request, re-send it
    const state = room.getState();
    if (!state) return;

    const actions = room.engine.getAvailableActions(state, agentId);
    if (actions.length > 0) {
      const timeoutMs = (state as MahjongState).action_timeout_ms ?? DEFAULT_ACTION_TIMEOUT_MS;
      const requestMsg: WSMessage = {
        type: 'action_request',
        match_id: matchId,
        payload: {
          expected_action: actions.map(a => a.type),
          options: actions,
          timeout_ms: timeoutMs,
        },
        timestamp: new Date().toISOString(),
      };
      sendToAgent(agentId, requestMsg);
    }
  }

  // ── Snapshot Management ──────────────────────────────────────────────

  private lastPhase = new Map<string, string>();

  // ── Action Payload Validation ──────────────────────────────────────

  /**
   * Validate that the submitted action payload matches one of the offered options.
   * Compares the submitted Action.data against the Action.data shapes returned
   * by engine.getAvailableActions() — both use the engine's Action interface
   * ({ type: string, data: unknown }).
   *
   * Returns an error message string if invalid, or null if valid.
   */
  private validateActionPayload(action: Action, availableActions: Action[]): string | null {
    const data = action.data as Record<string, unknown> | undefined;
    if (!data) return null;

    const matchingOptions = availableActions.filter(a => a.type === action.type);

    switch (action.type) {
      case MahjongActionType.Discard: {
        const tile = data.tile as { suit?: string; value?: number } | undefined;
        if (!tile) return 'Discard action requires a tile';
        const tileMatches = matchingOptions.some(a => {
          const optTile = (a.data as Record<string, unknown>)?.tile as { suit?: string; value?: number } | undefined;
          return optTile && optTile.suit === tile.suit && optTile.value === tile.value;
        });
        if (!tileMatches) {
          return `Tile ${tile.suit}-${tile.value} is not a valid discard option`;
        }
        return null;
      }

      case MahjongActionType.DeclareLack: {
        const suit = data.suit as string | undefined;
        if (!suit) return 'Declare lack action requires a suit';
        const suitMatches = matchingOptions.some(a => {
          const optSuit = (a.data as Record<string, unknown>)?.suit as string | undefined;
          return optSuit === suit;
        });
        if (!suitMatches) {
          return `Suit "${suit}" is not a valid declare-lack option`;
        }
        return null;
      }

      case MahjongActionType.Kong: {
        const kongType = data.kong_type as string | undefined;
        if (!kongType) return 'Kong action requires a kong_type';
        const kongMatches = matchingOptions.some(a => {
          const optKongType = (a.data as Record<string, unknown>)?.kong_type as string | undefined;
          return optKongType === kongType;
        });
        if (!kongMatches) {
          const validTypes = matchingOptions
            .map(a => (a.data as Record<string, unknown>)?.kong_type)
            .filter(Boolean)
            .join(', ');
          return `Kong type "${kongType}" is not available. Valid kong types: ${validTypes}`;
        }
        return null;
      }

      // pong/hu/pass/draw: type match is sufficient — no additional payload validation needed
      case MahjongActionType.Pong:
      case MahjongActionType.Hu:
      case MahjongActionType.Pass:
      case MahjongActionType.Draw:
        return null;

      default:
        // For non-Mahjong actions, type match is sufficient
        return null;
    }
  }

  private saveSnapshotIfNeeded(matchId: string, phase: Phase, state: GameState): void {
    const phaseKey = `${phase.name}:${phase.turn}`;
    const lastKey = this.lastPhase.get(matchId);

    if (phaseKey !== lastKey) {
      this.lastPhase.set(matchId, phaseKey);
      GameSnapshotDAO.create({
        match_id: matchId,
        phase: phase.name,
        turn: phase.turn,
        state_json: JSON.stringify(state),
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  stopGame(matchId: string): void {
    this.running.set(matchId, false);
    this.lastPhase.delete(matchId);

    // Clear any pending actions for this match
    for (const [key, pending] of pendingActions.entries()) {
      if (pending.matchId === matchId) {
        clearTimeout(pending.timer);
        pendingActions.delete(key);
      }
    }
  }
}
