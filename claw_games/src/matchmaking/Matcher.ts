// Matchmaking matcher — pairs compatible agents from the queue
// See DESIGN.md §9.4 for algorithm details

import { QueueEntry, acceptableRange, hasPriorityBoost } from './Queue';

export interface MatchGroup {
  entries: QueueEntry[];
  game_type: string;
}

/**
 * Calculate the effective acceptable range for an entry, applying
 * priority boost if eligible, then capping at ±500.
 */
function effectiveRange(entry: QueueEntry, now: number): number {
  let range = acceptableRange(entry.enqueued_at, now);
  if (hasPriorityBoost(entry.enqueued_at, now)) {
    range = range * 2;
  }
  // Apply ±500 cap AFTER priority boost multiplication
  return Math.min(range, 500);
}

/**
 * Check if two entries are mutually compatible (both within each other's range).
 */
function arePairwiseCompatible(a: QueueEntry, b: QueueEntry, now: number): boolean {
  const diff = Math.abs(a.rating - b.rating);
  return diff <= effectiveRange(a, now) && diff <= effectiveRange(b, now);
}

/**
 * Check if ALL members of a group are pairwise compatible with each other.
 */
function allPairwiseCompatible(group: QueueEntry[], now: number): boolean {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (!arePairwiseCompatible(group[i], group[j], now)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Calculate the standard deviation of ratings in a group.
 */
function ratingStdDev(group: QueueEntry[]): number {
  const n = group.length;
  if (n <= 1) return 0;
  const mean = group.reduce((sum, e) => sum + e.rating, 0) / n;
  const variance = group.reduce((sum, e) => sum + (e.rating - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/**
 * Find the combination of `size` entries from `candidates` that minimizes
 * rating standard deviation, with all members pairwise compatible.
 *
 * Uses a bounded combinatorial search. For large candidate pools, limits
 * the search space to keep it tractable.
 */
function findBestGroup(
  candidates: QueueEntry[],
  size: number,
  now: number,
): QueueEntry[] | null {
  // For tractability, limit the candidate pool we consider
  const MAX_CANDIDATES = 20;
  const pool = candidates.slice(0, MAX_CANDIDATES);

  if (pool.length < size) return null;

  let bestGroup: QueueEntry[] | null = null;
  let bestStdDev = Infinity;

  // Generate combinations of `size` from `pool`
  const indices = new Array(size);

  function search(start: number, depth: number): void {
    if (depth === size) {
      const group = indices.map((idx: number) => pool[idx]);
      // Verify all pairwise compatibility
      if (!allPairwiseCompatible(group, now)) return;
      const sd = ratingStdDev(group);
      if (sd < bestStdDev) {
        bestStdDev = sd;
        bestGroup = group;
      }
      return;
    }

    for (let i = start; i <= pool.length - (size - depth); i++) {
      indices[depth] = i;
      search(i + 1, depth + 1);
    }
  }

  search(0, 0);
  return bestGroup;
}

export class Matcher {
  private readonly gameSizes: Record<string, number> = {
    werewolf: 8,  // Configurable: 8, 10, or 12
    mahjong: 4,
  };

  /**
   * Attempt to find one or more compatible groups of players from the entries.
   * Returns all match groups found. Matched players are excluded from
   * subsequent group formation within the same call.
   */
  findMatches(entries: QueueEntry[], gameType: string, now: number): MatchGroup[] {
    const requiredSize = this.gameSizes[gameType];
    if (!requiredSize || entries.length < requiredSize) return [];

    const results: MatchGroup[] = [];
    // Track remaining entries — work with copies to avoid mutating input
    let remaining = [...entries];

    while (remaining.length >= requiredSize) {
      // Sort oldest first
      remaining.sort((a, b) => a.enqueued_at - b.enqueued_at);

      let matched = false;

      for (const anchor of remaining) {
        const anchorEffRange = effectiveRange(anchor, now);

        // Find candidates mutually compatible with the anchor
        const compatible = remaining.filter(candidate => {
          if (candidate.agent_id === anchor.agent_id) return true;
          const diff = Math.abs(anchor.rating - candidate.rating);
          const candidateEffRange = effectiveRange(candidate, now);
          return diff <= anchorEffRange && diff <= candidateEffRange;
        });

        if (compatible.length < requiredSize) continue;

        // Find the best group minimizing rating std-dev with full pairwise checks
        const bestGroup = findBestGroup(compatible, requiredSize, now);

        if (bestGroup) {
          results.push({ entries: bestGroup, game_type: gameType });
          // Remove matched players from the remaining pool
          const matchedIds = new Set(bestGroup.map(e => e.agent_id));
          remaining = remaining.filter(e => !matchedIds.has(e.agent_id));
          matched = true;
          break; // Restart the outer loop with updated remaining
        }
      }

      // If no anchor yielded a match this pass, stop
      if (!matched) break;
    }

    return results;
  }

  /**
   * Attempt to find a single compatible group of players from the queue.
   * Returns null if no valid group can be formed.
   */
  findMatch(entries: QueueEntry[], gameType: string, now: number): MatchGroup | null {
    const matches = this.findMatches(entries, gameType, now);
    return matches.length > 0 ? matches[0] : null;
  }
}
