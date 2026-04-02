// Sichuan Mahjong scoring
// See DESIGN.md §7.9 for scoring table

export enum ScoringPattern {
  PingHu = 'ping_hu',           // 平胡 — basic win
  AllTriplets = 'all_triplets', // 对对胡
  SevenPairs = 'seven_pairs',   // 七对
  CleanHand = 'clean_hand',     // 清一色
  DragonSevenPairs = 'dragon_seven_pairs', // 龙七对
  GoldenHook = 'golden_hook',   // 金钩钓
  AllConcealed = 'all_concealed', // 门清
}

export const PATTERN_FAN: Record<ScoringPattern, number> = {
  [ScoringPattern.PingHu]: 1,
  [ScoringPattern.AllTriplets]: 2,
  [ScoringPattern.SevenPairs]: 4,
  [ScoringPattern.CleanHand]: 4,
  [ScoringPattern.DragonSevenPairs]: 8,
  [ScoringPattern.GoldenHook]: 4,
  [ScoringPattern.AllConcealed]: 2,
};

export enum BonusFan {
  SelfDraw = 'self_draw',         // 自摸 +1
  KongDraw = 'kong_draw',         // 杠上开花 +1
  RobbingKong = 'robbing_kong',   // 抢杠胡 +1
  LastTile = 'last_tile',         // 海底捞月 +1
}

export const BONUS_FAN_VALUE: Record<BonusFan, number> = {
  [BonusFan.SelfDraw]: 1,
  [BonusFan.KongDraw]: 1,
  [BonusFan.RobbingKong]: 1,
  [BonusFan.LastTile]: 1,
};

/**
 * Calculate points from fan count.
 * Points = base × 2^(total_fan)
 * Capped at maxPoints if provided.
 */
export function calculatePoints(
  totalFan: number,
  base: number = 1,
  maxPoints: number = 256,
): number {
  const points = base * Math.pow(2, totalFan);
  return Math.min(points, maxPoints);
}

/**
 * Sets of patterns that contradict each other and cannot coexist.
 */
const CONTRADICTORY_PATTERNS: ScoringPattern[][] = [
  [ScoringPattern.SevenPairs, ScoringPattern.AllTriplets],
  [ScoringPattern.PingHu, ScoringPattern.AllTriplets],
  [ScoringPattern.PingHu, ScoringPattern.SevenPairs],
  [ScoringPattern.PingHu, ScoringPattern.GoldenHook],
  [ScoringPattern.SevenPairs, ScoringPattern.GoldenHook],
  [ScoringPattern.DragonSevenPairs, ScoringPattern.AllTriplets],
  [ScoringPattern.DragonSevenPairs, ScoringPattern.GoldenHook],
];

/**
 * Patterns implied by other patterns. The key implies the value,
 * so the value should not be counted separately.
 * GoldenHook (金钩钓) implies AllTriplets (对对胡) — don't double-count.
 */
const IMPLIED_PATTERNS: Partial<Record<ScoringPattern, ScoringPattern[]>> = {
  [ScoringPattern.GoldenHook]: [ScoringPattern.AllTriplets],
  [ScoringPattern.DragonSevenPairs]: [ScoringPattern.SevenPairs],
};

export interface ScoreHandResult {
  totalFan: number;
  points: number;
  appliedPatterns: ScoringPattern[];
  appliedBonuses: BonusFan[];
  errors: string[];
}

/**
 * Score a completed hand.
 *
 * @param patterns  Detected scoring patterns for the hand
 * @param bonuses   Bonus fan conditions that apply
 * @param base      Point base multiplier (default 1)
 * @param maxPoints Point cap (default 256)
 * @returns ScoreHandResult with total fan, points, and any validation errors
 */
export function scoreHand(
  patterns: ScoringPattern[],
  bonuses: BonusFan[] = [],
  base: number = 1,
  maxPoints: number = 256,
): ScoreHandResult {
  const errors: string[] = [];
  const uniquePatterns = [...new Set(patterns)];
  const uniqueBonuses = [...new Set(bonuses)];

  // 1. Check for contradictory patterns
  for (const [a, b] of CONTRADICTORY_PATTERNS) {
    if (uniquePatterns.includes(a) && uniquePatterns.includes(b)) {
      errors.push(`Contradictory patterns: ${a} and ${b} cannot coexist`);
    }
  }

  if (errors.length > 0) {
    return { totalFan: 0, points: 0, appliedPatterns: [], appliedBonuses: [], errors };
  }

  // 2. Remove implied/subsumed patterns to avoid double-counting
  const appliedPatterns = uniquePatterns.filter(pattern => {
    // Check if this pattern is implied by another pattern that is present
    for (const [implier, implied] of Object.entries(IMPLIED_PATTERNS)) {
      if (
        implied!.includes(pattern) &&
        uniquePatterns.includes(implier as ScoringPattern) &&
        pattern !== (implier as ScoringPattern)
      ) {
        return false; // Skip: this pattern is already implied
      }
    }
    return true;
  });

  // 3. Sum up fan from patterns
  let totalFan = 0;
  for (const pattern of appliedPatterns) {
    totalFan += PATTERN_FAN[pattern];
  }

  // 4. Sum up bonus fan
  for (const bonus of uniqueBonuses) {
    totalFan += BONUS_FAN_VALUE[bonus];
  }

  // 5. Calculate points
  const points = calculatePoints(totalFan, base, maxPoints);

  return { totalFan, points, appliedPatterns, appliedBonuses: uniqueBonuses, errors: [] };
}

/** Kong payment amounts */
export const KONG_PAYMENTS = {
  exposed: 1,   // 明杠: discarder pays 1 (DESIGN.md §7.7)
  concealed: 2, // 暗杠: each of 3 others pays 2
  added: 1,     // 加杠: each of 3 others pays 1
} as const;
