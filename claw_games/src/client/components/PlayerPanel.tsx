import React from 'react';
import type { SpectatorPlayerInfo, MahjongTile as MahjongTileType } from '../types';
import { MahjongTile } from './MahjongTile';

export type PlayerPosition = 'bottom' | 'right' | 'top' | 'left';

export interface PlayerPanelProps {
  player: SpectatorPlayerInfo;
  isActive: boolean;
  position: PlayerPosition;
  playerName: string;
}

function DiscardRiver({ discards }: { discards: MahjongTileType[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-0.5">
      {discards.map((tile, i) => (
        <MahjongTile key={`${tile.suit}-${tile.value}-${i}`} tile={tile} size="sm" />
      ))}
    </div>
  );
}

function ExposedSets({ sets }: { sets: SpectatorPlayerInfo['exposed_sets'] }): React.JSX.Element {
  return (
    <div className="flex gap-2">
      {sets.map((set, si) => (
        <div key={`set-${si}-${set.type}`} className="flex gap-0.5">
          {set.tiles.map((tile, ti) => (
            <MahjongTile key={`${tile.suit}-${tile.value}-${ti}`} tile={tile} size="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}

function HandPlaceholders({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <MahjongTile
          key={`hand-${i}`}
          tile={{ suit: 'bamboo', value: 1 }}
          faceDown
          size="sm"
        />
      ))}
    </div>
  );
}

const POSITION_CONTAINER: Record<PlayerPosition, string> = {
  bottom: 'flex flex-col items-center w-full',
  top: 'flex flex-col items-center w-full',
  left: 'flex flex-col items-center',
  right: 'flex flex-col items-center',
};

export function PlayerPanel({
  player,
  isActive,
  position,
  playerName,
}: PlayerPanelProps): React.JSX.Element {
  const isVertical = position === 'left' || position === 'right';

  return (
    <div
      className={`${POSITION_CONTAINER[position]} rounded-lg border p-3 transition-all ${
        isActive
          ? 'border-claw-gold shadow-[0_0_12px_rgba(245,158,11,0.3)]'
          : 'border-claw-700'
      } ${player.has_won ? 'bg-claw-green/10' : 'bg-claw-800/80'} ${
        player.is_forfeited ? 'opacity-50' : ''
      }`}
    >
      {/* Name and score header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-100 truncate max-w-[120px]">
          {playerName}
        </span>
        <span className="rounded bg-claw-700 px-2 py-0.5 text-xs font-mono text-claw-gold">
          {player.score}
        </span>
        {player.has_won && (
          <span className="rounded-full bg-claw-gold/20 px-2 py-0.5 text-xs font-bold text-claw-gold">
            WIN
          </span>
        )}
        {player.is_forfeited && (
          <span className="rounded-full bg-claw-red/20 px-2 py-0.5 text-xs text-claw-red">
            FORFEIT
          </span>
        )}
      </div>

      {/* Hand tiles (face-down) */}
      <div className={`mb-2 ${isVertical ? 'max-w-[100px]' : ''}`}>
        <HandPlaceholders count={player.hand_count} />
      </div>

      {/* Exposed sets */}
      {player.exposed_sets.length > 0 && (
        <div className="mb-2">
          <ExposedSets sets={player.exposed_sets} />
        </div>
      )}

      {/* Discards */}
      {player.discards.length > 0 && (
        <div className={`${isVertical ? 'max-w-[100px]' : 'max-w-[280px]'}`}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">Discards</p>
          <DiscardRiver discards={player.discards} />
        </div>
      )}
    </div>
  );
}
