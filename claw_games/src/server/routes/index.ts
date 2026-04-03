// REST route handlers — Agent registration, login, profile
// See DESIGN.md §4.1 for API specification

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AgentDAO, AgentRatingDAO, MatchDAO, MatchParticipantDAO, getDatabase } from '../db/index.js';

// JWT secret — MUST be provided via environment variable
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required. Set it before starting the server.',
  );
}
const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

// ─── Types ──────────────────────────────────────────────────────────────────

interface JWTPayload {
  sub: string; // agent id
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  agentId?: string;
  agentName?: string;
}

// ─── JWT Helpers ────────────────────────────────────────────────────────────

export function signToken(agentId: string): string {
  return jwt.sign({ sub: agentId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

// ─── Auth Middleware ────────────────────────────────────────────────────────

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <token>' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    // Look up agent from DB — reject if deleted
    const agent = AgentDAO.getById(payload.sub);
    if (!agent) {
      res.status(401).json({ error: 'Agent no longer exists' });
      return;
    }
    req.agentId = payload.sub;
    req.agentName = agent.name;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /agents — Register a new agent
 * Body: { name: string, secret: string }
 * Returns 201: { id, name, token }
 */
router.post('/agents', (req: Request, res: Response) => {
  const { name, secret } = req.body as { name?: string; secret?: string };

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Field "name" is required and must be a non-empty string' });
    return;
  }
  if (!secret || typeof secret !== 'string' || secret.length < 4) {
    res.status(400).json({ error: 'Field "secret" is required and must be at least 4 characters' });
    return;
  }

  // Check uniqueness (also handle insert race with try-catch)
  const existing = AgentDAO.getByName(name.trim());
  if (existing) {
    res.status(409).json({ error: `Agent name "${name.trim()}" is already taken` });
    return;
  }

  let agent;
  try {
    // Create agent + initialize ratings in a single transaction
    agent = getDatabase().transaction(() => {
      const a = AgentDAO.create(name.trim(), secret);
      AgentRatingDAO.ensureRating(a.id, 'werewolf');
      AgentRatingDAO.ensureRating(a.id, 'mahjong');
      return a;
    })();
  } catch (err: unknown) {
    // Handle unique constraint violation from concurrent requests
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      res.status(409).json({ error: `Agent name "${name.trim()}" is already taken` });
      return;
    }
    throw err;
  }

  const token = signToken(agent.id);

  res.status(201).json({
    id: agent.id,
    name: agent.name,
    token,
  });
});

/**
 * POST /agents/login — Authenticate an agent
 * Body: { name: string, secret: string }
 * Returns 200: { token }
 */
router.post('/agents/login', (req: Request, res: Response) => {
  const { name, secret } = req.body as { name?: string; secret?: string };

  if (!name || !secret) {
    res.status(400).json({ error: 'Fields "name" and "secret" are required' });
    return;
  }

  const agent = AgentDAO.getByName(name.trim());
  if (!agent) {
    res.status(401).json({ error: 'Invalid name or secret' });
    return;
  }

  if (!AgentDAO.verifySecret(agent, secret)) {
    res.status(401).json({ error: 'Invalid name or secret' });
    return;
  }

  const token = signToken(agent.id);
  res.status(200).json({ token });
});

/**
 * GET /agents/me — Get own profile + ratings (requires auth)
 */
router.get('/agents/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const agent = AgentDAO.getById(req.agentId!);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const ratings = AgentRatingDAO.getForAgent(agent.id);

  res.status(200).json({
    id: agent.id,
    name: agent.name,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
    ratings: ratings.map(r => ({
      game_type: r.game_type,
      rating: r.rating,
      matches_played: r.matches_played,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      peak_rating: r.peak_rating,
    })),
  });
});

/**
 * PATCH /agents/me — Update agent display name (requires auth)
 * Body: { name: string }
 */
router.patch('/agents/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { name } = req.body as { name?: string };

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Field "name" is required and must be a non-empty string' });
    return;
  }

  // Check uniqueness
  const existing = AgentDAO.getByName(name.trim());
  if (existing && existing.id !== req.agentId) {
    res.status(409).json({ error: `Agent name "${name.trim()}" is already taken` });
    return;
  }

  const updated = AgentDAO.updateName(req.agentId!, name.trim());
  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Re-issue token so downstream consumers (e.g. WS) pick up the new identity
  const token = signToken(updated.id);

  res.status(200).json({
    id: updated.id,
    name: updated.name,
    updated_at: updated.updated_at,
    token,
  });
});


// ─── Leaderboard ────────────────────────────────────────────────────────────

router.get('/leaderboard/:game_type', (req: Request, res: Response) => {
  const gameType = req.params.game_type as string;
  if (!['werewolf', 'mahjong'].includes(gameType)) {
    res.status(400).json({ error: 'Invalid game_type. Must be "werewolf" or "mahjong".' });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit || "50")) || 50, 100);
  const offset = parseInt(String(req.query.offset || "0")) || 0;
  const entries = AgentRatingDAO.getTopByGame(gameType, limit, offset);
  const total = AgentRatingDAO.countByGame(gameType);
  res.json({
    game_type: gameType,
    entries: entries.map((e, i) => ({
      rank: offset + i + 1,
      agent_id: e.agent_id,
      name: e.name,
      rating: e.rating,
      matches_played: e.matches_played,
      wins: e.wins,
    })),
    total,
  });
});

// ─── Match History ──────────────────────────────────────────────────────────

router.get('/matches', (req: Request, res: Response) => {
  const filters: { game_type?: string; status?: string; limit?: number; offset?: number } = {};
  if (req.query.game_type) filters.game_type = String(req.query.game_type);
  if (req.query.status) filters.status = String(req.query.status);
  filters.limit = Math.min(parseInt(String(req.query.limit || "50")) || 20, 100);
  filters.offset = parseInt(String(req.query.offset || "0")) || 0;
  const matches = MatchDAO.list(filters);
  const total = MatchDAO.countAll({ game_type: filters.game_type, status: filters.status });
  const result = matches.map(m => {
    const participants = MatchParticipantDAO.getForMatch(m.id);
    const db = getDatabase();
    return {
      ...m,
      participants: participants.map(p => {
        const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(p.agent_id) as { name: string } | undefined;
        return { agent_id: p.agent_id, name: agent?.name ?? 'Unknown', seat: p.seat, result: p.result };
      }),
    };
  });
  res.json({ matches: result, total });
});

// ─── Match Detail ───────────────────────────────────────────────────────────

router.get('/matches/:match_id', (req: Request, res: Response) => {
  const match = MatchDAO.getById(req.params.match_id as string);
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  const participants = MatchParticipantDAO.getForMatch(match.id);
  const db = getDatabase();
  res.json({
    ...match,
    participants: participants.map(p => {
      const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(p.agent_id) as { name: string } | undefined;
      return { ...p, name: agent?.name ?? 'Unknown' };
    }),
  });
});

// ─── Spectate Info ──────────────────────────────────────────────────────────

router.get('/matches/:match_id/spectate-info', (req: Request, res: Response) => {
  const match = MatchDAO.getById(req.params.match_id as string);
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  const participants = MatchParticipantDAO.getForMatch(match.id);
  const db = getDatabase();
  res.json({
    match_id: match.id,
    game_type: match.game_type,
    status: match.status,
    started_at: match.started_at,
    ended_at: match.ended_at,
    can_spectate: match.status === 'in_progress',
    participants: participants.map(p => {
      const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(p.agent_id) as { name: string } | undefined;
      return { agent_id: p.agent_id, name: agent?.name ?? 'Unknown', seat: p.seat };
    }),
  });
});

export { router };
