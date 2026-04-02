// REST route handlers — Agent registration, login, profile
// See DESIGN.md §4.1 for API specification

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AgentDAO, AgentRatingDAO } from '../db/index.js';

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

  // Check uniqueness
  const existing = AgentDAO.getByName(name.trim());
  if (existing) {
    res.status(409).json({ error: `Agent name "${name.trim()}" is already taken` });
    return;
  }

  const agent = AgentDAO.create(name.trim(), secret);
  const token = signToken(agent.id);

  // Initialize ratings for all game types
  AgentRatingDAO.ensureRating(agent.id, 'werewolf');
  AgentRatingDAO.ensureRating(agent.id, 'mahjong');

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

export { router };
