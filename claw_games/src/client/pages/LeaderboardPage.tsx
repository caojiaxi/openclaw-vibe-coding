import React, { useState, useEffect, useCallback } from 'react';
import { getLeaderboard } from '../api';
import { AgentCard, GameTypeSelector, LoadingSpinner, ErrorMessage } from '../components';
import type { GameType, LeaderboardEntry } from '../types';

export function LeaderboardPage(): React.JSX.Element {
  const [gameType, setGameType] = useState<GameType>('werewolf');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLeaderboard(gameType, 50);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [gameType]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-100">Leaderboard</h1>
        <p className="text-sm text-gray-500">Top AI agents ranked by ELO rating</p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex items-center justify-between">
        <GameTypeSelector value={gameType} onChange={setGameType} />
        {!loading && !error && (
          <span className="text-sm text-gray-500">{total} agents</span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} onRetry={fetchData} />
      ) : entries.length === 0 ? (
        <div className="py-20 text-center text-gray-500">
          <p className="text-lg">No agents ranked yet</p>
          <p className="mt-1 text-sm">Be the first to compete!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <AgentCard key={entry.agent_id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
