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
