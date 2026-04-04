// Sichuan Mahjong type definitions
// See DESIGN.md §7 for full specification

import { Tile, Suit } from './tiles.js';

// ─── Enums ───────────────────────────────────────────────────────────────────

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
  Exposed = 'exposed',   // 明杠 — from another player's discard
  Concealed = 'concealed', // 暗杠 — all 4 tiles in hand
  Added = 'added',       // 加杠 — adding 4th tile to existing pong
}

/** The sub-phase within the Playing phase */
export enum PlaySubPhase {
  /** Active player draws a tile */
  Draw = 'draw',
  /** Active player decides: self-draw win / kong / discard */
  PostDraw = 'post_draw',
  /** Waiting for discard reactions from other players */
  DiscardReaction = 'discard_reaction',
  /** Resolving a claim (pong/kong/hu) */
  ResolveClaim = 'resolve_claim',
}

export enum MahjongActionType {
  DeclareLack = 'declare_lack',
  Draw = 'draw',
  Discard = 'discard',
  Pong = 'pong',
  Kong = 'kong',           // All kong types
  Hu = 'hu',
  Pass = 'pass',
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ExposedSet {
  type: SetType;
  tiles: Tile[];
  kong_type?: KongType;
  /** Seat of the player who discarded the tile (for 明杠 / pong) */
  source_seat?: number;
}

/** A pending claim from a player reacting to a discard */
export interface PendingClaim {
  /** Seat of the claiming player */
  seat: number;
  /** Type of claim */
  action: MahjongActionType.Pong | MahjongActionType.Kong | MahjongActionType.Hu;
  /** The tiles from hand used for the claim (for pong: 2 tiles, kong: 3 tiles) */
  tiles?: Tile[];
}

/** Tracks a win event in blood battle mode */
export interface WinEvent {
  /** Seat of the winner */
  winner_seat: number;
  /** Seat(s) of the payer(s) */
  payer_seats: number[];
  /** Points per payer */
  points_per_payer: number;
  /** Win type */
  win_type: 'self_draw' | 'discard';
  /** The winning tile */
  winning_tile: Tile;
  /** Scoring breakdown */
  fan_breakdown: { pattern: string; fan: number }[];
  /** Total fan */
  total_fan: number;
  /** Was this a kong draw (杠上开花)? */
  is_kong_draw: boolean;
  /** Was this a robbing kong (抢杠胡)? */
  is_robbing_kong: boolean;
  /** Was this the last tile (海底捞月)? */
  is_last_tile: boolean;
}

/** Kong payment event */
export interface KongPayment {
  /** Seat of the kong declarer */
  declarer_seat: number;
  /** Kong type */
  kong_type: KongType;
  /** Seat of the discarder (only for 明杠) */
  source_seat?: number;
  /** Points per payer */
  points_per_payer: number;
  /** Seats that pay */
  payer_seats: number[];
}

/** Settlement entry for final results */
export interface Settlement {
  agent_id: string;
  seat: number;
  /** Final score including all kong payments and win settlements */
  final_score: number;
  /** Finish order: 1=first winner, 4=last/loser; 0=unfinished */
  finish_order: number;
  result: 'win' | 'lose' | 'draw';
}

// ─── Player State ────────────────────────────────────────────────────────────

export interface MahjongPlayer {
  agent_id: string;
  seat: number;           // 0-3
  hand: Tile[];           // Concealed tiles
  declared_lack: Suit | null;
  has_declared_lack: boolean; // Whether the player has submitted their declaration
  exposed_sets: ExposedSet[];
  discards: Tile[];
  has_won: boolean;
  score: number;          // Running total including kong payments
  /** Number of consecutive timeouts */
  consecutive_timeouts: number;
  /** Whether this player has been forfeited due to timeouts */
  is_forfeited: boolean;
}

// ─── Discard State ───────────────────────────────────────────────────────────

/** Tracks the current discard that players can react to */
export interface DiscardInfo {
  /** The discarded tile */
  tile: Tile;
  /** Seat of the player who discarded */
  source_seat: number;
  /** Seats that still need to respond (pass or claim) */
  pending_responses: number[];
  /** Claims received so far */
  claims: PendingClaim[];
  /** Timestamp when the reaction window started */
  started_at: number;
}

/** Tracks state for an add-kong that can be robbed */
export interface PendingAddKong {
  /** The tile being added to a pong to form a kong */
  tile: Tile;
  /** Seat of the player performing the add kong */
  seat: number;
  /** Seats that can potentially rob the kong */
  pending_responses: number[];
  /** Any hu claims received */
  claims: PendingClaim[];
  /** Timestamp when the reaction window started */
  started_at: number;
}

// ─── Full Game State ─────────────────────────────────────────────────────────

export interface MahjongState {
  match_id: string;
  phase: MahjongPhase;
  sub_phase: PlaySubPhase | null;
  players: MahjongPlayer[];
  wall: Tile[];           // Remaining drawable tiles (front)
  wall_back: Tile[];      // Back of wall for replacement draws after kong
  current_turn: number;   // Seat of current active player
  dealer: number;         // Seat of dealer (庄家)
  turn_count: number;     // Monotonically increasing turn counter
  winners: number[];      // Seats in order of winning
  seed: number;

  /** Current discard awaiting reactions (null if not in reaction window) */
  current_discard: DiscardInfo | null;

  /** Pending add-kong that can be robbed (null if not applicable) */
  pending_add_kong: PendingAddKong | null;

  /** Whether the last draw was a replacement draw after kong (for 杠上开花) */
  is_kong_replacement_draw: boolean;

  /** The actual tile drawn in the last draw action (for accurate winning_tile tracking) */
  last_drawn_tile: Tile | null;

  /** Win events in order (blood battle mode settlement history) */
  win_events: WinEvent[];

  /** Kong payments in order */
  kong_payments: KongPayment[];

  /** Final settlements (populated when game finishes) */
  settlements: Settlement[];

  /** Action timeout in ms (default 30000) */
  action_timeout_ms: number;

  /** Base point multiplier (default 1) */
  base_points: number;

  /** Maximum points per settlement (default 256) */
  max_points: number;

  /** Timestamp of the last action (for timeout tracking) */
  last_action_at: number;
}

// ─── Agent View ──────────────────────────────────────────────────────────────

export interface MahjongAgentView {
  match_id: string;
  phase: string;
  sub_phase: string | null;
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
  /** The current discard tile and source (if in reaction window) */
  current_discard: { tile: Tile; source_seat: number } | null;
  /** Available actions for this agent */
  action_options?: ActionOption[];
  /** Win events so far */
  win_events: WinEvent[];
  /** Kong payments so far */
  kong_payments: KongPayment[];
  /** Turn count */
  turn_count: number;
  /** Is game finished? */
  is_finished: boolean;
  /** Final settlements (only when finished) */
  settlements?: Settlement[];
}

// ─── Spectator View ──────────────────────────────────────────────────────────

export interface SpectatorPlayerInfo {
  seat: number;
  agent_id: string;
  hand_count: number;          // Number of concealed tiles
  hand: Tile[];                // Full hand (for dev/spectator mode)
  declared_lack: Suit | null;
  has_declared_lack: boolean;
  exposed_sets: ExposedSet[];
  discards: Tile[];
  has_won: boolean;
  score: number;
  is_forfeited: boolean;
}

export interface SpectatorView {
  match_id: string;
  phase: MahjongPhase;
  sub_phase: PlaySubPhase | null;
  players: SpectatorPlayerInfo[];
  current_turn: number;
  tiles_remaining: number;
  scores: number[];
  winners: number[];
  current_discard: { tile: Tile; source_seat: number } | null;
  win_events: WinEvent[];
  kong_payments: KongPayment[];
  turn_count: number;
  is_finished: boolean;
  settlements?: Settlement[];
}

// ─── Action Types ────────────────────────────────────────────────────────────

export interface ActionOption {
  type: MahjongActionType;
  tiles?: Tile[];   // Relevant tiles for the action
  kong_type?: KongType; // For kong actions, specifies the type
}

export interface MahjongAction {
  type: MahjongActionType;
  /** Tile to discard / tile to declare lack suit / etc. */
  tile?: Tile;
  /** Suit to declare lacking (for declare_lack action) */
  suit?: Suit;
  /** Kong type (for kong action) */
  kong_type?: KongType;
}
