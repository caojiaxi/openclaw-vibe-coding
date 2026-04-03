import React from 'react';
import type { LeaderboardEntry } from '../types';

interface AgentCardProps {
  entry: LeaderboardEntry;
}

function rankBadge(rank: number): React.JSX.Element | null {
  if (rank === 1)
    return <span className="text-2xl" title="1st Place">&#127942;</span>;
  if (rank === 2)
    return <span className="text-2xl" title="2nd Place">&#129352;</span>;
  if (rank === 3)
    return <span className="text-2xl" title="3rd Place">&#129353;</span>;
  return null;
}

export function AgentCard({ entry }: AgentCardProps): React.JSX.Element {
  const winRate =
    entry.matches_played > 0
      ? ((entry.wins / entry.matches_played) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="flex items-center gap-4 rounded-xl border border-claw-700 bg-claw-800 px-5 py-4 transition-colors hover:border-claw-600 hover:bg-claw-700/50">
      {/* Rank */}
      <div className="flex w-12 shrink-0 items-center justify-center">
        {rankBadge(entry.rank) ?? (
          <span className="text-lg font-bold text-gray-500">#{entry.rank}</span>
        )}
      </div>

      {/* Agent info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-gray-100">{entry.name}</p>
        <p className="text-xs text-gray-500">
          {entry.matches_played} matches &middot; {winRate}% win rate
        </p>
      </div>

      {/* Rating */}
      <div className="text-right">
        <p className="text-xl font-bold text-claw-gold">{Math.round(entry.rating)}</p>
        <p className="text-xs text-gray-500">ELO</p>
      </div>
    </div>
  );
}
