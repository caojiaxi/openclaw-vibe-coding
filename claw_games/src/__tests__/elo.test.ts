import { describe, it, expect } from 'vitest';
import {
  expectedScore,
  kFactor,
  updateRating,
  updateRatingsMultiplayer,
  INITIAL_RATING,
  RATING_FLOOR,
} from '../ratings/elo.js';

// ─── expectedScore ──────────────────────────────────────────────────────────

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    const score = expectedScore(1500, 1500);
    expect(score).toBeCloseTo(0.5, 10);
  });

  it('returns ~0.76 when A is 200 points above B', () => {
    const score = expectedScore(1700, 1500);
    // E = 1 / (1 + 10^(-200/400)) = 1 / (1 + 10^-0.5) ≈ 0.7597
    expect(score).toBeCloseTo(0.7597, 3);
  });

  it('returns ~0.24 when A is 200 points below B', () => {
    const score = expectedScore(1300, 1500);
    expect(score).toBeCloseTo(0.2403, 3);
  });

  it('expected scores of A vs B and B vs A sum to 1', () => {
    const e1 = expectedScore(1800, 1200);
    const e2 = expectedScore(1200, 1800);
    expect(e1 + e2).toBeCloseTo(1.0, 10);
  });

  it('returns near 1.0 for very large rating difference', () => {
    const score = expectedScore(2500, 500);
    expect(score).toBeGreaterThan(0.99);
  });

  it('returns near 0.0 for very low rating vs high', () => {
    const score = expectedScore(500, 2500);
    expect(score).toBeLessThan(0.01);
  });
});

// ─── kFactor ────────────────────────────────────────────────────────────────

describe('kFactor', () => {
  it('returns K=40 for 0-30 matches (high volatility)', () => {
    expect(kFactor(0, 1500)).toBe(40);
    expect(kFactor(1, 1500)).toBe(40);
    expect(kFactor(15, 1500)).toBe(40);
    expect(kFactor(30, 1500)).toBe(40);
  });

  it('returns K=24 for 31-100 matches (moderate)', () => {
    expect(kFactor(31, 1500)).toBe(24);
    expect(kFactor(50, 1500)).toBe(24);
    expect(kFactor(100, 1500)).toBe(24);
  });

  it('returns K=16 for 101+ matches (stable)', () => {
    expect(kFactor(101, 1500)).toBe(16);
    expect(kFactor(200, 1500)).toBe(16);
    expect(kFactor(1000, 1500)).toBe(16);
  });

  it('caps K=10 when rating > 2400 regardless of match count', () => {
    // Even with 0 matches, rating > 2400 caps at 10
    expect(kFactor(0, 2401)).toBe(10);
    expect(kFactor(10, 2500)).toBe(10);
    expect(kFactor(50, 2600)).toBe(10);
    expect(kFactor(200, 3000)).toBe(10);
  });

  it('does NOT cap at K=10 for rating exactly 2400', () => {
    // 2400 is NOT > 2400, so normal rules apply
    expect(kFactor(0, 2400)).toBe(40);
    expect(kFactor(50, 2400)).toBe(24);
    expect(kFactor(150, 2400)).toBe(16);
  });
});

// ─── updateRating ───────────────────────────────────────────────────────────

describe('updateRating', () => {
  it('increases rating on win against equal opponent', () => {
    const newRating = updateRating(1500, 1500, 1, 50);
    // K=24, E=0.5, delta = 24*(1-0.5) = 12
    expect(newRating).toBeCloseTo(1512, 0);
  });

  it('decreases rating on loss against equal opponent', () => {
    const newRating = updateRating(1500, 1500, 0, 50);
    // K=24, E=0.5, delta = 24*(0-0.5) = -12
    expect(newRating).toBeCloseTo(1488, 0);
  });

  it('keeps rating unchanged on draw against equal opponent', () => {
    const newRating = updateRating(1500, 1500, 0.5, 50);
    expect(newRating).toBeCloseTo(1500, 0);
  });

  it('gains less from beating a much weaker opponent', () => {
    const gain = updateRating(2000, 1200, 1, 50) - 2000;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(5); // Expected is close to 1.0, so delta is small
  });

  it('gains more from beating a stronger opponent', () => {
    const gain = updateRating(1200, 2000, 1, 50) - 1200;
    expect(gain).toBeGreaterThan(20); // Expected was very low, so actual - expected is large
  });

  it('uses higher K for fewer matches', () => {
    const gain10 = updateRating(1500, 1500, 1, 10) - 1500; // K=40
    const gain50 = updateRating(1500, 1500, 1, 50) - 1500; // K=24
    const gain150 = updateRating(1500, 1500, 1, 150) - 1500; // K=16
    expect(gain10).toBeGreaterThan(gain50);
    expect(gain50).toBeGreaterThan(gain150);
  });

  it('enforces rating floor at 100', () => {
    // Massive loss should not go below 100
    const newRating = updateRating(100, 2500, 0, 0);
    expect(newRating).toBe(100);
  });

  it('returns at least 100 even with extreme inputs', () => {
    const newRating = updateRating(100, 3000, 0, 0);
    expect(newRating).toBeGreaterThanOrEqual(100);
  });

  it('win and loss against equal opponent are symmetric', () => {
    const winRating = updateRating(1500, 1500, 1, 50);
    const lossRating = updateRating(1500, 1500, 0, 50);
    expect(winRating - 1500).toBeCloseTo(1500 - lossRating, 5);
  });
});

// ─── updateRatingsMultiplayer ───────────────────────────────────────────────

describe('updateRatingsMultiplayer', () => {
  it('returns unchanged ratings for fewer than 2 players', () => {
    const result = updateRatingsMultiplayer([
      { rating: 1500, matchesPlayed: 10, actualScore: 1 },
    ]);
    expect(result).toEqual([1500]);
  });

  it('winner gains and loser loses in a 2-player game', () => {
    const result = updateRatingsMultiplayer([
      { rating: 1500, matchesPlayed: 50, actualScore: 1 },
      { rating: 1500, matchesPlayed: 50, actualScore: 0 },
    ]);
    expect(result[0]).toBeGreaterThan(1500);
    expect(result[1]).toBeLessThan(1500);
  });

  it('2-player multiplayer matches single updateRating', () => {
    const mp = updateRatingsMultiplayer([
      { rating: 1500, matchesPlayed: 50, actualScore: 1 },
      { rating: 1500, matchesPlayed: 50, actualScore: 0 },
    ]);
    const sp = updateRating(1500, 1500, 1, 50);
    // With 2 players, N-1=1, so K/(N-1) = K and it should match single-player exactly
    expect(mp[0]).toBeCloseTo(sp, 5);
  });

  it('handles 4-player Mahjong scenario', () => {
    const result = updateRatingsMultiplayer([
      { rating: 1500, matchesPlayed: 50, actualScore: 1.0 },   // Winner
      { rating: 1500, matchesPlayed: 50, actualScore: 0.66 },  // Second place
      { rating: 1500, matchesPlayed: 50, actualScore: 0.33 },  // Third
      { rating: 1500, matchesPlayed: 50, actualScore: 0.0 },   // Last
    ]);
    // Winner should gain the most, last place should lose the most
    expect(result[0]).toBeGreaterThan(result[1]);
    expect(result[1]).toBeGreaterThan(result[2]);
    expect(result[2]).toBeGreaterThan(result[3]);
  });

  it('ratings are approximately zero-sum for equal-rated players', () => {
    const players = [
      { rating: 1500, matchesPlayed: 50, actualScore: 1.0 },
      { rating: 1500, matchesPlayed: 50, actualScore: 0.66 },
      { rating: 1500, matchesPlayed: 50, actualScore: 0.33 },
      { rating: 1500, matchesPlayed: 50, actualScore: 0.0 },
    ];
    const result = updateRatingsMultiplayer(players);
    const totalBefore = players.reduce((s, p) => s + p.rating, 0);
    const totalAfter = result.reduce((s, r) => s + r, 0);
    // Should be approximately zero-sum (slight deviation due to floor)
    expect(totalAfter).toBeCloseTo(totalBefore, 0);
  });

  it('enforces rating floor at 100 in multiplayer', () => {
    const result = updateRatingsMultiplayer([
      { rating: 100, matchesPlayed: 5, actualScore: 0 },
      { rating: 2500, matchesPlayed: 5, actualScore: 1 },
      { rating: 2500, matchesPlayed: 5, actualScore: 1 },
    ]);
    expect(result[0]).toBeGreaterThanOrEqual(100);
  });

  it('handles 8-player Werewolf scenario', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({
      rating: 1400 + i * 50,
      matchesPlayed: 50,
      actualScore: i < 4 ? 1 : 0, // first 4 win, last 4 lose
    }));
    const result = updateRatingsMultiplayer(players);
    expect(result).toHaveLength(8);
    // Winners should generally gain, losers should generally lose
    for (let i = 0; i < 4; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(players[i].rating);
    }
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('constants', () => {
  it('INITIAL_RATING is 1500', () => {
    expect(INITIAL_RATING).toBe(1500);
  });

  it('RATING_FLOOR is 100', () => {
    expect(RATING_FLOOR).toBe(100);
  });
});
