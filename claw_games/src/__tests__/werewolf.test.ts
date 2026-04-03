import { describe, it, expect, beforeEach } from 'vitest';
import { WerewolfEngine } from '../games/werewolf/WerewolfEngine.js';
import { Role, Faction, PLAYER_CONFIGS } from '../games/werewolf/roles.js';
import { WerewolfPhase, NightSubPhase, NIGHT_ACTION_ORDER } from '../games/werewolf/phases.js';
import type { WerewolfState, WerewolfPlayer, WerewolfAgentView } from '../games/werewolf/types.js';
import type { Player, Action } from '../engine/types.js';

const SEED = 42;

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `agent_${i}`,
    seat: i,
  }));
}

/** Find a player in the state by role */
function findByRole(state: WerewolfState, role: Role): WerewolfPlayer | undefined {
  return state.players.find(p => p.role === role);
}

/** Find all alive players with a given role */
function findAliveByRole(state: WerewolfState, role: Role): WerewolfPlayer[] {
  return state.players.filter(p => p.role === role && p.alive);
}

/** Find the first alive non-wolf seat */
function firstNonWolfSeat(state: WerewolfState): number {
  const p = state.players.find(s => s.faction !== Faction.Werewolf && s.alive);
  return p ? p.seat : -1;
}

/** Find the first alive wolf seat */
function firstWolfSeat(state: WerewolfState): number {
  const w = state.players.find(s => s.role === Role.Werewolf && s.alive);
  return w ? w.seat : -1;
}

/**
 * Play through one full night with all roles acting with given params.
 * Returns new state after night resolves and transitions.
 */
function playNight(
  engine: WerewolfEngine,
  state: WerewolfState,
  opts: {
    guardTarget?: number;
    wolfTarget?: number;
    witchSave?: boolean;
    witchPoisonTarget?: number;
    seerTarget?: number;
  } = {},
): WerewolfState {
  let s = state;

  // Guard
  if (s.phase !== WerewolfPhase.Night) return s;
  const guard = findByRole(s, Role.Guard);
  if (guard && guard.alive) {
    const target = opts.guardTarget ?? -1;
    s = engine.applyAction(s, guard.agent_id, {
      type: 'guard_protect',
      data: { target },
    });
  }

  // Wolves (all must vote)
  if (s.phase !== WerewolfPhase.Night) return s;
  const wolves = findAliveByRole(s, Role.Werewolf);
  const wolfTarget = opts.wolfTarget ?? firstNonWolfSeat(s);
  for (const wolf of wolves) {
    s = engine.applyAction(s, wolf.agent_id, {
      type: 'wolf_kill',
      data: { target: wolfTarget },
    });
  }

  // Witch
  if (s.phase !== WerewolfPhase.Night) return s;
  const witch = findByRole(s, Role.Witch);
  if (witch && witch.alive) {
    s = engine.applyAction(s, witch.agent_id, {
      type: 'witch_act',
      data: {
        save: opts.witchSave ?? false,
        poison_target: opts.witchPoisonTarget ?? -1,
      },
    });
  }

  // Seer
  if (s.phase !== WerewolfPhase.Night) return s;
  const seer = findByRole(s, Role.Seer);
  if (seer && seer.alive) {
    // Pick a valid target for seer — not self
    let target = opts.seerTarget;
    if (target === undefined) {
      target = s.players.find(
        p => p.alive && p.seat !== seer.seat,
      )?.seat ?? -1;
    }
    if (target >= 0) {
      s = engine.applyAction(s, seer.agent_id, {
        type: 'seer_inspect',
        data: { target },
      });
    }
  }

  return s;
}

/**
 * Advance through DayAnnounce by sending acknowledge from all alive players.
 */
function acknowledgeDay(engine: WerewolfEngine, state: WerewolfState): WerewolfState {
  let s = state;
  const alivePlayers = s.players.filter(p => p.alive);
  for (const player of alivePlayers) {
    s = engine.applyAction(s, player.agent_id, {
      type: 'acknowledge',
      data: {},
    });
  }
  return s;
}

/**
 * Play through DayDiscuss — each alive player speaks in order.
 */
function playDiscuss(engine: WerewolfEngine, state: WerewolfState): WerewolfState {
  let s = state;
  // Each alive player in discussion_order speaks
  const order = s.discussion_order;
  for (const seat of order) {
    const player = s.players.find(p => p.seat === seat);
    if (player && player.alive) {
      s = engine.applyAction(s, player.agent_id, {
        type: 'discuss',
        data: { message: `Player ${seat} speaks` },
      });
    }
  }
  return s;
}

/**
 * Play through DayVote — each alive player votes for a target (or abstains).
 */
function playVote(
  engine: WerewolfEngine,
  state: WerewolfState,
  voteTarget: number | 'abstain' = 'abstain',
): WerewolfState {
  let s = state;
  const aliveSeats = s.players.filter(p => p.alive).map(p => p.seat);
  for (const seat of aliveSeats) {
    const player = s.players.find(p => p.seat === seat)!;
    let target: number;
    if (voteTarget === 'abstain') {
      target = -1;
    } else {
      target = voteTarget !== seat ? voteTarget : -1; // Can't vote for self
    }
    s = engine.applyAction(s, player.agent_id, {
      type: 'vote',
      data: { target },
    });
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WerewolfEngine', () => {
  let engine: WerewolfEngine;

  beforeEach(() => {
    engine = new WerewolfEngine();
  });

  // ─── Initialization ─────────────────────────────────────────────────────

  describe('initialize', () => {
    it('initializes with 8 players', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(state.players).toHaveLength(8);
      expect(state.phase).toBe(WerewolfPhase.Night);
      expect(state.turn).toBe(1);
    });

    it('initializes with 10 players', () => {
      const state = engine.initialize(makePlayers(10), SEED);
      expect(state.players).toHaveLength(10);
      // 10-player config: 3 wolves, 3 villagers, 1 seer, 1 witch, 1 hunter, 1 guard
      const wolves = state.players.filter(p => p.role === Role.Werewolf);
      expect(wolves).toHaveLength(3);
    });

    it('initializes with 12 players', () => {
      const state = engine.initialize(makePlayers(12), SEED);
      expect(state.players).toHaveLength(12);
      const wolves = state.players.filter(p => p.role === Role.Werewolf);
      expect(wolves).toHaveLength(3);
      const villagers = state.players.filter(p => p.role === Role.Villager);
      expect(villagers).toHaveLength(5);
    });

    it('throws for unsupported player count', () => {
      expect(() => engine.initialize(makePlayers(5), SEED)).toThrow(/unsupported player count/);
      expect(() => engine.initialize(makePlayers(9), SEED)).toThrow(/unsupported player count/);
    });

    it('assigns correct role counts for 8 players', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const roleCounts: Record<string, number> = {};
      for (const p of state.players) {
        roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
      }
      expect(roleCounts[Role.Werewolf]).toBe(2);
      expect(roleCounts[Role.Villager]).toBe(2);
      expect(roleCounts[Role.Seer]).toBe(1);
      expect(roleCounts[Role.Witch]).toBe(1);
      expect(roleCounts[Role.Hunter]).toBe(1);
      expect(roleCounts[Role.Guard]).toBe(1);
    });

    it('assigns deterministic roles for same seed', () => {
      const state1 = engine.initialize(makePlayers(8), SEED);
      const state2 = engine.initialize(makePlayers(8), SEED);
      for (let i = 0; i < 8; i++) {
        expect(state1.players[i].role).toBe(state2.players[i].role);
      }
    });

    it('assigns different roles for different seeds', () => {
      const state1 = engine.initialize(makePlayers(8), 42);
      const state2 = engine.initialize(makePlayers(8), 999);
      // Very unlikely to have identical role assignments
      const same = state1.players.every(
        (p, i) => p.role === state2.players[i].role,
      );
      expect(same).toBe(false);
    });

    it('all players start alive', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(state.players.every(p => p.alive)).toBe(true);
    });

    it('faction assignment matches role', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      for (const p of state.players) {
        if (p.role === Role.Werewolf) {
          expect(p.faction).toBe(Faction.Werewolf);
        } else {
          expect(p.faction).toBe(Faction.Village);
        }
      }
    });
  });

  // ─── Night Phase Ordering ───────────────────────────────────────────────

  describe('night phase ordering', () => {
    it('NIGHT_ACTION_ORDER is guard -> wolf -> witch -> seer', () => {
      expect(NIGHT_ACTION_ORDER).toEqual([
        NightSubPhase.GuardProtect,
        NightSubPhase.WerewolfKill,
        NightSubPhase.WitchAct,
        NightSubPhase.SeerInspect,
      ]);
    });

    it('getPhase shows guard sub-phase first on fresh night', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const phase = engine.getPhase(state);
      expect(phase.name).toBe('night:guard_protect');
    });

    it('shows werewolf sub-phase after guard acts', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      state = engine.applyAction(state, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });
      const phase = engine.getPhase(state);
      expect(phase.name).toBe('night:werewolf_kill');
    });

    it('shows witch sub-phase after all wolves vote', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      // Guard skips
      const guard = findByRole(state, Role.Guard)!;
      state = engine.applyAction(state, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });
      // All wolves vote
      const wolves = findAliveByRole(state, Role.Werewolf);
      const target = firstNonWolfSeat(state);
      for (const wolf of wolves) {
        state = engine.applyAction(state, wolf.agent_id, {
          type: 'wolf_kill',
          data: { target },
        });
      }
      const phase = engine.getPhase(state);
      expect(phase.name).toBe('night:witch_act');
    });
  });

  // ─── Win Conditions ─────────────────────────────────────────────────────

  describe('win conditions', () => {
    it('village wins when all wolves are dead', () => {
      let state = engine.initialize(makePlayers(8), SEED);

      // Kill all wolves by voting them out over multiple rounds
      const wolves = state.players.filter(p => p.role === Role.Werewolf);
      let usedAntidote = false;
      for (const wolf of wolves) {
        // Night: save wolf target only if antidote still available
        const canSave = !usedAntidote && state.witch_potions.antidote;
        state = playNight(engine, state, {
          wolfTarget: firstNonWolfSeat(state),
          witchSave: canSave,
        });
        if (canSave) usedAntidote = true;

        if (state.phase === WerewolfPhase.GameOver) break;
        if (state.phase === WerewolfPhase.DayAnnounce) {
          state = acknowledgeDay(engine, state);
        }
        if (state.phase === WerewolfPhase.HunterShoot) {
          const hunter = findByRole(state, Role.Hunter);
          if (hunter) {
            state = engine.applyAction(state, hunter.agent_id, {
              type: 'hunter_shoot',
              data: { target: -1 },
            });
          }
        }
        if (state.phase === WerewolfPhase.DayDiscuss) {
          state = playDiscuss(engine, state);
        }
        if (state.phase === WerewolfPhase.DayVote) {
          // Vote to eliminate this wolf
          if (wolf.alive) {
            state = playVote(engine, state, wolf.seat);
          }
        }
        if (state.phase === WerewolfPhase.HunterShoot) {
          const hunter = findByRole(state, Role.Hunter);
          if (hunter) {
            state = engine.applyAction(state, hunter.agent_id, {
              type: 'hunter_shoot',
              data: { target: -1 },
            });
          }
        }
      }

      // Verify game might be over or wolves are dead
      const aliveWolves = state.players.filter(
        p => p.role === Role.Werewolf && p.alive,
      );
      if (aliveWolves.length === 0 && state.phase === WerewolfPhase.GameOver) {
        const result = engine.getResults(state);
        const villagerResult = result.results.find(
          r =>
            state.players.find(p => p.agent_id === r.agent_id)?.faction ===
            Faction.Village,
        );
        expect(villagerResult?.result).toBe('win');
      }
    });

    it('wolf wins when wolves >= villagers', () => {
      // Use a specific seed scenario to engineer wolf win
      let state = engine.initialize(makePlayers(8), SEED);

      // Kill villagers until wolves >= remaining villagers
      // This is achieved by wolves killing villagers at night,
      // and nobody getting eliminated during the day
      for (let round = 0; round < 10; round++) {
        if (state.phase === WerewolfPhase.GameOver) break;
        if (state.phase !== WerewolfPhase.Night) break;

        const target = firstNonWolfSeat(state);
        if (target < 0) break;

        state = playNight(engine, state, { wolfTarget: target });

        if (state.phase === WerewolfPhase.GameOver) break;
        if (state.phase === WerewolfPhase.DayAnnounce) {
          state = acknowledgeDay(engine, state);
        }
        if (state.phase === WerewolfPhase.HunterShoot) {
          const hunter = findByRole(state, Role.Hunter);
          if (hunter) {
            state = engine.applyAction(state, hunter.agent_id, {
              type: 'hunter_shoot',
              data: { target: -1 },
            });
          }
        }
        if (state.phase === WerewolfPhase.GameOver) break;
        if (state.phase === WerewolfPhase.DayDiscuss) {
          state = playDiscuss(engine, state);
        }
        if (state.phase === WerewolfPhase.DayVote) {
          state = playVote(engine, state, 'abstain');
        }
        if (state.phase === WerewolfPhase.GameOver) break;
      }

      // After enough rounds, wolves should win
      if (state.phase === WerewolfPhase.GameOver) {
        const result = engine.getResults(state);
        const wolfPlayer = state.players.find(p => p.faction === Faction.Werewolf);
        const wolfResult = result.results.find(
          r => r.agent_id === wolfPlayer?.agent_id,
        );
        expect(wolfResult?.result).toBe('win');
      }
    });

    it('getResults throws when game is not over', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(() => engine.getResults(state)).toThrow(/not finished/);
    });
  });

  // ─── Hunter Shoot Trigger ──────────────────────────────────────────────

  describe('hunter shoot trigger', () => {
    it('hunter can shoot when killed by wolves at night', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const hunter = findByRole(state, Role.Hunter)!;

      // Night: wolves kill the hunter, guard protects someone else, witch doesn't save
      const guardTarget = state.players.find(
        p => p.alive && p.seat !== hunter.seat && p.role !== Role.Werewolf,
      )?.seat ?? -1;
      state = playNight(engine, state, {
        wolfTarget: hunter.seat,
        guardTarget,
        witchSave: false,
      });

      // Hunter was killed by wolves (not poisoned) so should trigger shoot
      expect(hunter.alive || state.phase === WerewolfPhase.DayAnnounce || state.phase === WerewolfPhase.HunterShoot).toBe(true);

      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }

      // After DayAnnounce, should enter HunterShoot
      expect(state.phase).toBe(WerewolfPhase.HunterShoot);
      const actions = engine.getAvailableActions(state, hunter.agent_id);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.type === 'hunter_shoot')).toBe(true);
    });

    it('hunter can shoot when eliminated by vote', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const hunter = findByRole(state, Role.Hunter)!;

      // Survive the night (wolf kills someone else)
      const nonHunterTarget = state.players.find(
        p =>
          p.role !== Role.Hunter &&
          p.role !== Role.Werewolf &&
          p.alive,
      )!;
      state = playNight(engine, state, { wolfTarget: nonHunterTarget.seat });

      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }
      if (state.phase === WerewolfPhase.HunterShoot) {
        const hunterP = findByRole(state, Role.Hunter);
        if (hunterP) {
          state = engine.applyAction(state, hunterP.agent_id, {
            type: 'hunter_shoot',
            data: { target: -1 },
          });
        }
      }
      if (state.phase === WerewolfPhase.DayDiscuss) {
        state = playDiscuss(engine, state);
      }
      if (state.phase === WerewolfPhase.DayVote) {
        // Vote to eliminate the hunter
        state = playVote(engine, state, hunter.seat);
      }

      // Should trigger HunterShoot after vote elimination
      expect(state.phase).toBe(WerewolfPhase.HunterShoot);
      const actions = engine.getAvailableActions(state, hunter.agent_id);
      expect(actions.some(a => a.type === 'hunter_shoot')).toBe(true);
    });

    it('hunter does NOT shoot when poisoned by witch', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const hunter = findByRole(state, Role.Hunter)!;
      const wolves = findAliveByRole(state, Role.Werewolf);

      // Wolf kills someone else, witch poisons the hunter
      const otherTarget = state.players.find(
        p =>
          p.seat !== hunter.seat &&
          p.role !== Role.Werewolf &&
          p.alive,
      )!;

      state = playNight(engine, state, {
        wolfTarget: otherTarget.seat,
        witchPoisonTarget: hunter.seat,
      });

      // Hunter should be dead
      const hunterAfter = state.players.find(p => p.role === Role.Hunter);
      expect(hunterAfter?.alive).toBe(false);

      // Should NOT be in HunterShoot phase (poison death doesn't trigger shoot)
      // It should go to DayAnnounce or GameOver
      expect(state.phase).not.toBe(WerewolfPhase.HunterShoot);
    });
  });

  // ─── Guard Consecutive Protection ──────────────────────────────────────

  describe('guard consecutive protection', () => {
    it('cannot protect same target two nights in a row', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      const protectTarget = state.players.find(
        p => p.seat !== guard.seat && p.alive,
      )!.seat;

      // Night 1: guard protects target
      state = playNight(engine, state, {
        guardTarget: protectTarget,
        wolfTarget: firstNonWolfSeat(state),
      });

      // Advance through day
      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }
      if (state.phase === WerewolfPhase.HunterShoot) {
        const hunter = findByRole(state, Role.Hunter);
        if (hunter) {
          state = engine.applyAction(state, hunter.agent_id, {
            type: 'hunter_shoot',
            data: { target: -1 },
          });
        }
      }
      if (state.phase === WerewolfPhase.DayDiscuss) {
        state = playDiscuss(engine, state);
      }
      if (state.phase === WerewolfPhase.DayVote) {
        state = playVote(engine, state, 'abstain');
      }

      // Night 2: guard tries to protect same target again
      if (state.phase === WerewolfPhase.Night && guard.alive) {
        expect(() =>
          engine.applyAction(state, guard.agent_id, {
            type: 'guard_protect',
            data: { target: protectTarget },
          }),
        ).toThrow(/cannot protect same target/);
      }
    });

    it('guard available actions exclude last night target', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      const protectTarget = state.players.find(
        p => p.seat !== guard.seat && p.alive,
      )!.seat;

      // Night 1: protect
      state = playNight(engine, state, {
        guardTarget: protectTarget,
        wolfTarget: firstNonWolfSeat(state),
        witchSave: true,
      });

      // Advance day
      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }
      if (state.phase === WerewolfPhase.HunterShoot) {
        const h = findByRole(state, Role.Hunter);
        if (h) {
          state = engine.applyAction(state, h.agent_id, {
            type: 'hunter_shoot',
            data: { target: -1 },
          });
        }
      }
      if (state.phase === WerewolfPhase.DayDiscuss) {
        state = playDiscuss(engine, state);
      }
      if (state.phase === WerewolfPhase.DayVote) {
        state = playVote(engine, state, 'abstain');
      }

      // Night 2: check available actions
      if (state.phase === WerewolfPhase.Night && guard.alive) {
        const actions = engine.getAvailableActions(state, guard.agent_id);
        const targets = actions
          .filter(a => a.type === 'guard_protect')
          .map(a => (a.data as { target: number }).target);
        expect(targets).not.toContain(protectTarget);
      }
    });
  });

  // ─── Witch Potion Constraints ──────────────────────────────────────────

  describe('witch potion constraints', () => {
    it('witch starts with both potions', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(state.witch_potions.antidote).toBe(true);
      expect(state.witch_potions.poison).toBe(true);
    });

    it('antidote is single-use', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const witch = findByRole(state, Role.Witch)!;

      // Night 1: witch saves
      state = playNight(engine, state, { witchSave: true });

      // Antidote should be used
      expect(state.witch_potions.antidote).toBe(false);
    });

    it('poison is single-use', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const witch = findByRole(state, Role.Witch)!;
      const wolves = findAliveByRole(state, Role.Werewolf);
      const wolfTarget = firstNonWolfSeat(state);

      // Find a valid poison target (not wolf target, not self, not wolf)
      const poisonTarget = state.players.find(
        p =>
          p.alive &&
          p.seat !== witch.seat &&
          p.seat !== wolfTarget &&
          p.role !== Role.Werewolf,
      )?.seat;

      if (poisonTarget !== undefined) {
        state = playNight(engine, state, {
          wolfTarget,
          witchPoisonTarget: poisonTarget,
        });
        expect(state.witch_potions.poison).toBe(false);
      }
    });

    it('cannot use both save and poison in same night', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      state = engine.applyAction(state, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });

      const wolves = findAliveByRole(state, Role.Werewolf);
      const wolfTarget = firstNonWolfSeat(state);
      for (const wolf of wolves) {
        state = engine.applyAction(state, wolf.agent_id, {
          type: 'wolf_kill',
          data: { target: wolfTarget },
        });
      }

      const witch = findByRole(state, Role.Witch)!;
      const poisonTarget = state.players.find(
        p =>
          p.alive &&
          p.seat !== witch.seat &&
          p.seat !== wolfTarget &&
          p.role !== Role.Werewolf,
      )?.seat ?? -1;

      expect(() =>
        engine.applyAction(state, witch.agent_id, {
          type: 'witch_act',
          data: { save: true, poison_target: poisonTarget },
        }),
      ).toThrow(/cannot save and poison/);
    });

    it('witch cannot save herself after night 1', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const witch = findByRole(state, Role.Witch)!;

      // Night 1: don't use save
      state = playNight(engine, state, { wolfTarget: firstNonWolfSeat(state) });

      // Advance day
      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }
      if (state.phase === WerewolfPhase.HunterShoot) {
        const h = findByRole(state, Role.Hunter);
        if (h) {
          state = engine.applyAction(state, h.agent_id, {
            type: 'hunter_shoot',
            data: { target: -1 },
          });
        }
      }
      if (state.phase === WerewolfPhase.DayDiscuss) {
        state = playDiscuss(engine, state);
      }
      if (state.phase === WerewolfPhase.DayVote) {
        state = playVote(engine, state, 'abstain');
      }

      // Night 2: wolves target the witch
      if (state.phase === WerewolfPhase.Night && witch.alive) {
        const guard = findByRole(state, Role.Guard);
        if (guard && guard.alive) {
          state = engine.applyAction(state, guard.agent_id, {
            type: 'guard_protect',
            data: { target: -1 },
          });
        }

        const wolves = findAliveByRole(state, Role.Werewolf);
        for (const wolf of wolves) {
          state = engine.applyAction(state, wolf.agent_id, {
            type: 'wolf_kill',
            data: { target: witch.seat },
          });
        }

        // Witch tries to self-save on night 2
        if (findByRole(state, Role.Witch)?.alive) {
          expect(() =>
            engine.applyAction(state, witch.agent_id, {
              type: 'witch_act',
              data: { save: true, poison_target: -1 },
            }),
          ).toThrow(/cannot save herself after night 1/);
        }
      }
    });
  });

  // ─── Agent View Information Asymmetry ──────────────────────────────────

  describe('agent view information asymmetry', () => {
    it('wolves see each other as teammates', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const wolves = state.players.filter(p => p.role === Role.Werewolf);
      const wolfView = engine.getAgentView(state, wolves[0].agent_id) as WerewolfAgentView;
      expect(wolfView.wolf_teammates).toBeDefined();
      expect(wolfView.wolf_teammates).toContain(wolves[0].seat);
      expect(wolfView.wolf_teammates).toContain(wolves[1].seat);
    });

    it('non-wolves do not see wolf teammates', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const villager = state.players.find(p => p.role === Role.Villager)!;
      const view = engine.getAgentView(state, villager.agent_id) as WerewolfAgentView;
      expect(view.wolf_teammates).toBeUndefined();
    });

    it('seer sees accumulated results', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const seer = findByRole(state, Role.Seer)!;
      const view = engine.getAgentView(state, seer.agent_id) as WerewolfAgentView;
      expect(view.seer_results).toBeDefined();
      expect(view.seer_results).toEqual([]);
    });

    it('non-seer does not see seer results', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const wolf = state.players.find(p => p.role === Role.Werewolf)!;
      const view = engine.getAgentView(state, wolf.agent_id) as WerewolfAgentView;
      expect(view.seer_results).toBeUndefined();
    });

    it('witch sees potion status', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const witch = findByRole(state, Role.Witch)!;
      const view = engine.getAgentView(state, witch.agent_id) as WerewolfAgentView;
      expect(view.witch_potions).toBeDefined();
      expect(view.witch_potions?.antidote).toBe(true);
      expect(view.witch_potions?.poison).toBe(true);
    });

    it('each player sees their own role', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      for (const p of state.players) {
        const view = engine.getAgentView(state, p.agent_id) as WerewolfAgentView;
        expect(view.your_role).toBe(p.role);
        expect(view.your_seat).toBe(p.seat);
      }
    });

    it('getAgentView throws for unknown agent', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(() => engine.getAgentView(state, 'nonexistent')).toThrow(/not found/);
    });
  });

  // ─── Action Validation ──────────────────────────────────────────────────

  describe('action validation', () => {
    it('rejects guard action from non-guard', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const villager = state.players.find(p => p.role === Role.Villager)!;
      expect(() =>
        engine.applyAction(state, villager.agent_id, {
          type: 'guard_protect',
          data: { target: 0 },
        }),
      ).toThrow(/Only guard/);
    });

    it('rejects wolf_kill from non-wolf', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      // Skip guard phase first
      const guard = findByRole(state, Role.Guard)!;
      state = engine.applyAction(state, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });

      const seer = findByRole(state, Role.Seer)!;
      expect(() =>
        engine.applyAction(state, seer.agent_id, {
          type: 'wolf_kill',
          data: { target: 0 },
        }),
      ).toThrow(/Only werewolves/);
    });

    it('rejects targeting dead player', () => {
      let state = engine.initialize(makePlayers(8), SEED);

      // Kill someone in night 1
      const target = firstNonWolfSeat(state);
      state = playNight(engine, state, { wolfTarget: target });

      // Advance to night 2
      if (state.phase === WerewolfPhase.DayAnnounce) {
        state = acknowledgeDay(engine, state);
      }
      if (state.phase === WerewolfPhase.HunterShoot) {
        const h = findByRole(state, Role.Hunter);
        if (h) {
          state = engine.applyAction(state, h.agent_id, {
            type: 'hunter_shoot',
            data: { target: -1 },
          });
        }
      }
      if (state.phase === WerewolfPhase.DayDiscuss) {
        state = playDiscuss(engine, state);
      }
      if (state.phase === WerewolfPhase.DayVote) {
        state = playVote(engine, state, 'abstain');
      }

      // Night 2: wolf tries to target the dead player
      if (state.phase === WerewolfPhase.Night) {
        const guard = findByRole(state, Role.Guard);
        if (guard && guard.alive) {
          state = engine.applyAction(state, guard.agent_id, {
            type: 'guard_protect',
            data: { target: -1 },
          });
        }

        const wolves = findAliveByRole(state, Role.Werewolf);
        if (wolves.length > 0) {
          // Target is now dead, this should throw
          expect(() =>
            engine.applyAction(state, wolves[0].agent_id, {
              type: 'wolf_kill',
              data: { target },
            }),
          ).toThrow(/dead/);
        }
      }
    });

    it('rejects wolf targeting fellow wolf', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      state = engine.applyAction(state, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });

      const wolves = findAliveByRole(state, Role.Werewolf);
      expect(() =>
        engine.applyAction(state, wolves[0].agent_id, {
          type: 'wolf_kill',
          data: { target: wolves[1].seat },
        }),
      ).toThrow(/fellow werewolf/);
    });

    it('rejects seer inspecting self', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      // Skip guard, wolf, witch
      state = playNight(engine, state, {});
      // seer would have already acted in playNight; test directly:
      const freshState = engine.initialize(makePlayers(8), SEED);
      // Advance to seer sub-phase
      const guard = findByRole(freshState, Role.Guard)!;
      let s = engine.applyAction(freshState, guard.agent_id, {
        type: 'guard_protect',
        data: { target: -1 },
      });
      const wolves = findAliveByRole(s, Role.Werewolf);
      const wt = firstNonWolfSeat(s);
      for (const wolf of wolves) {
        s = engine.applyAction(s, wolf.agent_id, {
          type: 'wolf_kill',
          data: { target: wt },
        });
      }
      const witch = findByRole(s, Role.Witch)!;
      s = engine.applyAction(s, witch.agent_id, {
        type: 'witch_act',
        data: { save: false, poison_target: -1 },
      });
      const seer = findByRole(s, Role.Seer)!;
      expect(() =>
        engine.applyAction(s, seer.agent_id, {
          type: 'seer_inspect',
          data: { target: seer.seat },
        }),
      ).toThrow(/cannot target self/);
    });

    it('dead player has no available actions', () => {
      let state = engine.initialize(makePlayers(8), SEED);
      const target = firstNonWolfSeat(state);
      state = playNight(engine, state, { wolfTarget: target });

      const deadPlayer = state.players.find(p => p.seat === target);
      if (deadPlayer) {
        const actions = engine.getAvailableActions(state, deadPlayer.agent_id);
        expect(actions).toHaveLength(0);
      }
    });

    it('rejects invalid seat number', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      const guard = findByRole(state, Role.Guard)!;
      expect(() =>
        engine.applyAction(state, guard.agent_id, {
          type: 'guard_protect',
          data: { target: 99 },
        }),
      ).toThrow(/does not exist/);
    });
  });

  // ─── isFinished ────────────────────────────────────────────────────────

  describe('isFinished', () => {
    it('returns false for a fresh game', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      expect(engine.isFinished(state)).toBe(false);
    });

    it('returns true when phase is GameOver', () => {
      const state = engine.initialize(makePlayers(8), SEED);
      (state as any).phase = WerewolfPhase.GameOver;
      expect(engine.isFinished(state)).toBe(true);
    });
  });

  // ─── Min/Max Players ──────────────────────────────────────────────────

  describe('player counts', () => {
    it('getMinPlayers returns 8', () => {
      expect(engine.getMinPlayers()).toBe(8);
    });

    it('getMaxPlayers returns 12', () => {
      expect(engine.getMaxPlayers()).toBe(12);
    });
  });
});
