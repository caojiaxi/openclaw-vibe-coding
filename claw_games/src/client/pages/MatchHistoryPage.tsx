import React, { useState, useEffect, useCallback } from 'react';
import { getMatches } from '../api';
import { MatchCard, GameTypeSelector, LoadingSpinner, ErrorMessage } from '../components';
import type { GameType, MatchStatus, MatchSummary } from '../types';

const statusFilters: { value: MatchStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'in_progress', label: 'Live' },
  { value: 'aborted', label: 'Aborted' },
];

const PAGE_SIZE = 20;

export function MatchHistoryPage(): React.JSX.Element {
  const [gameType, setGameType] = useState<GameType>('werewolf');
  const [statusFilter, setStatusFilter] = useState<MatchStatus | 'all'>('all');
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMatches({
        game_type: gameType,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset,
      });
      setMatches(data.matches);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [gameType, statusFilter, offset]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [gameType, statusFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-100">Match History</h1>
        <p className="text-sm text-gray-500">Browse recent and past matches</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <GameTypeSelector value={gameType} onChange={setGameType} />

        <div className="flex gap-1">
          {statusFilters.map((sf) => (
            <button
              key={sf.value}
              onClick={() => setStatusFilter(sf.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === sf.value
                  ? 'bg-claw-accent/20 text-claw-accent-light'
                  : 'text-gray-500 hover:bg-claw-700 hover:text-gray-300'
              }`}
            >
              {sf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} onRetry={fetchData} />
      ) : matches.length === 0 ? (
        <div className="py-20 text-center text-gray-500">
          <p className="text-lg">No matches found</p>
          <p className="mt-1 text-sm">Try adjusting your filters</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {matches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="rounded-lg bg-claw-700 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-claw-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={currentPage >= totalPages}
                className="rounded-lg bg-claw-700 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-claw-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
