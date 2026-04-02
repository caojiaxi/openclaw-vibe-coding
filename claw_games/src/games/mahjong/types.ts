// Sichuan Mahjong type definitions

import { Tile, Suit } from './tiles';

export enum MahjongPhase {
  Dealing = 'dealing',
  DeclareLacking = 'declare_lacking',
  Playing = 'playing',
  Finished = 'finished',
}

export enum SetType {
  Sequence = 'sequence', // 顺子
  Triplet = 'triplet',   // 刻子
  Kong = 'kong',         // 杠
}

export enum KongType {
  Exposed = 'exposed',   // 明杠
  Concealed = 'concealed', // 暗杠
  Added = 'added',       // 加杠
}

export interface ExposedSet {
  type: SetType;
  tiles: Tile[];
  kong_type?: KongType;
}

export interface MahjongPlayer {
  agent_id: string;
  seat: number;           // 0-3
  hand: Tile[];           // Concealed tiles
  declared_lack: Suit | null;
  exposed_sets: ExposedSet[];
  discards: Tile[];
  has_won: boolean;
  score: number;          // Running total including kong payments
}

export interface MahjongState {
  match_id: string;
  phase: MahjongPhase;
  players: MahjongPlayer[];
  wall: Tile[];           // Remaining drawable tiles
  current_turn: number;   // Seat of current player
  dealer: number;         // Seat of dealer (庄家)
  winners: number[];      // Seats in order of winning
  seed: number;
}

export interface MahjongAgentView {
  match_id: string;
  phase: string;
  your_seat: number;
  your_hand: Tile[];
  your_declared_lack: Suit | null;
  declared_lacks: (Suit | null)[];
  exposed_sets: ExposedSet[][];
  discards: Tile[][];
  current_turn: number;
  tiles_remaining: number;
  scores: number[];
  winners: number[];
  action_options?: ActionOption[];
}

export interface ActionOption {
  type: 'draw' | 'discard' | 'pong' | 'kong' | 'hu' | 'pass';
  tiles?: Tile[];   // Relevant tiles for the action
}
