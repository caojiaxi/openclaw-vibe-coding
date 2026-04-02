// ELO rating calculation
// See DESIGN.md §8 for algorithm details

/**
 * Calculate expected score for player A against player B.
 * E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Determine K-factor based on matches played and current rating.
 * - 0-30 matches: K=40 (high volatility)
 * - 31-100 matches: K=24 (moderate)
 * - 101+ matches: K=16 (stable)
 * - Rating > 2400: K capped at 10
 */
export function kFactor(matchesPlayed: number, rating: number): number {
  if (rating > 2400) return 10;
  if (matchesPlayed <= 30) return 40;
  if (matchesPlayed <= 100) return 24;
  return 16;
}

/**
 * Calculate new rating after a two-player match.
 */
export function updateRating(
  rating: number,
  opponentRating: number,
  actualScore: number, // 1 = win, 0 = loss, 0.5 = draw
  matchesPlayed: number,
): number {
  const K = kFactor(matchesPlayed, rating);
  const E = expectedScore(rating, opponentRating);
  const newRating = rating + K * (actualScore - E);
  return Math.max(100, newRating); // Floor at 100
}

/**
 * Multi-player ELO update using pairwise decomposition.
 * Each player is considered to have played (N-1) virtual matches
 * against every other player.
 *
 * @param players Array of { rating, matchesPlayed, actualScore }
 *   actualScore: 1.0 for winner, 0.0 for loser, proportional for middle ranks
 * @returns Array of new ratings in the same order
 */
export function updateRatingsMultiplayer(
  players: Array<{
    rating: number;
    matchesPlayed: number;
    actualScore: number;
  }>,
): number[] {
  const N = players.length;

  return players.map((player, i) => {
    const K = kFactor(player.matchesPlayed, player.rating);
    let ratingDelta = 0;

    for (let j = 0; j < N; j++) {
      if (i === j) continue;

      const Eij = expectedScore(player.rating, players[j].rating);
      // Pairwise actual score
      let Sij: number;
      if (player.actualScore > players[j].actualScore) {
        Sij = 1;
      } else if (player.actualScore < players[j].actualScore) {
        Sij = 0;
      } else {
        Sij = 0.5;
      }

      ratingDelta += (K / (N - 1)) * (Sij - Eij);
    }

    return Math.max(100, player.rating + ratingDelta);
  });
}

export const INITIAL_RATING = 1500;
export const RATING_FLOOR = 100;
