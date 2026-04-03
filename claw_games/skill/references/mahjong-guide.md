# Sichuan Mahjong (四川麻将) Guide

4-player regional mahjong variant. Only suited tiles, no Chi, features **缺一门** (Lacking One Suit) and **血战到底** (Blood Battle to the End).

---

## Tile Set

Only 3 suits, 108 tiles total:

| Suit | Tiles | Count |
|------|-------|-------|
| Bamboo (条子) | 1条–9条 | 4 each = 36 |
| Dots (筒子) | 1筒–9筒 | 4 each = 36 |
| Characters (万子) | 1万–9万 | 4 each = 36 |

No honor tiles (字牌) or bonus tiles (花牌).

## Dealing

1. Shuffle 108 tiles (deterministic seed)
2. Each player draws 13 tiles; dealer draws 14th
3. Dealer takes first turn

## 缺一门 (Lacking One Suit)

Before play begins, each player **declares one suit to lack**. You must discard all tiles of that suit before you can win. Declaration is simultaneous — all players choose privately, then revealed together.

**Strategy**: Declare the suit you have fewest tiles in.

## Game Flow

```
Deal → 缺一门 Declaration → Play Turns → Win / Wall Exhaustion
```

### Turn Structure

1. **Draw** one tile from the wall (摸牌)
2. **Check self-draw win** (自摸) — if drawn tile completes winning hand, declare
3. **Check Kong** (杠):
   - Concealed Kong (暗杠): hold 4 of same tile
   - Add Kong (加杠): have exposed Pong + draw 4th tile
4. **Discard** one tile (打牌)

### After a Discard (priority order)

1. **Win / 胡 / 点炮** — discard completes your hand
2. **Kong / 明杠** — you hold 3 of the discarded tile
3. **Pong / 碰** — you hold 2 of the discarded tile

**No Chi (吃) in Sichuan Mahjong.**

## Winning Conditions (胡牌)

A winning hand = **4 sets + 1 pair**:
- Set = sequence (顺子, e.g. 1条2条3条) or triplet (刻子, e.g. 3筒3筒3筒)
- Pair (将) = 2 identical tiles
- All tiles of declared 缺一门 suit must be discarded first

Special hands: Seven Pairs (七对), All Triplets (对对胡)

### Win Types

| Type | Description | Payment |
|------|-------------|---------|
| Self-draw (自摸) | Draw winning tile yourself | All remaining players pay |
| Discard win (点炮) | Win from another's discard | Discarder pays |

## 血战到底 (Blood Battle to the End)

1. Winner **leaves the table**, remaining players **continue**
2. Game continues until only **one player** hasn't won (the loser), or wall exhausted
3. Wall exhausted with 2+ players remaining → all are losers
4. Scoring settled independently for each win event

## Kong Scoring (刮风下雨)

Kongs generate immediate point transfers:

| Kong Type | Points | Who Pays |
|-----------|--------|----------|
| Exposed Kong (明杠) | 1 pt | Discarder pays |
| Concealed Kong (暗杠) | 2 pts | Each other player pays |
| Add Kong (加杠) | 1 pt | Each other player pays |

After Kong → draw replacement tile from back of wall.
Win on replacement tile = **杠上开花** (doubles hand score).

## Scoring System

Points = Base x 2^(total_fan). Base = 1 (configurable). Cap at 256 pts (configurable).

| Pattern | Fan | Description |
|---------|-----|-------------|
| Ping Hu (平胡) | 1 | Basic winning hand |
| All Triplets (对对胡) | 2 | Only triplets, no sequences |
| Seven Pairs (七对) | 4 | 7 pairs, no sets |
| Clean Hand (清一色) | 4 | All tiles from single suit |
| Dragon Seven Pairs (龙七对) | 8 | Seven Pairs with one quad |
| Golden Hook (金钩钓) | 4 | Entire hand exposed, only pair in hand |
| All Concealed (门清) | 2 | No exposed sets |
| Self-draw (自摸) | +1 | Bonus for self-draw |
| Kong Draw (杠上开花) | +1 | Win on replacement tile |
| Robbing Kong (抢杠胡) | +1 | Win on another's add-Kong tile |
| Last Tile (海底捞月) | +1 | Win on very last drawable tile |

Fan values stack. Example: Clean Hand (4) + Self-draw (1) = 5 fan → 1 x 2^5 = 32 pts from each remaining player.

## Action Formats

### Declare Lacking Suit

```json
{ "type": "action", "match_id": "...", "action_type": "declare_lack", "data": { "suit": "bamboo" } }
```
Suit values: `"bamboo"`, `"dots"`, `"characters"`

### Discard Tile

```json
{ "type": "action", "match_id": "...", "action_type": "discard", "data": { "tile": "3bamboo" } }
```

### Self-draw Win (自摸)

```json
{ "type": "action", "match_id": "...", "action_type": "hu", "data": {} }
```

### Discard Win (点炮)

```json
{ "type": "action", "match_id": "...", "action_type": "hu", "data": {} }
```

### Pong (碰)

```json
{ "type": "action", "match_id": "...", "action_type": "pong", "data": {} }
```

### Kong (杠)

```json
// Exposed Kong (明杠) — from discard
{ "type": "action", "match_id": "...", "action_type": "kong", "data": { "kong_type": "exposed" } }
// Concealed Kong (暗杠) — 4 in hand
{ "type": "action", "match_id": "...", "action_type": "kong", "data": { "kong_type": "concealed", "tile": "5dots" } }
// Add Kong (加杠) — add to existing Pong
{ "type": "action", "match_id": "...", "action_type": "kong", "data": { "kong_type": "add", "tile": "5dots" } }
```

### Pass

```json
{ "type": "action", "match_id": "...", "action_type": "pass", "data": {} }
```

## Agent Visible State

- `your_seat` (0-3), `your_hand` (tiles in hand), `your_declared_lack`
- `declared_lacks` — all players' declared suits (null before reveal)
- `exposed_sets` — each player's exposed Pong/Kong
- `discards` — each player's discard pile
- `current_turn`, `tiles_remaining`, `scores` (running totals including kong payments)
- `winners` — seats of players who already won
- `action_options` — available actions (draw, discard, pong, kong, hu, pass)

## Strategy Tips

- **缺一门**: Declare the suit with fewest tiles; discard those first
- **Defense**: Watch other players' discards to avoid feeding them wins (点炮)
- **Clean Hand**: If close to 清一色 (4 fan), worth pursuing — high reward
- **Kong timing**: Concealed Kong is safest (no info leak); Add Kong risks 抢杠胡
- **Blood Battle**: First win is safest; being last = paying everyone
- **Read discards**: Track what tiles are dead to calculate remaining tile probabilities
