import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getMatchDetail } from '../api';
import { StatusBadge, LoadingSpinner, ErrorMessage } from '../components';
import type { MatchDetail, MatchParticipant } from '../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function durationStr(start: string, end: string | null): string {
  if (!end) return 'Ongoing';
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

function resultColorClass(result: string): string {
  switch (result) {
    case 'win':
      return 'text-claw-green';
    case 'lose':
      return 'text-claw-red';
    default:
      return 'text-gray-400';
  }
}

function ParticipantRow({ p }: { p: MatchParticipant }): React.JSX.Element {
  const ratingChange =
    p.rating_after != null && p.rating_before != null
      ? p.rating_after - p.rating_before
      : null;

  return (
    <tr className="border-t border-claw-700">
      <td className="px-4 py-3 text-center text-sm text-gray-400">{p.seat + 1}</td>
      <td className="px-4 py-3 text-sm font-medium text-gray-100">{p.name}</td>
      <td className="px-4 py-3 text-sm text-gray-400">{p.role ?? '-'}</td>
      <td className={`px-4 py-3 text-sm font-semibold capitalize ${resultColorClass(p.result)}`}>
        {p.result}
      </td>
      <td className="px-4 py-3 text-right text-sm text-gray-400">
        {p.rating_before != null ? Math.round(p.rating_before) : '-'}
      </td>
      <td className="px-4 py-3 text-right text-sm">
        {ratingChange != null ? (
          <span
            className={
              ratingChange > 0
                ? 'text-claw-green'
                : ratingChange < 0
                  ? 'text-claw-red'
                  : 'text-gray-400'
            }
          >
            {ratingChange > 0 ? '+' : ''}
            {ratingChange.toFixed(1)}
          </span>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
    </tr>
  );
}

export function MatchDetailPage(): React.JSX.Element {
  const { matchId } = useParams<{ matchId: string }>();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!matchId) {
      setLoading(false);
      setError('Match ID is missing');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getMatchDetail(matchId);
      setMatch(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load match');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="mx-auto max-w-4xl px-4 py-8"><ErrorMessage message={error} onRetry={fetchData} /></div>;
  if (!match) return <div className="py-20 text-center text-gray-500">Match not found</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Back link */}
      <Link
        to="/matches"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-300"
      >
        &larr; Back to matches
      </Link>

      {/* Match header card */}
      <div className="mb-8 rounded-xl border border-claw-700 bg-claw-800 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-2xl">{gameIcons[match.game_type] ?? '?'}</span>
          <h1 className="text-2xl font-bold capitalize text-gray-100">{match.game_type} Match</h1>
          <StatusBadge status={match.status} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Started</p>
            <p className="text-sm text-gray-300">{formatDate(match.started_at)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Duration</p>
            <p className="text-sm text-gray-300">
              {durationStr(match.started_at, match.ended_at)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Match ID</p>
            <p className="truncate font-mono text-xs text-gray-500">{match.id}</p>
          </div>
        </div>
      </div>

      {/* Watch Live button */}
      {match.status === 'in_progress' && (
        <div className="mb-8">
          <Link
            to={`/matches/${match.id}/spectate`}
            className="inline-flex items-center gap-2 rounded-lg bg-claw-accent px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:brightness-110"
            aria-label={`Watch live ${match.game_type} match ${match.id}`}
          >
            👁️ Watch Live
          </Link>
        </div>
      )}

      {/* Replay button */}
      {match.status !== 'in_progress' && (
        <div className="mb-8">
          <Link
            to={`/matches/${match.id}/replay`}
            className="inline-flex items-center gap-2 rounded-lg bg-claw-accent px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:brightness-110"
            aria-label={`Watch replay of ${match.game_type} match ${match.id}`}
          >
            🔄 Replay
          </Link>
        </div>
      )}

      {/* Participants table */}
      <div className="overflow-hidden rounded-xl border border-claw-700 bg-claw-800">
        <div className="border-b border-claw-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-100">Participants</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 text-center">Seat</th>
                <th className="px-4 py-3 text-left">Agent</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Result</th>
                <th className="px-4 py-3 text-right">Rating</th>
                <th className="px-4 py-3 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {match.participants.map((p) => (
                <ParticipantRow key={p.agent_id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
