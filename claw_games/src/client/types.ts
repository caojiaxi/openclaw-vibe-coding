// API response types matching DESIGN.md sections 4.3 and 4.4

export type GameType = 'werewolf' | 'mahjong';
export type MatchStatus = 'in_progress' | 'completed' | 'aborted';
export type MatchResult = 'win' | 'lose' | 'draw';

// --- Leaderboard ---

export interface LeaderboardEntry {
  rank: number;
  agent_id: string;
  name: string;
  rating: number;
  matches_played: number;
  wins: number;
  losses?: number;
  draws?: number;
  peak_rating?: number;
}

export interface LeaderboardResponse {
  game_type: GameType;
  entries: LeaderboardEntry[];
  total: number;
}

// --- Matches ---

export interface MatchParticipant {
  agent_id: string;
  name: string;
  seat: number;
  role?: string;
  result: MatchResult;
  rating_before?: number;
  rating_after?: number;
}

export interface MatchSummary {
  id: string;
  game_type: GameType;
  status: MatchStatus;
  started_at: string;
  ended_at: string | null;
  participants: MatchParticipant[];
}

export interface MatchDetail extends MatchSummary {
  result_summary: string | null;
  seed: number;
}

export interface MatchListResponse {
  matches: MatchSummary[];
  total: number;
}

// --- Mahjong Spectator Types ---

export type MahjongSuit = 'bamboo' | 'dots' | 'characters';

export interface MahjongTile {
  suit: MahjongSuit;
  value: number; // 1-9
}

export type MahjongPhase = 'dealing' | 'declare_lacking' | 'playing' | 'finished';
export type PlaySubPhase = 'draw' | 'post_draw' | 'discard_reaction' | 'resolve_claim';

export type SetType = 'sequence' | 'triplet' | 'kong';
export type KongType = 'exposed' | 'concealed' | 'added';

export interface ExposedSet {
  type: SetType;
  tiles: MahjongTile[];
  kong_type?: KongType;
  source_seat?: number;
}

export interface WinEvent {
  winner_seat: number;
  payer_seats: number[];
  points_per_payer: number;
  win_type: 'self_draw' | 'discard';
  winning_tile: MahjongTile;
  fan_breakdown: { pattern: string; fan: number }[];
  total_fan: number;
  is_kong_draw: boolean;
  is_robbing_kong: boolean;
  is_last_tile: boolean;
}

export interface KongPayment {
  declarer_seat: number;
  kong_type: KongType;
  source_seat?: number;
  points_per_payer: number;
  payer_seats: number[];
}

export interface Settlement {
  agent_id: string;
  seat: number;
  final_score: number;
  finish_order: number;
  result: 'win' | 'lose' | 'draw';
}

export interface SpectatorPlayerInfo {
  seat: number;
  agent_id: string;
  hand_count: number;
  declared_lack: MahjongSuit | null;
  has_declared_lack: boolean;
  exposed_sets: ExposedSet[];
  discards: MahjongTile[];
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
  current_discard: { tile: MahjongTile; source_seat: number } | null;
  win_events: WinEvent[];
  kong_payments: KongPayment[];
  turn_count: number;
  is_finished: boolean;
  settlements?: Settlement[];
}

export interface SpectateInfoResponse {
  match_id: string;
  game_type: GameType;
  status: MatchStatus;
  started_at: string;
  ended_at: string | null;
  can_spectate: boolean;
  participants: {
    agent_id: string;
    name: string;
    seat: number;
  }[];
}
