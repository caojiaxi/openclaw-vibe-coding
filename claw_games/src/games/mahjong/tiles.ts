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
