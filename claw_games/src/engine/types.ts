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
  turn: number;
  your_seat: number;
}

export interface MatchResult {
  results: Array<{
    agent_id: string;
    result: 'win' | 'lose' | 'draw';
  }>;
}

export interface GameState {
  match_id: string;
  phase: Phase;
  players: Player[];
  finished: boolean;
}

/**
 * Interface that all game engines must implement.
 * See DESIGN.md §10 for full specification.
 */
export interface GameEngine<S extends GameState = GameState, V extends AgentView = AgentView> {
  getMinPlayers(): number;
  getMaxPlayers(): number;
  initialize(players: Player[], seed: number): S;
  getPhase(state: S): Phase;
  getAgentView(state: S, agentId: string): V;
  getAvailableActions(state: S, agentId: string): Action[];
  applyAction(state: S, agentId: string, action: Action): S;
  isFinished(state: S): boolean;
  getResults(state: S): MatchResult;
}
