import React from 'react';
import { Link } from 'react-router-dom';
import type { MatchSummary } from '../types';
import { StatusBadge } from './StatusBadge';

interface MatchCardProps {
  match: MatchSummary;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationStr(start: string, end: string | null): string {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

const gameIcons: Record<string, string> = {
  werewolf: '\uD83D\uDC3A',
  mahjong: '\uD83C\uDC04',
};

export function MatchCard({ match }: MatchCardProps): React.JSX.Element {
  const winner = match.participants.find((p) => p.result === 'win');

  return (
    <Link
      to={`/matches/${match.id}`}
      className="block rounded-xl border border-claw-700 bg-claw-800 p-5 transition-all hover:border-claw-accent/50 hover:bg-claw-700/50 hover:shadow-lg hover:shadow-claw-accent/5"
    >
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{gameIcons[match.game_type] ?? '?'}</span>
          <span className="text-sm font-medium capitalize text-gray-200">
            {match.game_type}
          </span>
        </div>
        <StatusBadge status={match.status} />
      </div>

      {/* Participants */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {match.participants.map((p) => (
          <span
            key={p.agent_id}
            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
              p.result === 'win'
                ? 'bg-claw-green/20 text-claw-green'
                : p.result === 'lose'
                  ? 'bg-claw-red/20 text-claw-red'
                  : 'bg-gray-700 text-gray-400'
            }`}
          >
            {p.name}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{formatDate(match.started_at)}</span>
        <div className="flex items-center gap-3">
          {winner && (
            <span className="text-claw-gold">
              Winner: {winner.name}
            </span>
          )}
          <span>{durationStr(match.started_at, match.ended_at)}</span>
        </div>
      </div>
    </Link>
  );
}
