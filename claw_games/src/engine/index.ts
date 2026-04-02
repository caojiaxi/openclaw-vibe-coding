// Game-agnostic orchestration engine
// Handles room lifecycle, turn sequencing, and result recording

export { GameLoop } from './GameLoop';
export { GameRoom } from './GameRoom';
export type { GameEngine, GameState, Phase, Player, Action, MatchResult, AgentView } from './types';
