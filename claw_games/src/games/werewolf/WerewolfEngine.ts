// Werewolf game engine
// Implements GameEngine interface for 狼人杀
// See DESIGN.md §6 for full specification

import type { GameEngine, Player, Phase, Action, MatchResult } from '../../engine/types.js';
import { Role, Faction, ROLE_FACTION, PLAYER_CONFIGS } from './roles.js';
import { WerewolfPhase, NightSubPhase, NIGHT_ACTION_ORDER } from './phases.js';
import type { WerewolfState, WerewolfPlayer, WerewolfAgentView } from './types.js';

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Advance seed deterministically */
function advanceSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) | 0;
}

/** Fisher-Yates shuffle using a seeded PRNG, returns new seed state */
function seededShuffle<T>(arr: T[], seed: number): { result: T[]; nextSeed: number } {
  const rng = mulberry32(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  // Advance seed deterministically
  const nextSeed = advanceSeed(seed);
  return { result, nextSeed };
}

// ─── Helper: deep-clone state ────────────────────────────────────────────────

function cloneState(state: WerewolfState): WerewolfState {
  return JSON.parse(JSON.stringify(state)) as WerewolfState;
}

// ─── Helper: current night sub-phase based on which actions are still pending ─

function getCurrentNightSubPhase(state: WerewolfStateInternal): NightSubPhase | null {
  const { night_actions } = state;

  for (const sub of NIGHT_ACTION_ORDER) {
    switch (sub) {
      case NightSubPhase.GuardProtect:
        if (night_actions.guard_target === null && hasAliveRole(state, Role.Guard)) {
          return NightSubPhase.GuardProtect;
        }
        break;
      case NightSubPhase.WerewolfKill:
        if (night_actions.wolf_target === null && hasAliveRole(state, Role.Werewolf)) {
          // Wolf target is resolved only after ALL living wolves have voted
          const aliveWolves = getWolves(state);
          const wolfVotes = night_actions.wolf_votes;
          const allWolvesVoted = aliveWolves.every(
            w => wolfVotes[w.seat] !== undefined,
          );
          if (!allWolvesVoted) {
            return NightSubPhase.WerewolfKill;
          }
        }
        break;
      case NightSubPhase.WitchAct:
        if (
          night_actions.witch_save === false &&
          night_actions.witch_poison_target === null &&
          hasAliveRole(state, Role.Witch)
        ) {
          if (!state._witch_acted) {
            return NightSubPhase.WitchAct;
          }
        }
        break;
      case NightSubPhase.SeerInspect:
        if (night_actions.seer_target === null && hasAliveRole(state, Role.Seer)) {
          return NightSubPhase.SeerInspect;
        }
        break;
    }
  }
  return null;
}

/** Internal extended state to track engine-private fields */
interface WerewolfStateInternal extends WerewolfState {
  _witch_acted?: boolean;
  _pending_deaths?: number[];        // seats that died this night (resolved after night)
  _hunter_trigger_seat?: number | null; // if hunter was killed, trigger shoot phase
  _hunter_trigger_source?: 'night' | 'vote' | null; // explicit source of hunter trigger
  _last_vote_result?: { votes: Record<number, number>; eliminated?: number };
  _night_sub_phase?: NightSubPhase | null;
  _acknowledged_seats?: number[];    // seats that have acknowledged day announce
}

function hasAliveRole(state: WerewolfState, role: Role): boolean {
  return state.players.some(p => p.role === role && p.alive);
}

function getAliveSeats(state: WerewolfState): number[] {
  return state.players.filter(p => p.alive).map(p => p.seat);
}

function getPlayerBySeat(state: WerewolfState, seat: number): WerewolfPlayer | undefined {
  return state.players.find(p => p.seat === seat);
}

function getPlayerByAgent(state: WerewolfState, agentId: string): WerewolfPlayer | undefined {
  return state.players.find(p => p.agent_id === agentId);
}

function getWolves(state: WerewolfState): WerewolfPlayer[] {
  return state.players.filter(p => p.role === Role.Werewolf && p.alive);
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function validateSeatExists(state: WerewolfState, seat: number, label: string): void {
  if (seat < 0) return; // -1 is a valid "skip" sentinel
  const player = getPlayerBySeat(state, seat);
  if (!player) {
    throw new Error(`${label}: seat ${seat} does not exist`);
  }
}

function validateTargetAlive(state: WerewolfState, seat: number, label: string): void {
  if (seat < 0) return; // -1 is a valid "skip" sentinel
  const player = getPlayerBySeat(state, seat);
  if (!player) {
    throw new Error(`${label}: seat ${seat} does not exist`);
  }
  if (!player.alive) {
    throw new Error(`${label}: target seat ${seat} is dead`);
  }
}

function validateNotSelf(seat: number, playerSeat: number, label: string): void {
  if (seat < 0) return;
  if (seat === playerSeat) {
    throw new Error(`${label}: cannot target self (seat ${seat})`);
  }
}

// ─── Win condition check ─────────────────────────────────────────────────────

function checkWinCondition(state: WerewolfState): Faction | null {
  const aliveWolves = state.players.filter(p => p.alive && p.faction === Faction.Werewolf);
  const aliveVillagers = state.players.filter(p => p.alive && p.faction === Faction.Village);

  if (aliveWolves.length === 0) return Faction.Village;
  if (aliveVillagers.length === 0) return Faction.Werewolf;
  // Also check: wolves >= villagers counts as wolf win (outnumber)
  if (aliveWolves.length >= aliveVillagers.length) return Faction.Werewolf;
  return null;
}

// ─── Night resolution ────────────────────────────────────────────────────────

function resolveNight(state: WerewolfStateInternal): WerewolfStateInternal {
  const s = state;
  const deaths: number[] = [];
  const wolfTarget = s.night_actions.wolf_target;
  const guardTarget = s.night_actions.guard_target;

  // Determine if wolf kill succeeds
  if (wolfTarget !== null && wolfTarget >= 0) {
    const isGuarded = guardTarget === wolfTarget;
    const isSaved = s.night_actions.witch_save;

    if (!isGuarded && !isSaved) {
      deaths.push(wolfTarget);
    }
  }

  // Witch poison
  const poisonTarget = s.night_actions.witch_poison_target;
  if (poisonTarget !== null && poisonTarget >= 0) {
    if (!deaths.includes(poisonTarget)) {
      deaths.push(poisonTarget);
    }
  }

  s._pending_deaths = deaths;
  return s;
}

function applyDeaths(state: WerewolfStateInternal): WerewolfStateInternal {
  const s = state;
  const deaths = s._pending_deaths ?? [];
  let hunterTriggered: number | null = null;

  for (const seat of deaths) {
    const player = getPlayerBySeat(s, seat);
    if (player && player.alive) {
      player.alive = false;
      // Hunter can shoot when killed by wolves, but NOT when poisoned by witch.
      if (player.role === Role.Hunter) {
        const wasPoisoned = s.night_actions.witch_poison_target === seat;
        if (!wasPoisoned) {
          hunterTriggered = seat;
        }
      }
    }
  }

  s._hunter_trigger_seat = hunterTriggered;
  if (hunterTriggered !== null) {
    s._hunter_trigger_source = 'night';
  }
  s._pending_deaths = [];
  return s;
}

// ─── Wolf vote resolution ───────────────────────────────────────────────────

function resolveWolfVotes(state: WerewolfStateInternal): number {
  const wolfVotes = state.night_actions.wolf_votes;
  const votes = Object.values(wolfVotes).filter(t => t >= 0);

  if (votes.length === 0) {
    // All wolves skipped - pick random non-wolf target
    return pickRandomNonWolfTarget(state);
  }

  // Count votes
  const counts: Record<number, number> = {};
  for (const t of votes) {
    counts[t] = (counts[t] ?? 0) + 1;
  }

  // Find majority
  let maxCount = 0;
  let maxTargets: number[] = [];
  for (const [seatStr, count] of Object.entries(counts)) {
    const seat = Number(seatStr);
    if (count > maxCount) {
      maxCount = count;
      maxTargets = [seat];
    } else if (count === maxCount) {
      maxTargets.push(seat);
    }
  }

  if (maxTargets.length === 1) {
    return maxTargets[0];
  }

  // No majority - pick random non-wolf target
  return pickRandomNonWolfTarget(state);
}

function pickRandomNonWolfTarget(state: WerewolfStateInternal): number {
  const targets = getAliveSeats(state).filter(
    seat => getPlayerBySeat(state, seat)?.faction !== Faction.Werewolf,
  );
  if (targets.length === 0) return -1;
  const rng = mulberry32(state.seed);
  const target = targets[Math.floor(rng() * targets.length)];
  // Advance seed after random selection
  state.seed = advanceSeed(state.seed);
  return target;
}

// ─── Discussion order helpers ───────────────────────────────────────────────

function buildDiscussionOrder(state: WerewolfStateInternal): number[] {
  const aliveSeats = getAliveSeats(state).sort((a, b) => a - b);
  if (aliveSeats.length === 0) return [];

  let startSeat: number;
  if (state.turn === 1 && !state._last_vote_result) {
    // Day 1: random start using seed
    const rng = mulberry32(state.seed);
    startSeat = aliveSeats[Math.floor(rng() * aliveSeats.length)];
    state.seed = advanceSeed(state.seed);
  } else if (state._last_vote_result?.eliminated !== undefined) {
    // Subsequent days: start from the left of the last eliminated player
    const eliminated = state._last_vote_result.eliminated;
    // Find next alive seat after the eliminated seat (circular)
    const idx = aliveSeats.findIndex(s => s > eliminated);
    startSeat = idx >= 0 ? aliveSeats[idx] : aliveSeats[0];
  } else {
    // No elimination last round, use random
    const rng = mulberry32(state.seed);
    startSeat = aliveSeats[Math.floor(rng() * aliveSeats.length)];
    state.seed = advanceSeed(state.seed);
  }

  // Rotate to start from startSeat
  const startIdx = aliveSeats.indexOf(startSeat);
  return [...aliveSeats.slice(startIdx), ...aliveSeats.slice(0, startIdx)];
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class WerewolfEngine implements GameEngine<WerewolfState, WerewolfAgentView> {
  getMinPlayers(): number {
    return 8;
  }

  getMaxPlayers(): number {
    return 12;
  }

  initialize(players: Player[], seed: number): WerewolfState {
    const n = players.length;
    const config = PLAYER_CONFIGS[n];
    if (!config) {
      throw new Error(
        `Werewolf: unsupported player count ${n}. Supported: ${Object.keys(PLAYER_CONFIGS).join(', ')}`,
      );
    }

    // Build role pool
    const rolePool: Role[] = [];
    for (const rc of config) {
      for (let i = 0; i < rc.count; i++) {
        rolePool.push(rc.role);
      }
    }

    // Shuffle roles deterministically
    const { result: shuffledRoles, nextSeed } = seededShuffle(rolePool, seed);

    // Create players
    const wPlayers: WerewolfPlayer[] = players.map((p, i) => ({
      agent_id: p.id,
      seat: p.seat,
      role: shuffledRoles[i],
      faction: ROLE_FACTION[shuffledRoles[i]],
      alive: true,
    }));

    const state: WerewolfStateInternal = {
      match_id: `werewolf_${seed}`,
      phase: WerewolfPhase.Night,
      turn: 1,
      players: wPlayers,
      night_actions: {
        guard_target: null,
        wolf_target: null,
        wolf_votes: {},
        witch_save: false,
        witch_poison_target: null,
        seer_target: null,
      },
      witch_potions: { antidote: true, poison: true },
      last_guard_target: null,
      discussion: [],
      discussion_order: [],
      discussion_current_index: 0,
      votes: {},
      seer_results: [],
      seed: nextSeed,
      pending_death_announcements: [],
      _witch_acted: false,
      _pending_deaths: [],
      _hunter_trigger_seat: null,
      _hunter_trigger_source: null,
      _last_vote_result: undefined,
      _night_sub_phase: null,
      _acknowledged_seats: [],
    };

    return state;
  }

  getPhase(state: WerewolfState): Phase {
    const s = state as WerewolfStateInternal;
    const sub = s.phase === WerewolfPhase.Night ? getCurrentNightSubPhase(s) : null;
    return {
      name: sub ? `${s.phase}:${sub}` : s.phase,
      turn: s.turn,
    };
  }

  getAgentView(state: WerewolfState, agentId: string): WerewolfAgentView {
    const s = state as WerewolfStateInternal;
    const player = getPlayerByAgent(s, agentId);
    if (!player) {
      throw new Error(`Agent ${agentId} not found in game`);
    }

    const aliveSeats = getAliveSeats(s);
    const deadPlayers = s.players
      .filter(p => !p.alive)
      .map(p => {
        // Only reveal role for dead Hunter (per spec §6.6)
        const role = p.role === Role.Hunter ? p.role : undefined;
        return { seat: p.seat, role };
      });

    const view: WerewolfAgentView = {
      match_id: s.match_id,
      phase: s.phase,
      turn: s.turn,
      your_seat: player.seat,
      your_role: player.role,
      alive_players: aliveSeats,
      dead_players: deadPlayers,
      discussion: [...s.discussion],
    };

    // Wolves see each other
    if (player.role === Role.Werewolf) {
      view.wolf_teammates = getWolves(s).map(w => w.seat);
    }

    // Seer sees accumulated results
    if (player.role === Role.Seer) {
      view.seer_results = [...s.seer_results];
    }

    // Witch sees potion status and wolf target during night
    if (player.role === Role.Witch) {
      view.witch_potions = { ...s.witch_potions };
      if (s.phase === WerewolfPhase.Night && s.night_actions.wolf_target !== null) {
        view.wolf_target = s.night_actions.wolf_target;
      }
    }

    // Last vote result
    if (s._last_vote_result) {
      view.last_vote_result = s._last_vote_result;
    }

    // Include night sub-phase so agents know whose turn it is
    if (s.phase === WerewolfPhase.Night) {
      view.nightSubPhase = getCurrentNightSubPhase(s) ?? null;
    }

    return view;
  }

  getAvailableActions(state: WerewolfState, agentId: string): Action[] {
    const s = state as WerewolfStateInternal;
    const player = getPlayerByAgent(s, agentId);
    if (!player) return [];
    // Dead players have no actions — EXCEPT hunter during HunterShoot phase
    if (!player.alive && s.phase !== WerewolfPhase.HunterShoot) return [];

    switch (s.phase) {
      case WerewolfPhase.Night:
        return this._getNightActions(s, player);
      case WerewolfPhase.DayAnnounce: {
        if (!player.alive) return [];
        const acked = (s._acknowledged_seats ?? []);
        if (acked.includes(player.seat)) return [];
        return [{ type: 'acknowledge', data: {} }];
      }
      case WerewolfPhase.DayDiscuss:
        return this._getDiscussActions(s, player);
      case WerewolfPhase.DayVote:
        return this._getVoteActions(s, player);
      case WerewolfPhase.HunterShoot:
        return this._getHunterActions(s, player);
      case WerewolfPhase.GameOver:
        return [];
      default:
        return [];
    }
  }

  applyAction(state: WerewolfState, agentId: string, action: Action): WerewolfState {
    const s = cloneState(state) as WerewolfStateInternal;
    // Preserve internal fields through clone
    const orig = state as WerewolfStateInternal;
    s._witch_acted = orig._witch_acted;
    s._pending_deaths = orig._pending_deaths ? [...orig._pending_deaths] : [];
    s._hunter_trigger_seat = orig._hunter_trigger_seat;
    s._hunter_trigger_source = orig._hunter_trigger_source;
    s._last_vote_result = orig._last_vote_result
      ? JSON.parse(JSON.stringify(orig._last_vote_result))
      : undefined;
    s._night_sub_phase = orig._night_sub_phase;
    s._acknowledged_seats = orig._acknowledged_seats ? [...orig._acknowledged_seats] : [];

    const player = getPlayerByAgent(s, agentId);
    if (!player) {
      throw new Error(`Agent ${agentId} not found in game`);
    }

    const actionType = action.type;
    const data = action.data as Record<string, unknown>;

    switch (s.phase) {
      case WerewolfPhase.Night:
        this._applyNightAction(s, player, actionType, data);
        // Check if night is complete
        if (getCurrentNightSubPhase(s) === null) {
          this._resolveNightAndTransition(s);
        }
        break;

      case WerewolfPhase.DayAnnounce:
        this._applyAcknowledge(s, player, actionType);
        break;

      case WerewolfPhase.DayDiscuss:
        this._applyDiscussAction(s, player, actionType, data);
        break;

      case WerewolfPhase.DayVote:
        this._applyVoteAction(s, player, actionType, data);
        // Check if all alive players have voted
        if (this._allVotesIn(s)) {
          this._resolveVoteAndTransition(s);
        }
        break;

      case WerewolfPhase.HunterShoot:
        this._applyHunterAction(s, player, actionType, data);
        break;

      default:
        throw new Error(`Cannot apply action in phase ${s.phase}`);
    }

    return s;
  }

  isFinished(state: WerewolfState): boolean {
    return state.phase === WerewolfPhase.GameOver;
  }

  getResults(state: WerewolfState): MatchResult {
    if (state.phase !== WerewolfPhase.GameOver) {
      throw new Error('Cannot get results: game is not finished');
    }

    const winner = checkWinCondition(state);
    return {
      results: state.players.map(p => ({
        agent_id: p.agent_id,
        result: winner !== null && p.faction === winner ? 'win' : 'lose',
        // Werewolf-specific fields (extra, not in base MatchResult interface)
        seat: p.seat,
        role: p.role,
        faction: p.faction,
        alive: p.alive,
      } as MatchResult['results'][number])),
    };
  }

  // DayAnnounce phase is handled via 'acknowledge' actions from players.
  // See _applyAcknowledge() — transitions only after ALL living players acknowledge.

  getTimeoutAction(state: WerewolfState, agentId: string): Action | null {
    const actions = this.getAvailableActions(state, agentId);
    if (actions.length === 0) return null;

    // For timeout: pick a safe default
    const s = state as WerewolfStateInternal;
    const player = getPlayerByAgent(s, agentId);
    if (!player) return null;

    switch (s.phase) {
      case WerewolfPhase.Night: {
        // Skip / do nothing actions
        if (player.role === Role.Guard) {
          return { type: 'guard_protect', data: { target: -1 } };
        }
        if (player.role === Role.Werewolf) {
          // Random alive non-wolf target
          const targets = getAliveSeats(s).filter(
            seat => getPlayerBySeat(s, seat)?.faction !== Faction.Werewolf,
          );
          if (targets.length > 0) {
            const rng = mulberry32(s.seed);
            const target = targets[Math.floor(rng() * targets.length)];
            // Note: do NOT mutate state here — getTimeoutAction must be side-effect-free.
            // Seed advancement happens in applyAction when the action is actually applied.
            return { type: 'wolf_kill', data: { target } };
          }
          return { type: 'wolf_kill', data: { target: -1 } };
        }
        if (player.role === Role.Witch) {
          return { type: 'witch_act', data: { save: false, poison_target: -1 } };
        }
        if (player.role === Role.Seer) {
          const targets = getAliveSeats(s).filter(seat => seat !== player.seat);
          if (targets.length > 0) {
            const rng = mulberry32(s.seed);
            const target = targets[Math.floor(rng() * targets.length)];
            // Note: do NOT mutate state here — getTimeoutAction must be side-effect-free.
            return { type: 'seer_inspect', data: { target } };
          }
          return null;
        }
        return null;
      }
      case WerewolfPhase.DayAnnounce:
        return { type: 'acknowledge', data: {} };
      case WerewolfPhase.DayDiscuss:
        return { type: 'discuss', data: { message: '' } };
      case WerewolfPhase.DayVote:
        // Abstain
        return { type: 'vote', data: { target: -1 } };
      case WerewolfPhase.HunterShoot:
        // Don't shoot anyone
        return { type: 'hunter_shoot', data: { target: -1 } };
      default:
        return actions[0] ?? null;
    }
  }

  // ─── Night Actions ───────────────────────────────────────────────────────

  private _getNightActions(state: WerewolfStateInternal, player: WerewolfPlayer): Action[] {
    const subPhase = getCurrentNightSubPhase(state);
    if (!subPhase) return [];

    switch (subPhase) {
      case NightSubPhase.GuardProtect: {
        if (player.role !== Role.Guard) return [];
        const targets = getAliveSeats(state).filter(
          seat => seat !== state.last_guard_target, // Cannot protect same target as last night
        );
        const actions: Action[] = targets.map(seat => ({
          type: 'guard_protect',
          data: { target: seat },
        }));
        // Option to not protect anyone
        actions.push({ type: 'guard_protect', data: { target: -1 } });
        return actions;
      }

      case NightSubPhase.WerewolfKill: {
        if (player.role !== Role.Werewolf) return [];
        // If this wolf already voted, no more actions
        if (state.night_actions.wolf_votes[player.seat] !== undefined) return [];
        const targets = getAliveSeats(state).filter(
          seat => getPlayerBySeat(state, seat)?.role !== Role.Werewolf,
        );
        const actions: Action[] = targets.map(seat => ({
          type: 'wolf_kill',
          data: { target: seat },
        }));
        // Option to not kill (empty night)
        actions.push({ type: 'wolf_kill', data: { target: -1 } });
        return actions;
      }

      case NightSubPhase.WitchAct: {
        if (player.role !== Role.Witch) return [];
        const actions: Action[] = [];
        const wolfTarget = state.night_actions.wolf_target;

        // Witch self-save rule: can save self on night 1, cannot save self after night 1
        const canSaveSelf = state.turn === 1;
        const canSave =
          state.witch_potions.antidote &&
          wolfTarget !== null &&
          wolfTarget >= 0 &&
          (wolfTarget !== player.seat || canSaveSelf);

        // Can poison any alive player (except herself) if poison is available
        // Poison target must also be different from wolf target per spec
        const canPoison = state.witch_potions.poison;
        const poisonTargets = canPoison
          ? getAliveSeats(state).filter(
              seat => seat !== player.seat && seat !== wolfTarget,
            )
          : [];

        // Generate combined actions: save + poison_target
        // The witch acts once with both decisions

        if (canSave) {
          // Save only
          actions.push({ type: 'witch_act', data: { save: true, poison_target: -1 } });
          // Cannot save AND poison in same night (standard rule)
        }

        if (poisonTargets.length > 0) {
          for (const target of poisonTargets) {
            actions.push({ type: 'witch_act', data: { save: false, poison_target: target } });
          }
        }

        // Do nothing
        actions.push({ type: 'witch_act', data: { save: false, poison_target: -1 } });

        return actions;
      }

      case NightSubPhase.SeerInspect: {
        if (player.role !== Role.Seer) return [];
        const targets = getAliveSeats(state).filter(seat => seat !== player.seat);
        return targets.map(seat => ({
          type: 'seer_inspect',
          data: { target: seat },
        }));
      }

      default:
        return [];
    }
  }

  private _applyNightAction(
    state: WerewolfStateInternal,
    player: WerewolfPlayer,
    actionType: string,
    data: Record<string, unknown>,
  ): void {
    // Validate that the action matches the current night sub-phase
    const currentSubPhase = getCurrentNightSubPhase(state);
    const actionSubPhaseMap: Record<string, NightSubPhase> = {
      guard_protect: NightSubPhase.GuardProtect,
      wolf_kill: NightSubPhase.WerewolfKill,
      witch_act: NightSubPhase.WitchAct,
      seer_inspect: NightSubPhase.SeerInspect,
    };
    const requiredSubPhase = actionSubPhaseMap[actionType];
    if (requiredSubPhase === undefined) {
      throw new Error(`Unknown night action: ${actionType}`);
    }
    if (currentSubPhase !== requiredSubPhase) {
      throw new Error(
        `Night action '${actionType}' cannot be submitted during sub-phase '${currentSubPhase ?? 'none'}' (expected '${requiredSubPhase}')`,
      );
    }

    switch (actionType) {
      case 'guard_protect': {
        if (player.role !== Role.Guard) throw new Error('Only guard can protect');
        if (typeof data.target !== "number") throw new Error("guard_protect: target must be a number");
        const target = data.target as number;
        validateSeatExists(state, target, 'guard_protect');
        validateTargetAlive(state, target, 'guard_protect');
        if (target !== -1 && target === state.last_guard_target) {
          throw new Error('Guard cannot protect same target as last night');
        }
        state.night_actions.guard_target = target;
        break;
      }

      case 'wolf_kill': {
        if (player.role !== Role.Werewolf) throw new Error('Only werewolves can kill');
        if (typeof data.target !== "number") throw new Error("wolf_kill: target must be a number");
        const target = data.target as number;
        validateSeatExists(state, target, 'wolf_kill');
        validateTargetAlive(state, target, 'wolf_kill');
        // Wolves cannot target other wolves
        if (target >= 0) {
          const targetPlayer = getPlayerBySeat(state, target);
          if (targetPlayer?.role === Role.Werewolf) {
            throw new Error('wolf_kill: cannot target a fellow werewolf');
          }
        }
        // Record this wolf's individual vote
        if (state.night_actions.wolf_votes[player.seat] !== undefined) {
          throw new Error('wolf_kill: this wolf has already voted');
        }
        state.night_actions.wolf_votes[player.seat] = target;

        // Check if all living wolves have voted
        const aliveWolves = getWolves(state);
        const allVoted = aliveWolves.every(
          w => state.night_actions.wolf_votes[w.seat] !== undefined,
        );
        if (allVoted) {
          // Resolve the collective wolf target
          state.night_actions.wolf_target = resolveWolfVotes(state);
        }
        break;
      }

      case 'witch_act': {
        if (player.role !== Role.Witch) throw new Error('Only witch can use potions');
        if (typeof data.save !== "boolean") throw new Error("witch_act: save must be a boolean");
        if (typeof data.poison_target !== "number") throw new Error("witch_act: poison_target must be a number");
        const save = data.save as boolean;
        const poisonTarget = data.poison_target as number;

        if (save && !state.witch_potions.antidote) {
          throw new Error('Witch has no antidote left');
        }
        if (poisonTarget >= 0 && !state.witch_potions.poison) {
          throw new Error('Witch has no poison left');
        }
        if (save && poisonTarget >= 0) {
          throw new Error('Witch cannot save and poison in the same night');
        }

        // Validate save: witch self-save rule
        if (save) {
          const wolfTarget = state.night_actions.wolf_target;
          if (wolfTarget === player.seat && state.turn > 1) {
            throw new Error('Witch cannot save herself after night 1');
          }
        }

        // Validate poison target
        if (poisonTarget >= 0) {
          validateSeatExists(state, poisonTarget, 'witch_poison');
          validateTargetAlive(state, poisonTarget, 'witch_poison');
          validateNotSelf(poisonTarget, player.seat, 'witch_poison');
          // Poison target must differ from wolf target
          if (poisonTarget === state.night_actions.wolf_target) {
            throw new Error('Witch poison target cannot be the same as wolf kill target');
          }
        }

        state.night_actions.witch_save = save;
        state.night_actions.witch_poison_target = poisonTarget;
        if (save) state.witch_potions.antidote = false;
        if (poisonTarget >= 0) state.witch_potions.poison = false;
        state._witch_acted = true;
        break;
      }

      case 'seer_inspect': {
        if (player.role !== Role.Seer) throw new Error('Only seer can inspect');
        if (typeof data.target !== "number") throw new Error("seer_inspect: target must be a number");
        const target = data.target as number;
        validateSeatExists(state, target, 'seer_inspect');
        validateTargetAlive(state, target, 'seer_inspect');
        validateNotSelf(target, player.seat, 'seer_inspect');
        const targetPlayer = getPlayerBySeat(state, target);
        if (!targetPlayer) throw new Error(`Invalid seer target seat ${target}`);
        const isWolf = targetPlayer.faction === Faction.Werewolf;
        state.night_actions.seer_target = target;
        state.seer_results.push({ seat: target, is_wolf: isWolf });
        break;
      }

      default:
        throw new Error(`Unknown night action: ${actionType}`);
    }
  }

  private _resolveNightAndTransition(state: WerewolfStateInternal): void {
    // Resolve night: compute deaths, then capture them BEFORE clearing
    resolveNight(state);
    const nightDeaths = state._pending_deaths ? [...state._pending_deaths] : [];
    applyDeaths(state);

    // Update last guard target
    state.last_guard_target = state.night_actions.guard_target;

    // Check win condition after deaths
    const winner = checkWinCondition(state);
    if (winner !== null) {
      // If hunter was triggered, let them shoot first
      if (state._hunter_trigger_seat !== null) {
        state.phase = WerewolfPhase.HunterShoot;
      } else {
        state.phase = WerewolfPhase.GameOver;
      }
      return;
    }

    // Record deaths for DayAnnounce (captured before applyDeaths cleared them)
    state.pending_death_announcements = nightDeaths;

    // Transition to DayAnnounce (not directly to DayDiscuss)
    state.phase = WerewolfPhase.DayAnnounce;

    // If hunter was killed by wolves (not poison), the HunterShoot will trigger
    // when the first acknowledge action is applied in DayAnnounce
  }

  // ─── DayAnnounce Acknowledge ─────────────────────────────────────────────

  private _applyAcknowledge(
    state: WerewolfStateInternal,
    player: WerewolfPlayer,
    actionType: string,
  ): void {
    if (actionType !== 'acknowledge') {
      throw new Error(`Unknown acknowledge action: ${actionType}`);
    }

    // Only process while still in DayAnnounce.
    if (state.phase !== WerewolfPhase.DayAnnounce) return;

    // Track acknowledged players — only transition when ALL living players have acknowledged.
    if (!state._acknowledged_seats) {
      state._acknowledged_seats = [];
    }
    if (!state._acknowledged_seats.includes(player.seat)) {
      state._acknowledged_seats.push(player.seat);
    }

    // Check if all living players have acknowledged
    const aliveSeats = getAliveSeats(state);
    const allAcknowledged = aliveSeats.every(seat => state._acknowledged_seats!.includes(seat));
    if (!allAcknowledged) return;

    // All acknowledged — clear tracker
    state._acknowledged_seats = [];

    // If hunter was triggered during night, enter hunter shoot first.
    if (state._hunter_trigger_seat !== null) {
      state.phase = WerewolfPhase.HunterShoot;
      return;
    }

    // Otherwise, transition to discussion
    state.phase = WerewolfPhase.DayDiscuss;
    state.discussion = [];
    state.votes = {};
    state.discussion_order = buildDiscussionOrder(state);
    state.discussion_current_index = 0;
    // Clear announcements
    state.pending_death_announcements = [];
  }

  // ─── Day Discussion Actions ──────────────────────────────────────────────

  private _getDiscussActions(state: WerewolfStateInternal, player: WerewolfPlayer): Action[] {
    if (!player.alive) return [];

    // Only the current speaker (per seat-ordered speaking) can act
    const order = state.discussion_order;
    const currentIdx = state.discussion_current_index;
    if (order.length === 0 || currentIdx >= order.length) {
      // All players have spoken; no more discussion actions
      // Auto-transition to vote should be triggered
      return [];
    }

    const currentSpeakerSeat = order[currentIdx];
    if (player.seat !== currentSpeakerSeat) {
      return []; // Not this player's turn to speak
    }

    const actions: Action[] = [];

    // Send a discussion message
    actions.push({
      type: 'discuss',
      data: { message: '' }, // agent fills in the message
    });

    return actions;
  }

  private _applyDiscussAction(
    state: WerewolfStateInternal,
    player: WerewolfPlayer,
    actionType: string,
    data: Record<string, unknown>,
  ): void {
    switch (actionType) {
      case 'discuss': {
        if (!player.alive) {
          throw new Error('Dead players cannot discuss');
        }
        // Validate it's this player's turn to speak
        const order = state.discussion_order;
        const currentIdx = state.discussion_current_index;
        if (currentIdx >= order.length) {
          throw new Error('Discussion round is over');
        }
        if (order[currentIdx] !== player.seat) {
          throw new Error(`Not your turn to speak. Current speaker: seat ${order[currentIdx]}`);
        }

        const message = data.message as string;
        if (typeof message !== "string") throw new Error("discuss: message must be a string");
        state.discussion.push({ seat: player.seat, message });
        state.discussion_current_index += 1;

        // If all players have spoken, auto-transition to vote
        if (state.discussion_current_index >= state.discussion_order.length) {
          state.phase = WerewolfPhase.DayVote;
        }
        break;
      }
      default:
        throw new Error(`Unknown discuss action: ${actionType}`);
    }
  }

  // ─── Day Vote Actions ────────────────────────────────────────────────────

  private _getVoteActions(state: WerewolfStateInternal, player: WerewolfPlayer): Action[] {
    if (!player.alive) return [];
    // Already voted
    if (state.votes[player.seat] !== undefined) return [];

    const targets = getAliveSeats(state).filter(seat => seat !== player.seat);
    const actions: Action[] = targets.map(seat => ({
      type: 'vote',
      data: { target: seat },
    }));
    // Abstain option
    actions.push({ type: 'vote', data: { target: -1 } });
    return actions;
  }

  private _applyVoteAction(
    state: WerewolfStateInternal,
    player: WerewolfPlayer,
    actionType: string,
    data: Record<string, unknown>,
  ): void {
    if (actionType !== 'vote') {
      throw new Error(`Unknown vote action: ${actionType}`);
    }
    if (!player.alive) {
      throw new Error('Dead players cannot vote');
    }
    if (state.votes[player.seat] !== undefined) {
      throw new Error('Player has already voted');
    }
    const target = data.target as number;
    validateSeatExists(state, target, 'vote');
    validateTargetAlive(state, target, 'vote');
    validateNotSelf(target, player.seat, 'vote');
    state.votes[player.seat] = target;
  }

  private _allVotesIn(state: WerewolfStateInternal): boolean {
    const aliveSeats = getAliveSeats(state);
    return aliveSeats.every(seat => state.votes[seat] !== undefined);
  }

  private _resolveVoteAndTransition(state: WerewolfStateInternal): void {
    // Tally votes
    const voteCounts: Record<number, number> = {};
    for (const [, target] of Object.entries(state.votes)) {
      if (target >= 0) {
        voteCounts[target] = (voteCounts[target] ?? 0) + 1;
      }
    }

    // Find max votes
    let maxVotes = 0;
    let maxTargets: number[] = [];
    for (const [seat, count] of Object.entries(voteCounts)) {
      const seatNum = Number(seat);
      if (count > maxVotes) {
        maxVotes = count;
        maxTargets = [seatNum];
      } else if (count === maxVotes) {
        maxTargets.push(seatNum);
      }
    }

    let eliminated: number | undefined;

    if (maxTargets.length === 1 && maxVotes > 0) {
      // Clear majority — eliminate the target
      eliminated = maxTargets[0];
      const eliminatedPlayer = getPlayerBySeat(state, eliminated);
      if (eliminatedPlayer) {
        eliminatedPlayer.alive = false;
      }
    }
    // Tie or no votes → no elimination

    state._last_vote_result = {
      votes: { ...state.votes },
      eliminated,
    };

    // Check if eliminated player was hunter → trigger shoot
    if (eliminated !== undefined) {
      const eliminatedPlayer = getPlayerBySeat(state, eliminated);
      if (eliminatedPlayer?.role === Role.Hunter) {
        state._hunter_trigger_seat = eliminated;
        state._hunter_trigger_source = 'vote';
        state.phase = WerewolfPhase.HunterShoot;
        return;
      }
    }

    // Check win condition
    const winner = checkWinCondition(state);
    if (winner !== null) {
      state.phase = WerewolfPhase.GameOver;
      return;
    }

    // Transition to next night
    this._transitionToNextNight(state);
  }

  private _transitionToNextNight(state: WerewolfStateInternal): void {
    state.phase = WerewolfPhase.Night;
    state.turn += 1;
    state.discussion = [];
    state.discussion_order = [];
    state.discussion_current_index = 0;
    state.votes = {};
    state.night_actions = {
      guard_target: null,
      wolf_target: null,
      wolf_votes: {},
      witch_save: false,
      witch_poison_target: null,
      seer_target: null,
    };
    state._witch_acted = false;
    state._hunter_trigger_seat = null;
    state._hunter_trigger_source = null;
    state.pending_death_announcements = [];
  }

  // ─── Hunter Actions ──────────────────────────────────────────────────────

  private _getHunterActions(state: WerewolfStateInternal, player: WerewolfPlayer): Action[] {
    if (player.role !== Role.Hunter) return [];
    if (state._hunter_trigger_seat !== player.seat) return [];

    const targets = getAliveSeats(state).filter(seat => seat !== player.seat);
    const actions: Action[] = targets.map(seat => ({
      type: 'hunter_shoot',
      data: { target: seat },
    }));
    // Option to not shoot
    actions.push({ type: 'hunter_shoot', data: { target: -1 } });
    return actions;
  }

  private _applyHunterAction(
    state: WerewolfStateInternal,
    player: WerewolfPlayer,
    actionType: string,
    data: Record<string, unknown>,
  ): void {
    if (actionType !== 'hunter_shoot') {
      throw new Error(`Unknown hunter action: ${actionType}`);
    }
    if (player.role !== Role.Hunter) {
      throw new Error('Only hunter can shoot');
    }
    if (state._hunter_trigger_seat !== player.seat) {
      throw new Error('Hunter is not triggered to shoot');
    }

    const target = data.target as number;
    if (typeof target !== 'number') throw new Error('hunter_shoot: target must be a number');
    if (target >= 0) {
      if (target === player.seat) throw new Error('Hunter cannot shoot self');
      validateSeatExists(state, target, 'hunter_shoot');
      validateTargetAlive(state, target, 'hunter_shoot');
      const targetPlayer = getPlayerBySeat(state, target);
      if (targetPlayer && targetPlayer.alive) {
        targetPlayer.alive = false;
      }
    }

    // Remember where the trigger came from before clearing
    const triggerSource = state._hunter_trigger_source;
    state._hunter_trigger_seat = null;
    state._hunter_trigger_source = null;

    // Check win condition after hunter shoot
    const winner = checkWinCondition(state);
    if (winner !== null) {
      state.phase = WerewolfPhase.GameOver;
      return;
    }

    // Use explicit trigger source to determine next phase
    if (triggerSource === 'vote') {
      // Came from day vote → go to next night
      this._transitionToNextNight(state);
    } else {
      // Came from night (triggerSource === 'night') → go to DayDiscuss
      state.phase = WerewolfPhase.DayDiscuss;
      state.discussion = [];
      state.votes = {};
      state.discussion_order = buildDiscussionOrder(state);
      state.discussion_current_index = 0;
      state.pending_death_announcements = [];
    }
  }
}
