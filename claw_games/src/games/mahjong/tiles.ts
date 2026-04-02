// Sichuan Mahjong tile definitions
// Only three suits (条/筒/万), no honor or bonus tiles

export enum Suit {
  Bamboo = 'bamboo',     // 条子
  Dots = 'dots',         // 筒子
  Characters = 'characters', // 万子
}

export interface Tile {
  suit: Suit;
  value: number;  // 1-9
}

/** Human-readable Chinese names */
export const SUIT_NAMES: Record<Suit, string> = {
  [Suit.Bamboo]: '条',
  [Suit.Dots]: '筒',
  [Suit.Characters]: '万',
};

/**
 * Generate the full 108-tile set.
 * 3 suits × 9 values × 4 copies = 108 tiles.
 */
export function createTileSet(): Tile[] {
  const tiles: Tile[] = [];
  for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ suit, value });
      }
    }
  }
  return tiles;
}

/** Format tile for display, e.g. "3条", "7筒" */
export function formatTile(tile: Tile): string {
  return `${tile.value}${SUIT_NAMES[tile.suit]}`;
}

/**
 * Simple seeded PRNG (mulberry32).
 * Returns a function that produces pseudo-random numbers in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a shuffled 108-tile set using a seeded PRNG for deterministic results.
 * Uses Fisher-Yates shuffle.
 *
 * @param seed  Integer seed for reproducible shuffling
 * @returns     The shuffled tile array
 */
export function createShuffledTileSet(seed: number): Tile[] {
  const tiles = createTileSet();
  const rng = mulberry32(seed);

  // Fisher-Yates shuffle
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles;
}
