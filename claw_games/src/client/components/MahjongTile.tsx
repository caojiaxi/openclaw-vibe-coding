import React from 'react';
import type { MahjongTile as MahjongTileType, MahjongSuit } from '../types';

export type TileSize = 'sm' | 'md' | 'lg';

export interface MahjongTileProps {
  tile: MahjongTileType;
  faceDown?: boolean;
  size?: TileSize;
  highlighted?: boolean;
}

const SUIT_CHARS: Record<MahjongSuit, string> = {
  bamboo: '\u6761',
  dots: '\u7B52',
  characters: '\u4E07',
};

const SUIT_COLORS: Record<MahjongSuit, string> = {
  bamboo: 'text-green-400',
  dots: 'text-blue-400',
  characters: 'text-red-400',
};

const SIZE_CLASSES: Record<TileSize, string> = {
  sm: 'w-7 h-10 text-xs',
  md: 'w-9 h-12 text-sm',
  lg: 'w-11 h-14 text-base',
};

export function MahjongTile({
  tile,
  faceDown = false,
  size = 'md',
  highlighted = false,
}: MahjongTileProps): React.JSX.Element {
  const sizeClass = SIZE_CLASSES[size];

  if (faceDown) {
    return (
      <div
        className={`${sizeClass} inline-flex flex-shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-700 shadow-sm`}
      >
        <div className="h-3/4 w-3/4 rounded-sm bg-gray-600" />
      </div>
    );
  }

  const colorClass = SUIT_COLORS[tile.suit] ?? 'text-gray-400';
  const label = `${tile.value}${SUIT_CHARS[tile.suit] ?? '?'}`;

  return (
    <div
      className={`${sizeClass} inline-flex flex-shrink-0 flex-col items-center justify-center rounded border bg-gray-100 shadow-sm transition-all ${
        highlighted
          ? 'border-claw-gold ring-2 ring-claw-gold/50'
          : 'border-gray-300'
      }`}
    >
      <span className={`font-bold leading-none ${colorClass}`}>{label}</span>
    </div>
  );
}
