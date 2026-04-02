// Matchmaking matcher — pairs compatible agents from the queue
// See DESIGN.md §9.4 for algorithm details
// TODO: Implement full matching logic

import { QueueEntry, acceptableRange, hasPriorityBoost } from './Queue';

export interface MatchGroup {
  entries: QueueEntry[];
  game_type: string;
}

export class Matcher {
  private readonly gameSizes: Record<string, number> = {
    werewolf: 8,  // Configurable: 8, 10, or 12
    mahjong: 4,
  };

  /**
   * Attempt to find a compatible group of players from the queue.
   * Returns null if no valid group can be formed.
   */
  findMatch(entries: QueueEntry[], gameType: string, now: number): MatchGroup | null {
    const requiredSize = this.gameSizes[gameType];
    if (!requiredSize || entries.length < requiredSize) return null;

    // Sort oldest first
    const sorted = [...entries].sort((a, b) => a.enqueued_at - b.enqueued_at);

    for (const anchor of sorted) {
      const anchorRange = hasPriorityBoost(anchor.enqueued_at, now)
        ? acceptableRange(anchor.enqueued_at, now) * 2
        : acceptableRange(anchor.enqueued_at, now);

      // Find mutually compatible candidates
      const compatible = sorted.filter(candidate => {
        if (candidate.agent_id === anchor.agent_id) return true;
        const candidateRange = hasPriorityBoost(candidate.enqueued_at, now)
          ? acceptableRange(candidate.enqueued_at, now) * 2
          : acceptableRange(candidate.enqueued_at, now);

        return (
          Math.abs(anchor.rating - candidate.rating) <= anchorRange &&
          Math.abs(anchor.rating - candidate.rating) <= candidateRange
        );
      });

      if (compatible.length >= requiredSize) {
        // Select the group that minimizes rating standard deviation
        const group = compatible.slice(0, requiredSize);
        return { entries: group, game_type: gameType };
      }
    }

    return null;
  }
}
