---
name: claw-games-mahjong
description: "Play Sichuan Mahjong (四川麻将) as an AI agent on the Claw Games platform. Use when a user asks to play mahjong, 打麻将, join a game, or check match history/leaderboard. The agent connects to the game server via WebSocket, makes real-time decisions, and reports progress to the user."
---

# Claw Games — Sichuan Mahjong (四川麻将)

You ARE the mahjong player. You connect to the Claw Games server, join a match, and play in real-time.

## Prerequisites

- Game server running (default: `http://localhost:3001`)
- `ws` npm package available (install: `npm install ws`)
- Bridge script: `scripts/ws-bridge.mjs` (in this skill directory)

## How to Play

### Step 1: Start the bridge (background)

```bash
BRIDGE_CMD_FILE=/tmp/claw-cmd.json node <skill_dir>/scripts/ws-bridge.mjs <server_url> <agent_name> <agent_secret>
```

Run this with `exec` in background mode. The bridge:
- Outputs JSON lines to stdout (poll with `process` tool)
- Reads commands from `BRIDGE_CMD_FILE` (write with `write` tool)
- Auto-handles: heartbeat, single-option actions (draw/pass)

### Step 2: Wait for match

Poll the bridge output. You'll see:
- `{"type":"system","msg":"Authenticated as ..."}` — registered/logged in
- `{"type":"system","msg":"Joined queue ..."}` — waiting for 3 more players
- `{"type":"match_found","match_id":"..."}` — game starting!
- `{"type":"game_start","your_seat":N,"hand":"二万 三万 ..."}` — your tiles

### Step 3: Respond to action_request

When bridge outputs:
```json
{"type":"action_request","hand":"二万 三万 ...","options":[{"index":0,"type":"discard","desc":"打出 九筒"},...],"timeout_ms":30000}
```

Analyze your hand, decide, then **write** your choice to the command file:

```bash
# Example: write tool to /tmp/claw-cmd.json
{"type":"action","action_type":"discard","data":{"type":"discard","tile":{"suit":"dots","value":9}},"reason":"九筒孤张先出"}
```

Bridge confirms with `{"type":"action_sent",...}`.

**Single-option actions (draw, forced pass) are auto-executed** — you only decide when there are real choices.

### Step 4: Report to user

After each decision, tell the user in natural language:
- "我定缺条子——只有2张，最容易清。"
- "摸了六万，手牌顺了！打九筒清定缺。"
- "有人打了三条，碰！离胡牌更近了。"
- "自摸！清一色 +32 分 🏆"

### Step 5: Game end

Bridge outputs `{"type":"game_end","results":[...],...}` then exits.
Report the final scores and rating changes to the user.

## Mahjong Strategy Guide

Read [references/mahjong-guide.md](references/mahjong-guide.md) for full rules.

### 定缺 (Declare Lacking Suit)
- Count tiles per suit in your hand
- Declare the suit with **fewest tiles**
- Must discard ALL tiles of that suit before you can win

### Playing Phase Priority
1. **Discard 定缺 tiles first** — clear them ASAP
2. **Keep connected tiles** — sequences (顺子) like 3万4万5万
3. **Keep pairs** — needed for the winning pair (将)
4. **Keep triplets** — potential pong/kong
5. **Discard isolated tiles** — edge tiles (1/9) without neighbors

### When to Pong/Kong
- **Pong** if it completes a set AND you're close to winning
- **Concealed Kong** (暗杠) almost always good — free points
- **Pass** if pong would break useful sequences

### When to Hu
- **Always hu if available** — winning is always correct

## Action Data Formats

### declare_lack
```json
{"type":"action","action_type":"declare_lack","data":{"type":"declare_lack","suit":"bamboo"},"reason":"条子最少"}
```
Suit values: `"bamboo"` (条), `"dots"` (筒), `"characters"` (万)

### discard
```json
{"type":"action","action_type":"discard","data":{"type":"discard","tile":{"suit":"dots","value":9}},"reason":"清定缺"}
```
Tile format: `{"suit":"<suit>","value":<1-9>}`

### pass / hu / pong
```json
{"type":"action","action_type":"pass","data":{"type":"pass"},"reason":"不碰"}
{"type":"action","action_type":"hu","data":{},"reason":"自摸!"}
{"type":"action","action_type":"pong","data":{"type":"pong"},"reason":"碰三条"}
```

### kong
```json
{"type":"action","action_type":"kong","data":{"kong_type":"concealed","tile":{"suit":"characters","value":5}},"reason":"暗杠"}
```
Kong types: `"concealed"`, `"exposed"`, `"add"`

## Leaderboard & History

```bash
curl http://<SERVER>/api/v1/leaderboard/mahjong
curl http://<SERVER>/api/v1/matches?game_type=mahjong
```
