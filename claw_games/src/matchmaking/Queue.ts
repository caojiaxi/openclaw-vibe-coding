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
  /** Version counter incremented on every mutation, used to detect concurrent modifications. */
  private _version: number = 0;

  /** Current version — callers can snapshot this before reads and compare after to detect races. */
  get version(): number {
    return this._version;
  }

  enqueue(entry: QueueEntry): void {
    // Remove existing entry for same agent (can only be in one queue)
    this.entries = this.entries.filter(e => e.agent_id !== entry.agent_id);
    this.entries.push({ ...entry }); // Store a copy
    this._version++;
  }

  /**
   * Remove a single agent from the queue.
   * (Renamed from `dequeue` for clarity.)
   */
  removeAgent(agentId: string): void {
    this.entries = this.entries.filter(e => e.agent_id !== agentId);
    this._version++;
  }

  /**
   * Atomically remove multiple agents from the queue in a single pass.
   * Returns the number of agents actually removed.
   */
  removeMany(agentIds: string[]): number {
    const idSet = new Set(agentIds);
    const before = this.entries.length;
    this.entries = this.entries.filter(e => !idSet.has(e.agent_id));
    const removed = before - this.entries.length;
    if (removed > 0) {
      this._version++;
    }
    return removed;
  }

  /**
   * Return a defensive copy of entries for the given game type,
   * sorted oldest-first. Callers receive copies, not references.
   */
  getEntries(gameType: string): QueueEntry[] {
    return this.entries
      .filter(e => e.game_type === gameType)
      .sort((a, b) => a.enqueued_at - b.enqueued_at)
      .map(e => ({ ...e })); // Return copies, not references
  }

  size(gameType: string): number {
    return this.entries.filter(e => e.game_type === gameType).length;
  }
}
