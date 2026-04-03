import React from 'react';
import type { GameType } from '../types';

interface GameTypeSelectorProps {
  value: GameType;
  onChange: (gameType: GameType) => void;
}

const gameTypes: { value: GameType; label: string; icon: string }[] = [
  { value: 'werewolf', label: 'Werewolf', icon: '\uD83D\uDC3A' },
  { value: 'mahjong', label: 'Mahjong', icon: '\uD83C\uDC04' },
];

export function GameTypeSelector({ value, onChange }: GameTypeSelectorProps): React.JSX.Element {
  return (
    <div className="flex gap-2">
      {gameTypes.map((gt) => (
        <button
          key={gt.value}
          onClick={() => onChange(gt.value)}
          className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
            value === gt.value
              ? 'bg-claw-accent text-white shadow-lg shadow-claw-accent/25'
              : 'bg-claw-700 text-gray-400 hover:bg-claw-600 hover:text-gray-200'
          }`}
        >
          <span className="text-lg">{gt.icon}</span>
          {gt.label}
        </button>
      ))}
    </div>
  );
}
