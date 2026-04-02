// Matchmaking queue
// See DESIGN.md §9 for algorithm details

export interface QueueEntry {
  agent_id: string;
  game_type: 'werewolf' | 'mahjong';
  rating: number;
  enqueued_at: number; // Timestamp in ms
}

/**
 * Calculate the acceptable rating range for a queue entry.
 * Starts at ±50 and expands by 10 every 10 seconds.
 * Capped at ±500.
 */
export function acceptableRange(enqueuedAt: number, now: number): number {
  const waitSeconds = Math.floor((now - enqueuedAt) / 1000);
  const range = 50 + 10 * Math.floor(waitSeconds / 10);
  return Math.min(range, 500);
}

/**
 * Check if the entry qualifies for priority boost (>90s in queue).
 */
export function hasPriorityBoost(enqueuedAt: number, now: number): boolean {
  return (now - enqueuedAt) > 90_000;
}

export class Queue {
  private entries: QueueEntry[] = [];

  enqueue(entry: QueueEntry): void {
    // Remove existing entry for same agent (can only be in one queue)
    this.entries = this.entries.filter(e => e.agent_id !== entry.agent_id);
    this.entries.push(entry);
  }

  dequeue(agentId: string): void {
    this.entries = this.entries.filter(e => e.agent_id !== agentId);
  }

  getEntries(gameType: string): QueueEntry[] {
    return this.entries
      .filter(e => e.game_type === gameType)
      .sort((a, b) => a.enqueued_at - b.enqueued_at);
  }

  size(gameType: string): number {
    return this.entries.filter(e => e.game_type === gameType).length;
  }
}
