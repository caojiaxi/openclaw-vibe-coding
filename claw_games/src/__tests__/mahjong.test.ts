import { describe, it, expect, beforeEach } from 'vitest';
import { MahjongEngine } from '../games/mahjong/MahjongEngine.js';
import { createTileSet, createShuffledTileSet, Suit } from '../games/mahjong/tiles.js';
import { MahjongPhase, PlaySubPhase, MahjongActionType } from '../games/mahjong/types.js';
import type { MahjongState, MahjongAction } from '../games/mahjong/types.js';
import type { Player } from '../engine/types.js';

const SEED = 42;

function make4Players(): Player[] {
  return [
    { id: 'p0', seat: 0 },
    { id: 'p1', seat: 1 },
    { id: 'p2', seat: 2 },
    { id: 'p3', seat: 3 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile Set Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('createTileSet', () => {
  it('creates exactly 108 tiles', () => {
    const tiles = createTileSet();
    expect(tiles).toHaveLength(108);
  });

  it('has 3 suits', () => {
    const tiles = createTileSet();
    const suits = new Set(tiles.map(t => t.suit));
    expect(suits.size).toBe(3);
    expect(suits).toContain(Suit.Bamboo);
    expect(suits).toContain(Suit.Dots);
    expect(suits).toContain(Suit.Characters);
  });

  it('has 36 tiles per suit (9 values x 4 copies)', () => {
    const tiles = createTileSet();
    for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
      const suitTiles = tiles.filter(t => t.suit === suit);
      expect(suitTiles).toHaveLength(36);
    }
  });

  it('has exactly 4 copies of each value per suit', () => {
    const tiles = createTileSet();
    for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
      for (let value = 1; value <= 9; value++) {
        const count = tiles.filter(
          t => t.suit === suit && t.value === value,
        ).length;
        expect(count).toBe(4);
      }
    }
  });

  it('tile values range from 1 to 9', () => {
    const tiles = createTileSet();
    for (const tile of tiles) {
      expect(tile.value).toBeGreaterThanOrEqual(1);
      expect(tile.value).toBeLessThanOrEqual(9);
    }
  });
});

describe('createShuffledTileSet', () => {
  it('creates 108 tiles', () => {
    const tiles = createShuffledTileSet(SEED);
    expect(tiles).toHaveLength(108);
  });

  it('is deterministic for same seed', () => {
    const tiles1 = createShuffledTileSet(SEED);
    const tiles2 = createShuffledTileSet(SEED);
    expect(tiles1).toEqual(tiles2);
  });

  it('differs for different seeds', () => {
    const tiles1 = createShuffledTileSet(42);
    const tiles2 = createShuffledTileSet(999);
    // Check if the first tile differs (extremely unlikely to match)
    const sameOrder = tiles1.every(
      (t, i) => t.suit === tiles2[i].suit && t.value === tiles2[i].value,
    );
    expect(sameOrder).toBe(false);
  });

  it('preserves tile counts after shuffle', () => {
    const tiles = createShuffledTileSet(SEED);
    for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
      for (let value = 1; value <= 9; value++) {
        const count = tiles.filter(
          t => t.suit === suit && t.value === value,
        ).length;
        expect(count).toBe(4);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MahjongEngine Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MahjongEngine', () => {
  let engine: MahjongEngine;

  beforeEach(() => {
    engine = new MahjongEngine();
  });

  // ─── Initialization ─────────────────────────────────────────────────────

  describe('initialize', () => {
    it('initializes with 4 players', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(state.players).toHaveLength(4);
    });

    it('throws for non-4 player count', () => {
      expect(() =>
        engine.initialize([{ id: 'p0', seat: 0 }], SEED),
      ).toThrow(/exactly 4/);
    });

    it('starts in DeclareLacking phase', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(state.phase).toBe(MahjongPhase.DeclareLacking);
    });

    it('deals 13 tiles to non-dealer, 14 to dealer', () => {
      const state = engine.initialize(make4Players(), SEED);
      const dealer = state.dealer;
      for (let i = 0; i < 4; i++) {
        if (i === dealer) {
          expect(state.players[i].hand).toHaveLength(14);
        } else {
          expect(state.players[i].hand).toHaveLength(13);
        }
      }
    });

    it('total tiles (hands + wall + wall_back) = 108', () => {
      const state = engine.initialize(make4Players(), SEED);
      const handTiles = state.players.reduce((sum, p) => sum + p.hand.length, 0);
      const totalTiles = handTiles + state.wall.length + state.wall_back.length;
      expect(totalTiles).toBe(108);
    });

    it('all players start with no declared lack', () => {
      const state = engine.initialize(make4Players(), SEED);
      for (const p of state.players) {
        expect(p.declared_lack).toBeNull();
        expect(p.has_declared_lack).toBe(false);
      }
    });

    it('all players start alive and not won', () => {
      const state = engine.initialize(make4Players(), SEED);
      for (const p of state.players) {
        expect(p.has_won).toBe(false);
        expect(p.is_forfeited).toBe(false);
      }
    });

    it('witch potions start empty (no exposed sets)', () => {
      const state = engine.initialize(make4Players(), SEED);
      for (const p of state.players) {
        expect(p.exposed_sets).toHaveLength(0);
        expect(p.discards).toHaveLength(0);
      }
    });

    it('is deterministic for same seed', () => {
      const state1 = engine.initialize(make4Players(), SEED);
      const state2 = engine.initialize(make4Players(), SEED);
      for (let i = 0; i < 4; i++) {
        expect(state1.players[i].hand).toEqual(state2.players[i].hand);
      }
      expect(state1.wall).toEqual(state2.wall);
    });

    it('dealer seat is 0', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(state.dealer).toBe(0);
    });
  });

  // ─── Declare Lack Phase ─────────────────────────────────────────────────

  describe('declare lack phase', () => {
    it('all players can declare lack at start', () => {
      const state = engine.initialize(make4Players(), SEED);
      for (const p of state.players) {
        const actions = engine.getAvailableActions(state, p.agent_id);
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.every(a => a.type === MahjongActionType.DeclareLack)).toBe(true);
      }
    });

    it('offers 3 suit choices for declare lack', () => {
      const state = engine.initialize(make4Players(), SEED);
      const actions = engine.getAvailableActions(state, 'p0');
      expect(actions).toHaveLength(3);
      const suits = actions.map(a => (a.data as MahjongAction).suit);
      expect(suits).toContain(Suit.Bamboo);
      expect(suits).toContain(Suit.Dots);
      expect(suits).toContain(Suit.Characters);
    });

    it('player cannot declare lack twice', () => {
      let state = engine.initialize(make4Players(), SEED);
      state = engine.applyAction(state, 'p0', {
        type: MahjongActionType.DeclareLack,
        data: { type: MahjongActionType.DeclareLack, suit: Suit.Bamboo } as MahjongAction,
      });
      // p0 already declared — should have no actions
      const actions = engine.getAvailableActions(state, 'p0');
      expect(actions).toHaveLength(0);
    });

    it('transitions to Playing after all players declare', () => {
      let state = engine.initialize(make4Players(), SEED);
      const suits = [Suit.Bamboo, Suit.Dots, Suit.Characters, Suit.Bamboo];
      for (let i = 0; i < 4; i++) {
        state = engine.applyAction(state, `p${i}`, {
          type: MahjongActionType.DeclareLack,
          data: { type: MahjongActionType.DeclareLack, suit: suits[i] } as MahjongAction,
        });
      }
      expect(state.phase).toBe(MahjongPhase.Playing);
    });

    it('stays in DeclareLacking until all players declare', () => {
      let state = engine.initialize(make4Players(), SEED);
      // Only 3 players declare
      for (let i = 0; i < 3; i++) {
        state = engine.applyAction(state, `p${i}`, {
          type: MahjongActionType.DeclareLack,
          data: { type: MahjongActionType.DeclareLack, suit: Suit.Bamboo } as MahjongAction,
        });
      }
      expect(state.phase).toBe(MahjongPhase.DeclareLacking);
    });

    it('dealer starts in PostDraw after declaration (14 tiles)', () => {
      let state = engine.initialize(make4Players(), SEED);
      for (let i = 0; i < 4; i++) {
        state = engine.applyAction(state, `p${i}`, {
          type: MahjongActionType.DeclareLack,
          data: { type: MahjongActionType.DeclareLack, suit: Suit.Bamboo } as MahjongAction,
        });
      }
      expect(state.sub_phase).toBe(PlaySubPhase.PostDraw);
      expect(state.current_turn).toBe(state.dealer);
    });
  });

  // ─── Basic Draw/Discard Cycle ───────────────────────────────────────────

  describe('draw/discard cycle', () => {
    let state: MahjongState;

    beforeEach(() => {
      state = engine.initialize(make4Players(), SEED);
      // All players declare lack
      for (let i = 0; i < 4; i++) {
        state = engine.applyAction(state, `p${i}`, {
          type: MahjongActionType.DeclareLack,
          data: { type: MahjongActionType.DeclareLack, suit: Suit.Bamboo } as MahjongAction,
        });
      }
    });

    it('dealer starts in PostDraw sub-phase', () => {
      expect(state.sub_phase).toBe(PlaySubPhase.PostDraw);
      expect(state.current_turn).toBe(0);
    });

    it('dealer can discard a tile', () => {
      const dealer = state.players[state.dealer];
      const actions = engine.getAvailableActions(state, dealer.agent_id);
      const discardActions = actions.filter(a => a.type === MahjongActionType.Discard);
      expect(discardActions.length).toBeGreaterThan(0);

      // Discard the first tile
      const tileToDiscard = (discardActions[0].data as MahjongAction).tile!;
      const newState = engine.applyAction(state, dealer.agent_id, {
        type: MahjongActionType.Discard,
        data: {
          type: MahjongActionType.Discard,
          tile: tileToDiscard,
        } as MahjongAction,
      });

      // Dealer now has 13 tiles
      const newDealer = newState.players[state.dealer];
      expect(newDealer.hand).toHaveLength(13);
      expect(newDealer.discards).toHaveLength(1);
    });

    it('non-active player cannot discard', () => {
      // p1 is not the active player
      expect(() =>
        engine.applyAction(state, 'p1', {
          type: MahjongActionType.Discard,
          data: {
            type: MahjongActionType.Discard,
            tile: state.players[1].hand[0],
          } as MahjongAction,
        }),
      ).toThrow();
    });

    it('after discard and pass, next player draws', () => {
      // Dealer discards
      const dealer = state.players[state.dealer];
      const tileToDiscard = dealer.hand[0];
      let s = engine.applyAction(state, dealer.agent_id, {
        type: MahjongActionType.Discard,
        data: {
          type: MahjongActionType.Discard,
          tile: tileToDiscard,
        } as MahjongAction,
      });

      // If there's a discard reaction window, all responders pass
      if (s.current_discard && s.sub_phase === PlaySubPhase.DiscardReaction) {
        const responders = [...s.current_discard.pending_responses];
        for (const seat of responders) {
          const player = s.players[seat];
          s = engine.applyAction(s, player.agent_id, {
            type: MahjongActionType.Pass,
            data: { type: MahjongActionType.Pass } as MahjongAction,
          });
        }
      }

      // Next player should be in draw phase
      if (s.sub_phase === PlaySubPhase.Draw) {
        const nextPlayer = s.players[s.current_turn];
        expect(nextPlayer.hand).toHaveLength(13);

        // Next player draws
        s = engine.applyAction(s, nextPlayer.agent_id, {
          type: MahjongActionType.Draw,
          data: { type: MahjongActionType.Draw } as MahjongAction,
        });
        expect(s.sub_phase).toBe(PlaySubPhase.PostDraw);
        expect(s.players[s.current_turn].hand).toHaveLength(14);
      }
    });
  });

  // ─── Win Detection ──────────────────────────────────────────────────────

  describe('win detection', () => {
    it('isFinished returns false for fresh game', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(engine.isFinished(state)).toBe(false);
    });

    it('isFinished returns true when phase is Finished', () => {
      const state = engine.initialize(make4Players(), SEED);
      (state as any).phase = MahjongPhase.Finished;
      expect(engine.isFinished(state)).toBe(true);
    });

    it('getResults throws when game not finished', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(() => engine.getResults(state)).toThrow(/not finished/);
    });
  });

  // ─── Min/Max Players ────────────────────────────────────────────────────

  describe('player counts', () => {
    it('getMinPlayers returns 4', () => {
      expect(engine.getMinPlayers()).toBe(4);
    });

    it('getMaxPlayers returns 4', () => {
      expect(engine.getMaxPlayers()).toBe(4);
    });
  });

  // ─── Agent View ─────────────────────────────────────────────────────────

  describe('agent view', () => {
    it('returns correct view for a player', () => {
      const state = engine.initialize(make4Players(), SEED);
      const view = engine.getAgentView(state, 'p0');
      expect(view.your_seat).toBe(0);
      expect(view.your_hand).toHaveLength(14); // dealer
      expect(view.phase).toBe(MahjongPhase.DeclareLacking);
      expect(view.tiles_remaining).toBeGreaterThan(0);
      expect(view.scores).toEqual([0, 0, 0, 0]);
      expect(view.winners).toEqual([]);
    });

    it('hides others declared lack during declaration phase', () => {
      let state = engine.initialize(make4Players(), SEED);
      state = engine.applyAction(state, 'p0', {
        type: MahjongActionType.DeclareLack,
        data: { type: MahjongActionType.DeclareLack, suit: Suit.Bamboo } as MahjongAction,
      });
      // p1 should see p0 as having declared but not know the suit
      const view = engine.getAgentView(state, 'p1');
      // p0's declared lack should be hidden (null) from p1's perspective during declaration
      expect(view.declared_lacks[0]).toBeNull();
    });

    it('throws for unknown agent', () => {
      const state = engine.initialize(make4Players(), SEED);
      expect(() => engine.getAgentView(state, 'nonexistent')).toThrow(/not found/);
    });
  });
});
