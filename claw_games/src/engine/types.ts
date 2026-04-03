// Game-agnostic type definitions

export interface Player {
  id: string;
  seat: number;
}

export interface Phase {
  name: string;
  turn: number;
}

export interface Action {
  type: string;
  data: unknown;
}

export interface AgentView {
  match_id: string;
  phase: string;
}

export interface MatchResult {
  results: Array<{
    agent_id: string;
    result: 'win' | 'lose' | 'draw';
  }>;
}

/**
 * Base game state interface.
 * All game-specific state types must include at least match_id.
 */
export interface GameState {
  match_id: string;
}

/**
 * Interface that all game engines must implement.
 * See DESIGN.md §10 for full specification.
 *
 * Uses `any` for the state/view parameters in the orchestration layer
 * to allow game-specific types to flow through without explicit casts.
 * Individual engines implement this with their concrete types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GameEngine<S = any, V = any> {
  getMinPlayers(): number;
  getMaxPlayers(): number;
  initialize(players: Player[], seed: number): S;
  getPhase(state: S): Phase;
  getAgentView(state: S, agentId: string): V;
  getAvailableActions(state: S, agentId: string): Action[];
  applyAction(state: S, agentId: string, action: Action): S;
  isFinished(state: S): boolean;
  getResults(state: S): MatchResult;

  /**
   * Generate a default/fallback action for an agent that has timed out or
   * exhausted retries.  Engines that support automatic timeout behaviour
   * should implement this; it is optional so that simple engines can omit it
   * (in which case the game loop will fall back to the first available action
   * or skip the agent).
   */
  getTimeoutAction?(state: S, agentId: string): Action | null;
}
