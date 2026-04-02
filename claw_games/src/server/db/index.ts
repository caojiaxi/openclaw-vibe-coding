// Database schema, migrations, and data access objects
// See DESIGN.md §3 for data models

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  secret_hash: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRating {
  agent_id: string;
  game_type: string;
  rating: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  peak_rating: number;
}

export interface LeaderboardEntry extends AgentRating {
  name: string;
}

export interface Match {
  id: string;
  game_type: string;
  status: 'in_progress' | 'completed' | 'aborted';
  started_at: string;
  ended_at: string | null;
  result_summary: string | null;
  seed: number;
}

export interface MatchParticipant {
  match_id: string;
  agent_id: string;
  seat: number;
  role: string | null;
  result: 'win' | 'lose' | 'draw' | null;
  rating_before: number;
  rating_after: number | null;
}

export interface GameSnapshot {
  id: number;
  match_id: string;
  phase: string;
  turn: number;
  state_json: string;
  timestamp: string;
}

export interface ActionLogEntry {
  id: number;
  match_id: string;
  agent_id: string;
  turn: number;
  action_type: string;
  payload_json: string;
  timestamp: string;
}

// ─── Schema Initialization ──────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  secret_hash   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_ratings (
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  game_type     TEXT NOT NULL,
  rating        REAL NOT NULL DEFAULT 1500.0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  peak_rating   REAL NOT NULL DEFAULT 1500.0,
  PRIMARY KEY (agent_id, game_type)
);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  game_type     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'in_progress',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT,
  result_summary TEXT,
  seed          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id      TEXT NOT NULL REFERENCES matches(id),
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  seat          INTEGER NOT NULL,
  role          TEXT,
  result        TEXT,
  rating_before REAL NOT NULL,
  rating_after  REAL,
  PRIMARY KEY (match_id, agent_id)
);

CREATE TABLE IF NOT EXISTS game_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      TEXT NOT NULL REFERENCES matches(id),
  phase         TEXT NOT NULL,
  turn          INTEGER NOT NULL,
  state_json    TEXT NOT NULL,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      TEXT NOT NULL REFERENCES matches(id),
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  turn          INTEGER NOT NULL,
  action_type   TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const BCRYPT_ROUNDS = 10;

// ─── Database Initialization ────────────────────────────────────────────────

let db: Database.Database;

export function initializeDatabase(dbPath: string = ':memory:'): Database.Database {
  // Guard against leaking a previous database handle
  if (db) {
    db.close();
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// ─── Agent DAO ──────────────────────────────────────────────────────────────

export const AgentDAO = {
  create(name: string, secret: string): Agent {
    const id = uuidv4();
    const secret_hash = bcrypt.hashSync(secret, BCRYPT_ROUNDS);
    const stmt = getDatabase().prepare(
      `INSERT INTO agents (id, name, secret_hash) VALUES (?, ?, ?)`
    );
    stmt.run(id, name, secret_hash);
    return AgentDAO.getById(id)!;
  },

  getById(id: string): Agent | undefined {
    const stmt = getDatabase().prepare(`SELECT * FROM agents WHERE id = ?`);
    return stmt.get(id) as Agent | undefined;
  },

  getByName(name: string): Agent | undefined {
    const stmt = getDatabase().prepare(`SELECT * FROM agents WHERE name = ?`);
    return stmt.get(name) as Agent | undefined;
  },

  verifySecret(agent: Agent, secret: string): boolean {
    return bcrypt.compareSync(secret, agent.secret_hash);
  },

  updateName(id: string, newName: string): Agent | undefined {
    const stmt = getDatabase().prepare(
      `UPDATE agents SET name = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(newName, id);
    return AgentDAO.getById(id);
  },

  getAll(): Agent[] {
    const stmt = getDatabase().prepare(`SELECT * FROM agents`);
    return stmt.all() as Agent[];
  },
};

// ─── Agent Rating DAO ───────────────────────────────────────────────────────

export const AgentRatingDAO = {
  getForAgent(agentId: string): AgentRating[] {
    const stmt = getDatabase().prepare(
      `SELECT * FROM agent_ratings WHERE agent_id = ?`
    );
    return stmt.all(agentId) as AgentRating[];
  },

  getForAgentAndGame(agentId: string, gameType: string): AgentRating | undefined {
    const stmt = getDatabase().prepare(
      `SELECT * FROM agent_ratings WHERE agent_id = ? AND game_type = ?`
    );
    return stmt.get(agentId, gameType) as AgentRating | undefined;
  },

  ensureRating(agentId: string, gameType: string): AgentRating {
    let rating = AgentRatingDAO.getForAgentAndGame(agentId, gameType);
    if (!rating) {
      const stmt = getDatabase().prepare(
        `INSERT INTO agent_ratings (agent_id, game_type) VALUES (?, ?)`
      );
      stmt.run(agentId, gameType);
      rating = AgentRatingDAO.getForAgentAndGame(agentId, gameType)!;
    }
    return rating;
  },

  update(
    agentId: string,
    gameType: string,
    updates: Partial<Pick<AgentRating, 'rating' | 'matches_played' | 'wins' | 'losses' | 'draws' | 'peak_rating'>>,
  ): AgentRating | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return AgentRatingDAO.getForAgentAndGame(agentId, gameType);

    values.push(agentId, gameType);
    const stmt = getDatabase().prepare(
      `UPDATE agent_ratings SET ${fields.join(', ')} WHERE agent_id = ? AND game_type = ?`
    );
    stmt.run(...values);
    return AgentRatingDAO.getForAgentAndGame(agentId, gameType);
  },

  getTopByGame(gameType: string, limit: number = 20, offset: number = 0): LeaderboardEntry[] {
    const stmt = getDatabase().prepare(
      `SELECT ar.*, a.name FROM agent_ratings ar JOIN agents a ON ar.agent_id = a.id WHERE ar.game_type = ? ORDER BY ar.rating DESC LIMIT ? OFFSET ?`
    );
    return stmt.all(gameType, limit, offset) as LeaderboardEntry[];
  },

  countByGame(gameType: string): number {
    const stmt = getDatabase().prepare(
      `SELECT COUNT(*) as count FROM agent_ratings WHERE game_type = ?`
    );
    const row = stmt.get(gameType) as { count: number };
    return row.count;
  },
};

// ─── Match DAO ──────────────────────────────────────────────────────────────

export const MatchDAO = {
  create(gameType: string, seed: number): Match {
    const id = uuidv4();
    const stmt = getDatabase().prepare(
      `INSERT INTO matches (id, game_type, seed) VALUES (?, ?, ?)`
    );
    stmt.run(id, gameType, seed);
    return MatchDAO.getById(id)!;
  },

  getById(id: string): Match | undefined {
    const stmt = getDatabase().prepare(`SELECT * FROM matches WHERE id = ?`);
    return stmt.get(id) as Match | undefined;
  },

  update(
    id: string,
    updates: Partial<Pick<Match, 'status' | 'ended_at' | 'result_summary'>>,
  ): Match | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return MatchDAO.getById(id);

    values.push(id);
    const stmt = getDatabase().prepare(
      `UPDATE matches SET ${fields.join(', ')} WHERE id = ?`
    );
    stmt.run(...values);
    return MatchDAO.getById(id);
  },

  list(filters: { game_type?: string; status?: string; limit?: number; offset?: number } = {}): Match[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.game_type) {
      conditions.push('game_type = ?');
      values.push(filters.game_type);
    }
    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    values.push(limit, offset);

    const stmt = getDatabase().prepare(
      `SELECT * FROM matches ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
    );
    return stmt.all(...values) as Match[];
  },

  countAll(filters: { game_type?: string; status?: string } = {}): number {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.game_type) {
      conditions.push('game_type = ?');
      values.push(filters.game_type);
    }
    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = getDatabase().prepare(`SELECT COUNT(*) as count FROM matches ${where}`);
    const row = stmt.get(...values) as { count: number };
    return row.count;
  },
};

// ─── Match Participant DAO ──────────────────────────────────────────────────

export const MatchParticipantDAO = {
  create(participant: Omit<MatchParticipant, 'rating_after'> & { rating_after?: number | null }): MatchParticipant {
    const stmt = getDatabase().prepare(
      `INSERT INTO match_participants (match_id, agent_id, seat, role, result, rating_before, rating_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      participant.match_id,
      participant.agent_id,
      participant.seat,
      participant.role ?? null,
      participant.result ?? null,
      participant.rating_before,
      participant.rating_after ?? null,
    );
    return MatchParticipantDAO.get(participant.match_id, participant.agent_id)!;
  },

  get(matchId: string, agentId: string): MatchParticipant | undefined {
    const stmt = getDatabase().prepare(
      `SELECT * FROM match_participants WHERE match_id = ? AND agent_id = ?`
    );
    return stmt.get(matchId, agentId) as MatchParticipant | undefined;
  },

  getForMatch(matchId: string): MatchParticipant[] {
    const stmt = getDatabase().prepare(
      `SELECT * FROM match_participants WHERE match_id = ? ORDER BY seat`
    );
    return stmt.all(matchId) as MatchParticipant[];
  },

  getForAgent(agentId: string, limit: number = 20, offset: number = 0): MatchParticipant[] {
    const stmt = getDatabase().prepare(
      `SELECT mp.* FROM match_participants mp JOIN matches m ON mp.match_id = m.id WHERE mp.agent_id = ? ORDER BY m.started_at DESC LIMIT ? OFFSET ?`
    );
    return stmt.all(agentId, limit, offset) as MatchParticipant[];
  },

  update(
    matchId: string,
    agentId: string,
    updates: Partial<Pick<MatchParticipant, 'role' | 'result' | 'rating_after'>>,
  ): MatchParticipant | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return MatchParticipantDAO.get(matchId, agentId);

    values.push(matchId, agentId);
    const stmt = getDatabase().prepare(
      `UPDATE match_participants SET ${fields.join(', ')} WHERE match_id = ? AND agent_id = ?`
    );
    stmt.run(...values);
    return MatchParticipantDAO.get(matchId, agentId);
  },
};

// ─── Game Snapshot DAO ──────────────────────────────────────────────────────

export const GameSnapshotDAO = {
  create(snapshot: Omit<GameSnapshot, 'id' | 'timestamp'>): GameSnapshot {
    const stmt = getDatabase().prepare(
      `INSERT INTO game_snapshots (match_id, phase, turn, state_json) VALUES (?, ?, ?, ?)`
    );
    const result = stmt.run(snapshot.match_id, snapshot.phase, snapshot.turn, snapshot.state_json);
    return GameSnapshotDAO.getById(Number(result.lastInsertRowid))!;
  },

  getById(id: number): GameSnapshot | undefined {
    const stmt = getDatabase().prepare(`SELECT * FROM game_snapshots WHERE id = ?`);
    return stmt.get(id) as GameSnapshot | undefined;
  },

  getForMatch(matchId: string): GameSnapshot[] {
    const stmt = getDatabase().prepare(
      `SELECT * FROM game_snapshots WHERE match_id = ? ORDER BY turn ASC, id ASC`
    );
    return stmt.all(matchId) as GameSnapshot[];
  },
};

// ─── Action Log DAO ─────────────────────────────────────────────────────────

export const ActionLogDAO = {
  create(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): ActionLogEntry {
    const stmt = getDatabase().prepare(
      `INSERT INTO action_log (match_id, agent_id, turn, action_type, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(entry.match_id, entry.agent_id, entry.turn, entry.action_type, entry.payload_json);
    return ActionLogDAO.getById(Number(result.lastInsertRowid))!;
  },

  getById(id: number): ActionLogEntry | undefined {
    const stmt = getDatabase().prepare(`SELECT * FROM action_log WHERE id = ?`);
    return stmt.get(id) as ActionLogEntry | undefined;
  },

  getForMatch(matchId: string): ActionLogEntry[] {
    const stmt = getDatabase().prepare(
      `SELECT * FROM action_log WHERE match_id = ? ORDER BY turn ASC, id ASC`
    );
    return stmt.all(matchId) as ActionLogEntry[];
  },

  getForAgentInMatch(matchId: string, agentId: string): ActionLogEntry[] {
    const stmt = getDatabase().prepare(
      `SELECT * FROM action_log WHERE match_id = ? AND agent_id = ? ORDER BY turn ASC, id ASC`
    );
    return stmt.all(matchId, agentId) as ActionLogEntry[];
  },
};
