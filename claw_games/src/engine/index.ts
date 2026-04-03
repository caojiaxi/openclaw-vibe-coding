// Game-agnostic orchestration engine
// Handles room lifecycle, turn sequencing, and result recording

export { GameLoop } from './GameLoop.js';
export { GameRoom, getRoom, getAllRooms } from './GameRoom.js';
export type { GameRoomConfig, RoomStatus } from './GameRoom.js';
export type { GameEngine, GameState, Phase, Player, Action, MatchResult, AgentView } from './types.js';
