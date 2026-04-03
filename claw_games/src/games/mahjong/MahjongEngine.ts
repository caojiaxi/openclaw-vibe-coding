// Sichuan Mahjong game engine
// Implements GameEngine interface for 四川麻将 (血战到底)
// See DESIGN.md §7 for full specification

import type { GameEngine, Player, Phase, Action, MatchResult, AgentView } from '../../engine/types.js';
import { Tile, Suit, createShuffledTileSet } from './tiles.js';
import {
  ScoringPattern,
  BonusFan,
  scoreHand,
  KONG_PAYMENTS,
  PATTERN_FAN,
  BONUS_FAN_VALUE,
} from './scoring.js';
import {
  MahjongPhase,
  PlaySubPhase,
  MahjongActionType,
  KongType,
  SetType,
  type MahjongState,
  type MahjongPlayer,
  type MahjongAgentView,
  type MahjongAction,
  type ActionOption,
  type ExposedSet,
  type DiscardInfo,
  type WinEvent,
  type KongPayment,
  type PendingClaim,
  type Settlement,
  type PendingAddKong,
} from './types.js';

// ─── Tile Helpers ────────────────────────────────────────────────────────────

function tilesEqual(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

function countTile(tiles: Tile[], target: Tile): number {
  return tiles.filter(t => tilesEqual(t, target)).length;
}

function removeTileFromArray(tiles: Tile[], target: Tile): Tile[] {
  const idx = tiles.findIndex(t => tilesEqual(t, target));
  if (idx === -1) return tiles;
  const copy = [...tiles];
  copy.splice(idx, 1);
  return copy;
}

function removeTilesFromArray(tiles: Tile[], targets: Tile[]): Tile[] {
  let result = [...tiles];
  for (const target of targets) {
    result = removeTileFromArray(result, target);
  }
  return result;
}

function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return a.value - b.value;
  });
}

/** Check if a player still holds tiles of their declared-lack suit */
function hasLackSuitTiles(player: MahjongPlayer): boolean {
  if (!player.declared_lack) return false;
  return player.hand.some(t => t.suit === player.declared_lack);
}

// ─── Win Detection ───────────────────────────────────────────────────────────

/** Check if tiles can form a valid winning hand ((4-exposedCount) sets + 1 pair) */
function canWinStandard(tiles: Tile[], exposedSetCount: number = 0): boolean {
  const requiredSets = 4 - exposedSetCount;
  // Need exactly requiredSets * 3 + 2 concealed tiles (sets + pair)
  if (tiles.length !== requiredSets * 3 + 2) return false;

  // Try each possible pair
  const sorted = sortTiles(tiles);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (tilesEqual(sorted[i], sorted[i + 1])) {
      // Try using this as the pair
      const remaining = [...sorted];
      remaining.splice(i, 2);
      if (canFormSets(remaining)) return true;
      // Skip duplicate pairs
      while (i + 2 < sorted.length && tilesEqual(sorted[i], sorted[i + 2])) {
        i++;
      }
    }
  }
  return false;
}

/** Check if tiles can be decomposed into sets (sequences or triplets) */
function canFormSets(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;

  const sorted = sortTiles(tiles);

  // Try triplet with first tile
  if (sorted.length >= 3 && tilesEqual(sorted[0], sorted[1]) && tilesEqual(sorted[1], sorted[2])) {
    const remaining = sorted.slice(3);
    if (canFormSets(remaining)) return true;
  }

  // Try sequence with first tile
  const first = sorted[0];
  const second = sorted.find(t => t.suit === first.suit && t.value === first.value + 1);
  const third = sorted.find(t => t.suit === first.suit && t.value === first.value + 2);

  if (second && third) {
    let remaining = [...sorted];
    remaining = removeTileFromArray(remaining, first);
    remaining = removeTileFromArray(remaining, second);
    remaining = removeTileFromArray(remaining, third);
    if (canFormSets(remaining)) return true;
  }

  return false;
}

/** Check if tiles form seven pairs */
function isSevenPairs(tiles: Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const sorted = sortTiles(tiles);
  for (let i = 0; i < 14; i += 2) {
    if (!tilesEqual(sorted[i], sorted[i + 1])) return false;
  }
  return true;
}

/** Check if tiles form dragon seven pairs (七对 with a quad) */
function isDragonSevenPairs(tiles: Tile[]): boolean {
  if (!isSevenPairs(tiles)) return false;
  // Must have at least one group of 4 identical tiles
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const key = `${t.suit}-${t.value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= 4) return true;
  }
  return false;
}

/** Check if hand is all triplets (对对胡) */
function isAllTriplets(hand: Tile[], exposedSets: ExposedSet[]): boolean {
  // All exposed sets must be triplets or kongs
  for (const set of exposedSets) {
    if (set.type === SetType.Sequence) return false;
  }
  // The concealed part: must decompose into triplets + 1 pair
  if (hand.length % 3 !== 2) return false;
  const sorted = sortTiles(hand);
  // Try each pair
  for (let i = 0; i < sorted.length - 1; i++) {
    if (tilesEqual(sorted[i], sorted[i + 1])) {
      const remaining = [...sorted];
      remaining.splice(i, 2);
      if (allTripletSets(remaining)) return true;
      while (i + 2 < sorted.length && tilesEqual(sorted[i], sorted[i + 2])) i++;
    }
  }
  return false;
}

function allTripletSets(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;
  const sorted = sortTiles(tiles);
  if (sorted.length >= 3 && tilesEqual(sorted[0], sorted[1]) && tilesEqual(sorted[1], sorted[2])) {
    return allTripletSets(sorted.slice(3));
  }
  return false;
}

/** Check if hand is clean (清一色) — all tiles from a single suit */
function isCleanHand(hand: Tile[], exposedSets: ExposedSet[]): boolean {
  const allTiles: Tile[] = [...hand];
  for (const set of exposedSets) {
    allTiles.push(...set.tiles);
  }
  if (allTiles.length === 0) return false;
  const suit = allTiles[0].suit;
  return allTiles.every(t => t.suit === suit);
}

/** Check if hand is golden hook (金钩钓) — only the pair remains in hand, rest exposed */
function isGoldenHook(hand: Tile[], exposedSets: ExposedSet[]): boolean {
  // After winning, hand should have exactly 2 tiles (the pair)
  return hand.length === 2 && tilesEqual(hand[0], hand[1]) && exposedSets.length >= 4;
}

/** Check if hand is all concealed (门清) — no exposed sets */
function isAllConcealed(exposedSets: ExposedSet[]): boolean {
  // Concealed kongs are allowed for all-concealed
  return exposedSets.every(s => s.kong_type === KongType.Concealed);
}

/** Check if hand can form a winning hand (any pattern) */
function canWin(hand: Tile[], exposedSets: ExposedSet[]): boolean {
  // Seven pairs: only valid with no exposed sets (except concealed kongs)
  const nonConcealedKongs = exposedSets.filter(s => s.kong_type !== KongType.Concealed);
  if (nonConcealedKongs.length === 0 && isSevenPairs(hand)) return true;

  // Standard win: (4 - exposedCount) sets + 1 pair from concealed tiles
  return canWinStandard(hand, exposedSets.length);
}

/** Detect scoring patterns for a winning hand */
function detectPatterns(
  hand: Tile[],
  exposedSets: ExposedSet[],
): ScoringPattern[] {
  const patterns: ScoringPattern[] = [];

  // Check seven pairs variants first (mutually exclusive with standard patterns)
  const nonConcealedKongs = exposedSets.filter(s => s.kong_type !== KongType.Concealed);
  if (nonConcealedKongs.length === 0) {
    if (isDragonSevenPairs(hand)) {
      patterns.push(ScoringPattern.DragonSevenPairs);
    } else if (isSevenPairs(hand)) {
      patterns.push(ScoringPattern.SevenPairs);
    }
  }

  // If seven pairs detected, skip standard decomposition patterns
  if (patterns.length === 0) {
    if (isGoldenHook(hand, exposedSets)) {
      patterns.push(ScoringPattern.GoldenHook);
    } else if (isAllTriplets(hand, exposedSets)) {
      patterns.push(ScoringPattern.AllTriplets);
    } else {
      patterns.push(ScoringPattern.PingHu);
    }
  }

  // Clean hand can stack with any pattern
  if (isCleanHand(hand, exposedSets)) {
    patterns.push(ScoringPattern.CleanHand);
  }

  // All concealed can stack
  if (isAllConcealed(exposedSets)) {
    patterns.push(ScoringPattern.AllConcealed);
  }

  return patterns;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class MahjongEngine implements GameEngine<MahjongState, MahjongAgentView> {
  getMinPlayers(): number {
    return 4;
  }

  getMaxPlayers(): number {
    return 4;
  }

  // ── Initialize ───────────────────────────────────────────────────────────

  initialize(players: Player[], seed: number): MahjongState {
    if (players.length !== 4) {
      throw new Error(`Mahjong requires exactly 4 players, got ${players.length}`);
    }

    // Generate shuffled tiles
    const allTiles = createShuffledTileSet(seed);

    // Deal 13 tiles to each player, dealer gets 14
    const dealer = 0; // First player is dealer
    const mahjongPlayers: MahjongPlayer[] = players.map((p, i) => ({
      agent_id: p.id,
      seat: p.seat,
      hand: [],
      declared_lack: null,
      has_declared_lack: false,
      exposed_sets: [],
      discards: [],
      has_won: false,
      score: 0,
      consecutive_timeouts: 0,
      is_forfeited: false,
    }));

    let wallIdx = 0;
    // Deal 13 tiles to each player
    for (let i = 0; i < 4; i++) {
      mahjongPlayers[i].hand = allTiles.slice(wallIdx, wallIdx + 13);
      wallIdx += 13;
    }
    // Dealer draws 14th tile
    mahjongPlayers[dealer].hand.push(allTiles[wallIdx]);
    wallIdx++;

    // Remaining wall: split into front and back
    const remainingTiles = allTiles.slice(wallIdx);
    // Back of wall (for kong replacement draws) — take last 16 tiles
    const backCount = Math.min(16, remainingTiles.length);
    const wall = remainingTiles.slice(0, remainingTiles.length - backCount);
    const wallBack = remainingTiles.slice(remainingTiles.length - backCount);

    // Sort each player's hand for readability
    for (const p of mahjongPlayers) {
      p.hand = sortTiles(p.hand);
    }

    const state: MahjongState = {
      match_id: '', // Will be set by GameRoom
      phase: MahjongPhase.DeclareLacking,
      sub_phase: null,
      players: mahjongPlayers,
      wall,
      wall_back: wallBack,
      current_turn: dealer,
      dealer,
      turn_count: 0,
      winners: [],
      seed,
      current_discard: null,
      pending_add_kong: null,
      is_kong_replacement_draw: false,
      last_drawn_tile: null,
      win_events: [],
      kong_payments: [],
      settlements: [],
      action_timeout_ms: 30_000,
      base_points: 1,
      max_points: 256,
      last_action_at: Date.now(),
    };

    return state;
  }

  // ── Phase ────────────────────────────────────────────────────────────────

  getPhase(state: MahjongState): Phase {
    return {
      name: state.sub_phase ? `${state.phase}:${state.sub_phase}` : state.phase,
      turn: state.turn_count,
    };
  }

  // ── Agent View ───────────────────────────────────────────────────────────

  getAgentView(state: MahjongState, agentId: string): MahjongAgentView {
    const player = state.players.find(p => p.agent_id === agentId);
    if (!player) {
      throw new Error(`Agent ${agentId} not found in game`);
    }

    const actions = this.getAvailableActions(state, agentId);
    const actionOptions: ActionOption[] = actions.map(a => {
      const ma = a.data as MahjongAction;
      const opt: ActionOption = { type: ma.type };
      if (ma.tile) opt.tiles = [ma.tile];
      if (ma.kong_type) opt.kong_type = ma.kong_type;
      return opt;
    });

    return {
      match_id: state.match_id,
      phase: state.phase,
      sub_phase: state.sub_phase,
      your_seat: player.seat,
      your_hand: [...player.hand],
      your_declared_lack: player.declared_lack,
      declared_lacks: state.players.map(p => {
        // During declaration, hide others' choices until all declared
        if (state.phase === MahjongPhase.DeclareLacking && p.seat !== player.seat) {
          return p.has_declared_lack ? (null as Suit | null) : null;
        }
        return p.declared_lack;
      }),
      exposed_sets: state.players.map(p => [...p.exposed_sets]),
      discards: state.players.map(p => [...p.discards]),
      current_turn: state.current_turn,
      tiles_remaining: state.wall.length + state.wall_back.length,
      scores: state.players.map(p => p.score),
      winners: [...state.winners],
      current_discard: state.current_discard
        ? { tile: state.current_discard.tile, source_seat: state.current_discard.source_seat }
        : null,
      action_options: actionOptions.length > 0 ? actionOptions : undefined,
      win_events: [...state.win_events],
      kong_payments: [...state.kong_payments],
      turn_count: state.turn_count,
      is_finished: state.phase === MahjongPhase.Finished,
      settlements: state.phase === MahjongPhase.Finished ? [...state.settlements] : undefined,
    };
  }

  // ── Available Actions ────────────────────────────────────────────────────

  getAvailableActions(state: MahjongState, agentId: string): Action[] {
    const player = state.players.find(p => p.agent_id === agentId);
    if (!player) return [];

    // Forfeited or won players have no actions
    if (player.is_forfeited || player.has_won) return [];

    const actions: Action[] = [];

    // ── Declaration Phase ──
    if (state.phase === MahjongPhase.DeclareLacking) {
      if (!player.has_declared_lack) {
        // Player can declare any of the 3 suits to lack
        for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
          actions.push({
            type: MahjongActionType.DeclareLack,
            data: { type: MahjongActionType.DeclareLack, suit } as MahjongAction,
          });
        }
      }
      return actions;
    }

    // ── Playing Phase ──
    if (state.phase !== MahjongPhase.Playing) return [];

    // ── Pending Add Kong (抢杠胡 window) ──
    if (state.pending_add_kong) {
      const pak = state.pending_add_kong;
      if (pak.pending_responses.includes(player.seat)) {
        // Check if player can hu by robbing the kong
        if (this.canPlayerWin(state, player, pak.tile)) {
          actions.push({
            type: MahjongActionType.Hu,
            data: { type: MahjongActionType.Hu, tile: pak.tile } as MahjongAction,
          });
        }
        actions.push({
          type: MahjongActionType.Pass,
          data: { type: MahjongActionType.Pass } as MahjongAction,
        });
        return actions;
      }
      return [];
    }

    // ── Discard Reaction Window ──
    if (state.current_discard && state.sub_phase === PlaySubPhase.DiscardReaction) {
      const discard = state.current_discard;
      if (discard.pending_responses.includes(player.seat)) {
        const tile = discard.tile;

        // Hu (点炮) — highest priority
        if (this.canPlayerWin(state, player, tile)) {
          actions.push({
            type: MahjongActionType.Hu,
            data: { type: MahjongActionType.Hu, tile } as MahjongAction,
          });
        }

        // Block pong/kong if player still holds lacking-suit tiles
        const canMeld = !hasLackSuitTiles(player);

        // Kong (明杠) — player holds 3 of this tile
        if (canMeld && countTile(player.hand, tile) === 3) {
          actions.push({
            type: MahjongActionType.Kong,
            data: {
              type: MahjongActionType.Kong,
              tile,
              kong_type: KongType.Exposed,
            } as MahjongAction,
          });
        }

        // Pong (碰) — player holds 2 of this tile
        if (canMeld && countTile(player.hand, tile) >= 2) {
          actions.push({
            type: MahjongActionType.Pong,
            data: { type: MahjongActionType.Pong, tile } as MahjongAction,
          });
        }

        // Pass is always available
        actions.push({
          type: MahjongActionType.Pass,
          data: { type: MahjongActionType.Pass } as MahjongAction,
        });

        return actions;
      }
      return [];
    }

    // ── Active Player Turn ──
    if (state.current_turn !== player.seat) return [];

    if (state.sub_phase === PlaySubPhase.Draw) {
      // Player needs to draw
      actions.push({
        type: MahjongActionType.Draw,
        data: { type: MahjongActionType.Draw } as MahjongAction,
      });
      return actions;
    }

    if (state.sub_phase === PlaySubPhase.PostDraw) {
      // Check self-draw win (自摸)
      if (this.canPlayerSelfDrawWin(state, player)) {
        actions.push({
          type: MahjongActionType.Hu,
          data: { type: MahjongActionType.Hu } as MahjongAction,
        });
      }

      // Check for concealed kong (暗杠)
      const concealedKongs = this.findConcealedKongs(player);
      for (const tile of concealedKongs) {
        actions.push({
          type: MahjongActionType.Kong,
          data: {
            type: MahjongActionType.Kong,
            tile,
            kong_type: KongType.Concealed,
          } as MahjongAction,
        });
      }

      // Check for add kong (加杠)
      const addKongs = this.findAddKongs(player);
      for (const tile of addKongs) {
        actions.push({
          type: MahjongActionType.Kong,
          data: {
            type: MahjongActionType.Kong,
            tile,
            kong_type: KongType.Added,
          } as MahjongAction,
        });
      }

      // Player must discard — if still holding lacking-suit tiles, must discard those first
      const discardPool = hasLackSuitTiles(player)
        ? player.hand.filter(t => t.suit === player.declared_lack)
        : player.hand;
      for (const tile of getUniqueHandTiles(discardPool)) {
        actions.push({
          type: MahjongActionType.Discard,
          data: { type: MahjongActionType.Discard, tile } as MahjongAction,
        });
      }

      return actions;
    }

    return actions;
  }

  // ── Apply Action ─────────────────────────────────────────────────────────

  applyAction(state: MahjongState, agentId: string, action: Action): MahjongState {
    const mahjongAction = action.data as MahjongAction;
    const player = state.players.find(p => p.agent_id === agentId);
    if (!player) {
      throw new Error(`Agent ${agentId} not found in game`);
    }

    // Deep clone state to avoid mutation
    const newState = deepCloneState(state);
    const p = newState.players[player.seat];

    switch (mahjongAction.type) {
      case MahjongActionType.DeclareLack:
        return this.handleDeclareLack(newState, p, mahjongAction);
      case MahjongActionType.Draw:
        return this.handleDraw(newState, p);
      case MahjongActionType.Discard:
        return this.handleDiscard(newState, p, mahjongAction);
      case MahjongActionType.Pong:
        return this.handlePong(newState, p, mahjongAction);
      case MahjongActionType.Kong:
        return this.handleKong(newState, p, mahjongAction);
      case MahjongActionType.Hu:
        return this.handleHu(newState, p, mahjongAction);
      case MahjongActionType.Pass:
        return this.handlePass(newState, p);
      default:
        throw new Error(`Unknown action type: ${mahjongAction.type}`);
    }
  }

  // ── Is Finished ──────────────────────────────────────────────────────────

  isFinished(state: MahjongState): boolean {
    return state.phase === MahjongPhase.Finished;
  }

  // ── Get Results ──────────────────────────────────────────────────────────

  getResults(state: MahjongState): MatchResult {
    if (state.phase !== MahjongPhase.Finished) {
      throw new Error('Cannot get results: game is not finished');
    }

    return {
      results: state.settlements.map(s => ({
        agent_id: s.agent_id,
        result: s.result,
      })),
    };
  }

  // ─── Private: Action Handlers ──────────────────────────────────────────

  private handleDeclareLack(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (state.phase !== MahjongPhase.DeclareLacking) {
      throw new Error('Cannot declare lack outside of declaration phase');
    }
    if (player.has_declared_lack) {
      throw new Error('Player has already declared lack');
    }
    if (!action.suit) {
      throw new Error('Must specify suit to declare lack');
    }

    player.declared_lack = action.suit;
    player.has_declared_lack = true;
    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    // Check if all players have declared
    const allDeclared = state.players.every(p => p.has_declared_lack || p.has_won || p.is_forfeited);
    if (allDeclared) {
      // Transition to playing phase
      state.phase = MahjongPhase.Playing;
      // Dealer already has 14 tiles, so they are in PostDraw sub-phase
      state.sub_phase = PlaySubPhase.PostDraw;
      state.current_turn = state.dealer;
    }

    return state;
  }

  private handleDraw(state: MahjongState, player: MahjongPlayer): MahjongState {
    if (state.sub_phase !== PlaySubPhase.Draw) {
      throw new Error('Cannot draw in current sub-phase');
    }
    if (state.current_turn !== player.seat) {
      throw new Error('Not your turn to draw');
    }

    // Check for wall exhaustion
    if (state.wall.length === 0 && state.wall_back.length === 0) {
      return this.handleWallExhaustion(state);
    }

    // Draw from the front of the wall
    const tile = state.wall.shift()!;
    player.hand.push(tile);
    player.hand = sortTiles(player.hand);
    state.last_drawn_tile = tile;
    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    // Move to post-draw
    state.sub_phase = PlaySubPhase.PostDraw;
    state.is_kong_replacement_draw = false;

    return state;
  }

  private handleDiscard(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (state.sub_phase !== PlaySubPhase.PostDraw) {
      throw new Error('Cannot discard in current sub-phase');
    }
    if (state.current_turn !== player.seat) {
      throw new Error('Not your turn');
    }
    if (!action.tile) {
      throw new Error('Must specify tile to discard');
    }

    const tile = action.tile;

    // Validate tile is in hand
    if (countTile(player.hand, tile) === 0) {
      throw new Error('Tile not in hand');
    }

    // Remove tile from hand
    player.hand = removeTileFromArray(player.hand, tile);
    player.discards.push(tile);
    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();
    state.is_kong_replacement_draw = false;
    state.turn_count++;

    // Check who can react to this discard
    const responders = this.getDiscardResponders(state, player.seat, tile);

    if (responders.length > 0) {
      // Open reaction window
      state.sub_phase = PlaySubPhase.DiscardReaction;
      state.current_discard = {
        tile,
        source_seat: player.seat,
        pending_responses: responders,
        claims: [],
        started_at: Date.now(),
      };
    } else {
      // No one can react — next player's turn
      state.current_discard = null;
      this.advanceToNextPlayer(state);
    }

    return state;
  }

  private handlePong(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (!state.current_discard) {
      throw new Error('No discard to pong');
    }

    const discard = state.current_discard;
    if (!discard.pending_responses.includes(player.seat)) {
      throw new Error('Not your turn to respond to discard');
    }

    const tile = discard.tile;
    if (countTile(player.hand, tile) < 2) {
      throw new Error('Need at least 2 matching tiles to pong');
    }

    // Register claim
    discard.claims.push({
      seat: player.seat,
      action: MahjongActionType.Pong,
      tiles: player.hand.filter(t => tilesEqual(t, tile)).slice(0, 2),
    });
    discard.pending_responses = discard.pending_responses.filter(s => s !== player.seat);

    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    // Try to resolve claims
    return this.resolveDiscardClaims(state);
  }

  private handleKong(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (!action.kong_type) {
      throw new Error('Must specify kong type');
    }

    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    switch (action.kong_type) {
      case KongType.Exposed:
        return this.handleExposedKong(state, player, action);
      case KongType.Concealed:
        return this.handleConcealedKong(state, player, action);
      case KongType.Added:
        return this.handleAddKong(state, player, action);
      default:
        throw new Error(`Unknown kong type: ${action.kong_type}`);
    }
  }

  private handleExposedKong(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (!state.current_discard) {
      throw new Error('No discard to kong');
    }

    const discard = state.current_discard;
    if (!discard.pending_responses.includes(player.seat)) {
      throw new Error('Not your turn to respond to discard');
    }

    const tile = discard.tile;
    if (countTile(player.hand, tile) < 3) {
      throw new Error('Need 3 matching tiles to exposed kong');
    }

    // Register claim
    discard.claims.push({
      seat: player.seat,
      action: MahjongActionType.Kong,
      tiles: player.hand.filter(t => tilesEqual(t, tile)).slice(0, 3),
    });
    discard.pending_responses = discard.pending_responses.filter(s => s !== player.seat);

    return this.resolveDiscardClaims(state);
  }

  private handleConcealedKong(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (state.sub_phase !== PlaySubPhase.PostDraw || state.current_turn !== player.seat) {
      throw new Error('Can only declare concealed kong after drawing');
    }
    if (!action.tile) {
      throw new Error('Must specify tile for concealed kong');
    }

    const tile = action.tile;
    if (countTile(player.hand, tile) < 4) {
      throw new Error('Need 4 matching tiles for concealed kong');
    }

    // Remove 4 tiles from hand
    const kongTiles = player.hand.filter(t => tilesEqual(t, tile)).slice(0, 4);
    player.hand = removeTilesFromArray(player.hand, kongTiles);

    // Add exposed set
    player.exposed_sets.push({
      type: SetType.Kong,
      tiles: kongTiles,
      kong_type: KongType.Concealed,
    });

    // Kong payment: each of the other 3 active players pays 2
    const payers = this.getActivePlayerSeats(state).filter(s => s !== player.seat);
    const payment: KongPayment = {
      declarer_seat: player.seat,
      kong_type: KongType.Concealed,
      points_per_payer: KONG_PAYMENTS.concealed,
      payer_seats: payers,
    };
    this.applyKongPayment(state, payment);

    // Draw replacement tile from back of wall
    return this.drawReplacementTile(state, player);
  }

  private handleAddKong(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    if (state.sub_phase !== PlaySubPhase.PostDraw || state.current_turn !== player.seat) {
      throw new Error('Can only declare add kong after drawing');
    }
    if (!action.tile) {
      throw new Error('Must specify tile for add kong');
    }

    const tile = action.tile;

    // Find matching pong
    const pongIdx = player.exposed_sets.findIndex(
      s => s.type === SetType.Triplet && tilesEqual(s.tiles[0], tile),
    );
    if (pongIdx === -1) {
      throw new Error('No matching pong to add kong');
    }
    if (countTile(player.hand, tile) < 1) {
      throw new Error('Tile not in hand');
    }

    // Check for 抢杠胡 (robbing kong) — other players might be able to win
    const robbers = this.getRobbingKongResponders(state, player.seat, tile);

    if (robbers.length > 0) {
      // Open robbing kong window
      state.pending_add_kong = {
        tile,
        seat: player.seat,
        pending_responses: robbers,
        claims: [],
        started_at: Date.now(),
      };
      return state;
    }

    // No one can rob — complete the add kong
    return this.completeAddKong(state, player, tile, pongIdx);
  }

  private completeAddKong(
    state: MahjongState,
    player: MahjongPlayer,
    tile: Tile,
    pongIdx: number,
  ): MahjongState {
    // Remove tile from hand
    player.hand = removeTileFromArray(player.hand, tile);

    // Upgrade pong to kong
    player.exposed_sets[pongIdx] = {
      type: SetType.Kong,
      tiles: [...player.exposed_sets[pongIdx].tiles, tile],
      kong_type: KongType.Added,
      source_seat: player.exposed_sets[pongIdx].source_seat,
    };

    // Kong payment: each of the other 3 active players pays 1
    const payers = this.getActivePlayerSeats(state).filter(s => s !== player.seat);
    const payment: KongPayment = {
      declarer_seat: player.seat,
      kong_type: KongType.Added,
      points_per_payer: KONG_PAYMENTS.added,
      payer_seats: payers,
    };
    this.applyKongPayment(state, payment);

    state.pending_add_kong = null;

    // Draw replacement tile from back of wall
    return this.drawReplacementTile(state, player);
  }

  private handleHu(
    state: MahjongState,
    player: MahjongPlayer,
    action: MahjongAction,
  ): MahjongState {
    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    // ── Robbing Kong Hu (抢杠胡) ──
    if (state.pending_add_kong) {
      const pak = state.pending_add_kong;
      if (!pak.pending_responses.includes(player.seat)) {
        throw new Error('Not your turn to respond to add kong');
      }

      // Register hu claim
      pak.claims.push({
        seat: player.seat,
        action: MahjongActionType.Hu,
      });
      pak.pending_responses = pak.pending_responses.filter(s => s !== player.seat);

      return this.resolveAddKongClaims(state);
    }

    // ── Discard Win (点炮) ──
    if (state.current_discard) {
      const discard = state.current_discard;
      if (!discard.pending_responses.includes(player.seat)) {
        throw new Error('Not your turn to respond to discard');
      }

      // Register hu claim
      discard.claims.push({
        seat: player.seat,
        action: MahjongActionType.Hu,
      });
      discard.pending_responses = discard.pending_responses.filter(s => s !== player.seat);

      return this.resolveDiscardClaims(state);
    }

    // ── Self-Draw Win (自摸) ──
    if (state.sub_phase !== PlaySubPhase.PostDraw || state.current_turn !== player.seat) {
      throw new Error('Cannot declare self-draw win');
    }

    if (!this.canPlayerSelfDrawWin(state, player)) {
      throw new Error('Hand is not a winning hand');
    }

    // Determine bonuses
    const bonuses: BonusFan[] = [BonusFan.SelfDraw];
    if (state.is_kong_replacement_draw) {
      bonuses.push(BonusFan.KongDraw);
    }
    if (state.wall.length === 0 && state.wall_back.length === 0) {
      bonuses.push(BonusFan.LastTile);
    }

    const patterns = detectPatterns(player.hand, player.exposed_sets);
    const result = scoreHand(patterns, bonuses, state.base_points, state.max_points);

    // Self-draw: all remaining active players pay
    const payers = this.getActivePlayerSeats(state).filter(s => s !== player.seat);

    const winEvent: WinEvent = {
      winner_seat: player.seat,
      payer_seats: payers,
      points_per_payer: result.points,
      win_type: 'self_draw',
      winning_tile: state.last_drawn_tile ?? player.hand[player.hand.length - 1],
      fan_breakdown: [
        ...result.appliedPatterns.map(p => ({ pattern: p, fan: PATTERN_FAN[p] })),
        ...result.appliedBonuses.map(b => ({ pattern: b, fan: BONUS_FAN_VALUE[b] })),
      ],
      total_fan: result.totalFan,
      is_kong_draw: bonuses.includes(BonusFan.KongDraw),
      is_robbing_kong: false,
      is_last_tile: bonuses.includes(BonusFan.LastTile),
    };

    // Apply win settlement
    this.applyWinSettlement(state, winEvent);

    // Blood battle: check if game continues
    return this.checkBloodBattle(state);
  }

  private handlePass(state: MahjongState, player: MahjongPlayer): MahjongState {
    player.consecutive_timeouts = 0;
    state.last_action_at = Date.now();

    // ── Pass on robbing kong ──
    if (state.pending_add_kong) {
      const pak = state.pending_add_kong;
      if (!pak.pending_responses.includes(player.seat)) {
        throw new Error('Not your turn to respond to add kong');
      }
      pak.pending_responses = pak.pending_responses.filter(s => s !== player.seat);

      return this.resolveAddKongClaims(state);
    }

    // ── Pass on discard reaction ──
    if (state.current_discard) {
      const discard = state.current_discard;
      if (!discard.pending_responses.includes(player.seat)) {
        throw new Error('Not your turn to respond');
      }
      discard.pending_responses = discard.pending_responses.filter(s => s !== player.seat);

      return this.resolveDiscardClaims(state);
    }

    throw new Error('Nothing to pass on');
  }

  // ─── Private: Claim Resolution ─────────────────────────────────────────

  private resolveDiscardClaims(state: MahjongState): MahjongState {
    const discard = state.current_discard;
    if (!discard) return state;

    // If there are still pending responses, wait
    if (discard.pending_responses.length > 0) return state;

    // All responses received — resolve by priority: hu > kong > pong
    const huClaims = discard.claims.filter(c => c.action === MahjongActionType.Hu);
    const kongClaims = discard.claims.filter(c => c.action === MahjongActionType.Kong);
    const pongClaims = discard.claims.filter(c => c.action === MahjongActionType.Pong);

    // Hu has highest priority (multiple hu possible in blood battle)
    if (huClaims.length > 0) {
      // In blood battle, all hu claims win (multiple 点炮)
      for (const claim of huClaims) {
        const winner = state.players[claim.seat];
        if (winner.has_won) continue;

        // Add the discard tile to winner's hand for scoring
        winner.hand.push(discard.tile);
        winner.hand = sortTiles(winner.hand);

        const bonuses: BonusFan[] = [];
        if (state.wall.length === 0 && state.wall_back.length === 0) {
          bonuses.push(BonusFan.LastTile);
        }

        const patterns = detectPatterns(winner.hand, winner.exposed_sets);
        const result = scoreHand(patterns, bonuses, state.base_points, state.max_points);

        const winEvent: WinEvent = {
          winner_seat: winner.seat,
          payer_seats: [discard.source_seat],
          points_per_payer: result.points,
          win_type: 'discard',
          winning_tile: discard.tile,
          fan_breakdown: [
            ...result.appliedPatterns.map(p => ({ pattern: p, fan: PATTERN_FAN[p] })),
            ...result.appliedBonuses.map(b => ({ pattern: b, fan: BONUS_FAN_VALUE[b] })),
          ],
          total_fan: result.totalFan,
          is_kong_draw: false,
          is_robbing_kong: false,
          is_last_tile: bonuses.includes(BonusFan.LastTile),
        };

        this.applyWinSettlement(state, winEvent);
      }

      state.current_discard = null;
      return this.checkBloodBattle(state);
    }

    // Kong — only one player can kong a discard (closest in turn order)
    if (kongClaims.length > 0) {
      const claim = this.pickClosestClaim(kongClaims, discard.source_seat);
      const claimer = state.players[claim.seat];

      // Execute exposed kong
      const kongTiles = claimer.hand.filter(t => tilesEqual(t, discard.tile)).slice(0, 3);
      claimer.hand = removeTilesFromArray(claimer.hand, kongTiles);

      claimer.exposed_sets.push({
        type: SetType.Kong,
        tiles: [...kongTiles, discard.tile],
        kong_type: KongType.Exposed,
        source_seat: discard.source_seat,
      });

      // Kong payment: discarder pays 1
      const payment: KongPayment = {
        declarer_seat: claimer.seat,
        kong_type: KongType.Exposed,
        source_seat: discard.source_seat,
        points_per_payer: KONG_PAYMENTS.exposed,
        payer_seats: [discard.source_seat],
      };
      this.applyKongPayment(state, payment);

      state.current_discard = null;
      state.current_turn = claimer.seat;

      // Draw replacement tile from back of wall
      return this.drawReplacementTile(state, claimer);
    }

    // Pong — only one player can pong (closest to discarder in turn order)
    if (pongClaims.length > 0) {
      // Pick the pong closest in turn order to the discarder
      const claim = this.pickClosestClaim(pongClaims, discard.source_seat);
      const claimer = state.players[claim.seat];

      // Execute pong
      const pongTiles = claimer.hand.filter(t => tilesEqual(t, discard.tile)).slice(0, 2);
      claimer.hand = removeTilesFromArray(claimer.hand, pongTiles);

      claimer.exposed_sets.push({
        type: SetType.Triplet,
        tiles: [...pongTiles, discard.tile],
        source_seat: discard.source_seat,
      });

      state.current_discard = null;
      state.current_turn = claimer.seat;
      state.sub_phase = PlaySubPhase.PostDraw;
      // After pong, player discards (no draw)

      return state;
    }

    // No claims — advance to next player
    state.current_discard = null;
    this.advanceToNextPlayer(state);

    return state;
  }

  private resolveAddKongClaims(state: MahjongState): MahjongState {
    const pak = state.pending_add_kong;
    if (!pak) return state;

    // If there are still pending responses, wait
    if (pak.pending_responses.length > 0) return state;

    const huClaims = pak.claims.filter(c => c.action === MahjongActionType.Hu);

    if (huClaims.length > 0) {
      // Robbing kong! The add-kong is cancelled.
      for (const claim of huClaims) {
        const winner = state.players[claim.seat];
        if (winner.has_won) continue;

        // Add the kong tile to winner's hand for scoring
        winner.hand.push(pak.tile);
        winner.hand = sortTiles(winner.hand);

        const bonuses: BonusFan[] = [BonusFan.RobbingKong];

        const patterns = detectPatterns(winner.hand, winner.exposed_sets);
        const result = scoreHand(patterns, bonuses, state.base_points, state.max_points);

        const winEvent: WinEvent = {
          winner_seat: winner.seat,
          payer_seats: [pak.seat],
          points_per_payer: result.points,
          win_type: 'discard',
          winning_tile: pak.tile,
          fan_breakdown: [
            ...result.appliedPatterns.map(p => ({ pattern: p, fan: PATTERN_FAN[p] })),
            ...result.appliedBonuses.map(b => ({ pattern: b, fan: BONUS_FAN_VALUE[b] })),
          ],
          total_fan: result.totalFan,
          is_kong_draw: false,
          is_robbing_kong: true,
          is_last_tile: false,
        };

        this.applyWinSettlement(state, winEvent);
      }

      // Remove the tile from the kong player's hand (they didn't complete the kong)
      // The tile stays in hand, the pong stays as pong
      state.pending_add_kong = null;
      return this.checkBloodBattle(state);
    }

    // No one robbed — complete the add kong
    const kongPlayer = state.players[pak.seat];
    const pongIdx = kongPlayer.exposed_sets.findIndex(
      s => s.type === SetType.Triplet && tilesEqual(s.tiles[0], pak.tile),
    );

    state.pending_add_kong = null;

    if (pongIdx !== -1) {
      return this.completeAddKong(state, kongPlayer, pak.tile, pongIdx);
    }

    // Shouldn't happen, but fallback
    return state;
  }

  // ─── Private: Helpers ──────────────────────────────────────────────────

  /** Check if a player can win with the given tile (from discard or robbing kong) */
  private canPlayerWin(state: MahjongState, player: MahjongPlayer, tile: Tile): boolean {
    if (player.has_won || player.is_forfeited) return false;

    // Must have discarded all tiles of declared lack suit
    const testHand = [...player.hand, tile];
    if (player.declared_lack && testHand.some(t => t.suit === player.declared_lack)) {
      return false;
    }

    return canWin(testHand, player.exposed_sets);
  }

  /** Check if the current player can win by self-draw */
  private canPlayerSelfDrawWin(state: MahjongState, player: MahjongPlayer): boolean {
    if (player.has_won || player.is_forfeited) return false;

    // Must have discarded all tiles of declared lack suit
    if (hasLackSuitTiles(player)) return false;

    return canWin(player.hand, player.exposed_sets);
  }

  /** Find tiles that can form a concealed kong */
  private findConcealedKongs(player: MahjongPlayer): Tile[] {
    const kongs: Tile[] = [];
    const seen = new Set<string>();

    for (const tile of player.hand) {
      const key = `${tile.suit}-${tile.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (countTile(player.hand, tile) >= 4) {
        kongs.push(tile);
      }
    }

    return kongs;
  }

  /** Find tiles that can form an add kong */
  private findAddKongs(player: MahjongPlayer): Tile[] {
    const addKongs: Tile[] = [];

    for (const set of player.exposed_sets) {
      if (set.type === SetType.Triplet) {
        const tile = set.tiles[0];
        if (countTile(player.hand, tile) >= 1) {
          addKongs.push(tile);
        }
      }
    }

    return addKongs;
  }

  /** Get seats of players who can respond to a discard */
  private getDiscardResponders(state: MahjongState, discardSeat: number, tile: Tile): number[] {
    const responders: number[] = [];

    for (const p of state.players) {
      if (p.seat === discardSeat || p.has_won || p.is_forfeited) continue;

      let canRespond = false;

      // Can hu?
      if (this.canPlayerWin(state, p, tile)) canRespond = true;

      // Can kong? (3 in hand)
      if (countTile(p.hand, tile) >= 3) canRespond = true;

      // Can pong? (2 in hand)
      if (countTile(p.hand, tile) >= 2) canRespond = true;

      if (canRespond) responders.push(p.seat);
    }

    return responders;
  }

  /** Get seats of players who can rob a kong */
  private getRobbingKongResponders(state: MahjongState, kongSeat: number, tile: Tile): number[] {
    const responders: number[] = [];

    for (const p of state.players) {
      if (p.seat === kongSeat || p.has_won || p.is_forfeited) continue;

      if (this.canPlayerWin(state, p, tile)) {
        responders.push(p.seat);
      }
    }

    return responders;
  }

  /** Get seats of active (non-won, non-forfeited) players */
  private getActivePlayerSeats(state: MahjongState): number[] {
    return state.players
      .filter(p => !p.has_won && !p.is_forfeited)
      .map(p => p.seat);
  }

  /** Pick the claim closest in turn order after the discarder */
  private pickClosestClaim(claims: PendingClaim[], sourceSeat: number): PendingClaim {
    // Sort by distance in turn order from source
    return claims.sort((a, b) => {
      const distA = (a.seat - sourceSeat + 4) % 4;
      const distB = (b.seat - sourceSeat + 4) % 4;
      return distA - distB;
    })[0];
  }

  /** Apply a win settlement */
  private applyWinSettlement(state: MahjongState, winEvent: WinEvent): void {
    const winner = state.players[winEvent.winner_seat];
    winner.has_won = true;
    state.winners.push(winner.seat);

    for (const payerSeat of winEvent.payer_seats) {
      const payer = state.players[payerSeat];
      if (payer.has_won || payer.is_forfeited) continue;
      payer.score -= winEvent.points_per_payer;
      winner.score += winEvent.points_per_payer;
    }

    state.win_events.push(winEvent);
  }

  /** Apply a kong payment */
  private applyKongPayment(state: MahjongState, payment: KongPayment): void {
    const declarer = state.players[payment.declarer_seat];

    for (const payerSeat of payment.payer_seats) {
      const payer = state.players[payerSeat];
      if (payer.has_won || payer.is_forfeited) continue;
      payer.score -= payment.points_per_payer;
      declarer.score += payment.points_per_payer;
    }

    state.kong_payments.push(payment);
  }

  /** Draw a replacement tile from the back of the wall after kong */
  private drawReplacementTile(state: MahjongState, player: MahjongPlayer): MahjongState {
    if (state.wall_back.length === 0 && state.wall.length === 0) {
      return this.handleWallExhaustion(state);
    }

    // Draw from the back of the wall
    const source = state.wall_back.length > 0 ? state.wall_back : state.wall;
    const tile = source.pop()!;
    player.hand.push(tile);
    player.hand = sortTiles(player.hand);
    state.last_drawn_tile = tile;

    state.sub_phase = PlaySubPhase.PostDraw;
    state.is_kong_replacement_draw = true;

    return state;
  }

  /** Advance to the next active player */
  private advanceToNextPlayer(state: MahjongState): void {
    let next = (state.current_turn + 1) % 4;
    let attempts = 0;

    while (attempts < 4) {
      const player = state.players[next];
      if (!player.has_won && !player.is_forfeited) {
        state.current_turn = next;
        state.sub_phase = PlaySubPhase.Draw;
        return;
      }
      next = (next + 1) % 4;
      attempts++;
    }

    // All players done — shouldn't normally happen, handled by checkBloodBattle
    this.handleWallExhaustion(state);
  }

  /** Check blood battle mode: if game should continue or end */
  private checkBloodBattle(state: MahjongState): MahjongState {
    const activePlayers = this.getActivePlayerSeats(state);

    // Game ends when only 1 player remains (the loser)
    if (activePlayers.length <= 1) {
      return this.finishGame(state);
    }

    // Game continues — advance to next active player
    // Clear discard state
    state.current_discard = null;

    // Find next active player after current turn
    this.advanceToNextPlayer(state);

    // Check wall exhaustion
    if (state.wall.length === 0 && state.wall_back.length === 0) {
      return this.handleWallExhaustion(state);
    }

    return state;
  }

  /** Handle wall exhaustion — game ends with remaining players as losers */
  private handleWallExhaustion(state: MahjongState): MahjongState {
    return this.finishGame(state);
  }

  /** Finish the game and compute settlements */
  private finishGame(state: MahjongState): MahjongState {
    state.phase = MahjongPhase.Finished;
    state.sub_phase = null;
    state.current_discard = null;
    state.pending_add_kong = null;

    // Build settlements
    const settlements: Settlement[] = [];
    let finishOrder = state.winners.length;

    for (const p of state.players) {
      let order: number;
      let result: 'win' | 'lose' | 'draw';

      if (p.has_won) {
        order = state.winners.indexOf(p.seat) + 1;
        result = 'win';
      } else {
        finishOrder++;
        order = finishOrder;
        // Wall exhaustion (流局): remaining players are 'draw', not 'lose'
        // They only 'lose' if all other players have won (blood battle fully resolved)
        const isWallExhaustion = state.wall.length === 0 && state.wall_back.length === 0;
        result = isWallExhaustion ? 'draw' : 'lose';
      }

      settlements.push({
        agent_id: p.agent_id,
        seat: p.seat,
        final_score: p.score,
        finish_order: order,
        result,
      });
    }

    state.settlements = settlements;
    return state;
  }

  // ─── Public: Auto-action for timeouts ──────────────────────────────────

  /** Generate a default action for timeout situations */
  getTimeoutAction(state: MahjongState, agentId: string): Action | null {
    const player = state.players.find(p => p.agent_id === agentId);
    if (!player) return null;

    // Declaration phase: auto-declare the suit with fewest tiles
    if (state.phase === MahjongPhase.DeclareLacking && !player.has_declared_lack) {
      const suitCounts = new Map<Suit, number>();
      for (const suit of [Suit.Bamboo, Suit.Dots, Suit.Characters]) {
        suitCounts.set(suit, player.hand.filter(t => t.suit === suit).length);
      }
      let minSuit = Suit.Bamboo;
      let minCount = Infinity;
      for (const [suit, count] of suitCounts) {
        if (count < minCount) {
          minCount = count;
          minSuit = suit;
        }
      }
      return {
        type: MahjongActionType.DeclareLack,
        data: { type: MahjongActionType.DeclareLack, suit: minSuit } as MahjongAction,
      };
    }

    // Discard reaction or robbing kong: auto-pass
    if (state.current_discard?.pending_responses.includes(player.seat) ||
        state.pending_add_kong?.pending_responses.includes(player.seat)) {
      return {
        type: MahjongActionType.Pass,
        data: { type: MahjongActionType.Pass } as MahjongAction,
      };
    }

    // Active player turn
    if (state.current_turn === player.seat) {
      if (state.sub_phase === PlaySubPhase.Draw) {
        return {
          type: MahjongActionType.Draw,
          data: { type: MahjongActionType.Draw } as MahjongAction,
        };
      }
      if (state.sub_phase === PlaySubPhase.PostDraw) {
        // Auto-discard: discard a tile from the declared lack suit if possible,
        // otherwise discard the last tile in hand
        let tileToDiscard: Tile | undefined;
        if (player.declared_lack) {
          tileToDiscard = player.hand.find(t => t.suit === player.declared_lack);
        }
        if (!tileToDiscard) {
          tileToDiscard = player.hand[player.hand.length - 1];
        }
        if (tileToDiscard) {
          return {
            type: MahjongActionType.Discard,
            data: { type: MahjongActionType.Discard, tile: tileToDiscard } as MahjongAction,
          };
        }
      }
    }

    return null;
  }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/** Get unique tiles from a hand (for listing discard options) */
function getUniqueHandTiles(hand: Tile[]): Tile[] {
  const seen = new Set<string>();
  const unique: Tile[] = [];
  for (const tile of hand) {
    const key = `${tile.suit}-${tile.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(tile);
    }
  }
  return unique;
}

/** Deep clone a MahjongState */
function deepCloneState(state: MahjongState): MahjongState {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      hand: [...p.hand],
      exposed_sets: p.exposed_sets.map(s => ({ ...s, tiles: [...s.tiles] })),
      discards: [...p.discards],
    })),
    wall: [...state.wall],
    wall_back: [...state.wall_back],
    winners: [...state.winners],
    current_discard: state.current_discard
      ? {
          ...state.current_discard,
          pending_responses: [...state.current_discard.pending_responses],
          claims: state.current_discard.claims.map(c => ({ ...c, tiles: c.tiles ? [...c.tiles] : undefined })),
        }
      : null,
    pending_add_kong: state.pending_add_kong
      ? {
          ...state.pending_add_kong,
          pending_responses: [...state.pending_add_kong.pending_responses],
          claims: state.pending_add_kong.claims.map(c => ({ ...c })),
        }
      : null,
    win_events: [...state.win_events],
    kong_payments: [...state.kong_payments],
    settlements: [...state.settlements],
  };
}
