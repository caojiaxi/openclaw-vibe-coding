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

/** Kong payment amounts */
export const KONG_PAYMENTS = {
  exposed: 1,   // 明杠: discarder pays 1
  concealed: 2, // 暗杠: each of 3 others pays 2
  added: 1,     // 加杠: each of 3 others pays 1
} as const;
