import { describe, it, expect, beforeEach } from 'vitest';
import {
  initializeDatabase,
  AgentDAO,
  AgentRatingDAO,
  MatchDAO,
} from '../server/db/index.js';

// Fresh in-memory database before every test
beforeEach(() => {
  initializeDatabase(':memory:');
});

// ─── AgentDAO ────────────────────────────────────────────────────────────────

describe('AgentDAO', () => {
  it('create returns an agent with the given name', () => {
    const agent = AgentDAO.create('alice', 'secret123');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('alice');
    expect(agent.id).toBeTruthy();
    expect(agent.secret_hash).not.toBe('secret123'); // hashed
    expect(agent.created_at).toBeTruthy();
    expect(agent.updated_at).toBeTruthy();
  });

  it('create rejects duplicate names', () => {
    AgentDAO.create('bob', 'pw1');
    expect(() => AgentDAO.create('bob', 'pw2')).toThrow();
  });

  it('getById retrieves the correct agent', () => {
    const created = AgentDAO.create('carol', 'pw');
    const fetched = AgentDAO.getById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('carol');
  });

  it('getById returns undefined for unknown id', () => {
    expect(AgentDAO.getById('nonexistent')).toBeUndefined();
  });

  it('getByName retrieves the correct agent', () => {
    AgentDAO.create('dave', 'pw');
    const fetched = AgentDAO.getByName('dave');
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('dave');
  });

  it('getByName returns undefined for unknown name', () => {
    expect(AgentDAO.getByName('nobody')).toBeUndefined();
  });

  it('verifySecret returns true for correct secret', () => {
    const agent = AgentDAO.create('eve', 'correct-pw');
    expect(AgentDAO.verifySecret(agent, 'correct-pw')).toBe(true);
  });

  it('verifySecret returns false for wrong secret', () => {
    const agent = AgentDAO.create('frank', 'real-pw');
    expect(AgentDAO.verifySecret(agent, 'wrong-pw')).toBe(false);
  });
});

// ─── AgentRatingDAO ──────────────────────────────────────────────────────────

describe('AgentRatingDAO', () => {
  it('ensureRating creates a default 1500 rating', () => {
    const agent = AgentDAO.create('rater', 'pw');
    const rating = AgentRatingDAO.ensureRating(agent.id, 'mahjong');
    expect(rating.agent_id).toBe(agent.id);
    expect(rating.game_type).toBe('mahjong');
    expect(rating.rating).toBe(1500);
    expect(rating.matches_played).toBe(0);
    expect(rating.wins).toBe(0);
    expect(rating.losses).toBe(0);
    expect(rating.draws).toBe(0);
    expect(rating.peak_rating).toBe(1500);
  });

  it('ensureRating is idempotent', () => {
    const agent = AgentDAO.create('idem', 'pw');
    const r1 = AgentRatingDAO.ensureRating(agent.id, 'werewolf');
    const r2 = AgentRatingDAO.ensureRating(agent.id, 'werewolf');
    expect(r1).toEqual(r2);
  });

  it('update modifies rating fields', () => {
    const agent = AgentDAO.create('updater', 'pw');
    AgentRatingDAO.ensureRating(agent.id, 'mahjong');
    const updated = AgentRatingDAO.update(agent.id, 'mahjong', {
      rating: 1620,
      matches_played: 5,
      wins: 3,
      losses: 2,
      peak_rating: 1620,
    });
    expect(updated).toBeDefined();
    expect(updated!.rating).toBe(1620);
    expect(updated!.matches_played).toBe(5);
    expect(updated!.wins).toBe(3);
    expect(updated!.losses).toBe(2);
    expect(updated!.peak_rating).toBe(1620);
  });

  it('getTopByGame returns agents ordered by rating descending', () => {
    const a1 = AgentDAO.create('low', 'pw');
    const a2 = AgentDAO.create('mid', 'pw');
    const a3 = AgentDAO.create('high', 'pw');

    AgentRatingDAO.ensureRating(a1.id, 'mahjong');
    AgentRatingDAO.ensureRating(a2.id, 'mahjong');
    AgentRatingDAO.ensureRating(a3.id, 'mahjong');

    AgentRatingDAO.update(a1.id, 'mahjong', { rating: 1400 });
    AgentRatingDAO.update(a2.id, 'mahjong', { rating: 1600 });
    AgentRatingDAO.update(a3.id, 'mahjong', { rating: 1800 });

    const top = AgentRatingDAO.getTopByGame('mahjong');
    expect(top).toHaveLength(3);
    expect(top[0].name).toBe('high');
    expect(top[0].rating).toBe(1800);
    expect(top[1].name).toBe('mid');
    expect(top[2].name).toBe('low');
  });

  it('getTopByGame respects limit and offset', () => {
    const agents = Array.from({ length: 5 }, (_, i) => AgentDAO.create(`p${i}`, 'pw'));
    agents.forEach((a, i) => {
      AgentRatingDAO.ensureRating(a.id, 'werewolf');
      AgentRatingDAO.update(a.id, 'werewolf', { rating: 1500 + i * 100 });
    });

    const page = AgentRatingDAO.getTopByGame('werewolf', 2, 1);
    expect(page).toHaveLength(2);
    // Highest is p4 (1900), so offset=1 gives p3 (1800) and p2 (1700)
    expect(page[0].name).toBe('p3');
    expect(page[1].name).toBe('p2');
  });
});

// ─── MatchDAO ────────────────────────────────────────────────────────────────

describe('MatchDAO', () => {
  it('create returns a match with correct defaults', () => {
    const match = MatchDAO.create('mahjong', 42);
    expect(match).toBeDefined();
    expect(match.id).toBeTruthy();
    expect(match.game_type).toBe('mahjong');
    expect(match.seed).toBe(42);
    expect(match.status).toBe('in_progress');
    expect(match.started_at).toBeTruthy();
    expect(match.ended_at).toBeNull();
    expect(match.result_summary).toBeNull();
  });

  it('list returns matches filtered by game_type', () => {
    MatchDAO.create('mahjong', 1);
    MatchDAO.create('werewolf', 2);
    MatchDAO.create('mahjong', 3);

    const mahjongMatches = MatchDAO.list({ game_type: 'mahjong' });
    expect(mahjongMatches).toHaveLength(2);
    mahjongMatches.forEach((m) => expect(m.game_type).toBe('mahjong'));
  });

  it('list returns matches filtered by status', () => {
    const m1 = MatchDAO.create('mahjong', 1);
    MatchDAO.create('mahjong', 2);
    MatchDAO.update(m1.id, { status: 'completed', ended_at: new Date().toISOString() });

    const completed = MatchDAO.list({ status: 'completed' });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(m1.id);
  });

  it('update changes match status and result', () => {
    const match = MatchDAO.create('werewolf', 99);
    const endTime = '2026-04-03T12:00:00Z';
    const updated = MatchDAO.update(match.id, {
      status: 'completed',
      ended_at: endTime,
      result_summary: 'Villagers win',
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('completed');
    expect(updated!.ended_at).toBe(endTime);
    expect(updated!.result_summary).toBe('Villagers win');
  });
});
