import type {
  LeaderboardResponse,
  MatchListResponse,
  MatchDetail,
  GameType,
  MatchStatus,
  SpectateInfoResponse,
} from './types';

const BASE = '/api/v1';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// --- Leaderboard ---

export function getLeaderboard(
  gameType: GameType,
  limit = 50,
  offset = 0,
): Promise<LeaderboardResponse> {
  return fetchJSON<LeaderboardResponse>(
    `${BASE}/leaderboard/${gameType}?limit=${limit}&offset=${offset}`,
  );
}

// --- Matches ---

export interface MatchFilters {
  game_type?: GameType;
  status?: MatchStatus;
  limit?: number;
  offset?: number;
}

export function getMatches(filters: MatchFilters = {}): Promise<MatchListResponse> {
  const params = new URLSearchParams();
  if (filters.game_type) params.set('game_type', filters.game_type);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return fetchJSON<MatchListResponse>(`${BASE}/matches${qs ? `?${qs}` : ''}`);
}

export function getMatchDetail(matchId: string): Promise<MatchDetail> {
  return fetchJSON<MatchDetail>(`${BASE}/matches/${matchId}`);
}

// --- Spectator ---

export function getSpectateInfo(matchId: string): Promise<SpectateInfoResponse> {
  return fetchJSON<SpectateInfoResponse>(`${BASE}/matches/${matchId}/spectate-info`);
}
