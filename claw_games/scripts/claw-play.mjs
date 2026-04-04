#!/usr/bin/env node
// Crab Boss plays mahjong with 3 LLM bots
// XieLaoBan (OpenClaw) + LLM_B + LLM_C + LLM_D
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/caojiaxi/.openclaw/workspace/openclaw-vibe-coding/claw_games/node_modules/ws");

const BASE = "http://localhost:3001";
const LLM_URL = "http://localhost:3000/v1/chat/completions";
const LLM_KEY = "sk-zHxp6kDOflAEKUDr53iQhQRFM5sxDIx4Bv68kx1ccxD3khyW";
const LLM_MODEL = "gemini-3.1-flash-lite-preview";
const BOSS_MODEL = "glm-5-turbo";
const NAMES = ["XieLaoBan", "LLM_B", "LLM_C", "LLM_D"];
const SECRET = "bot-secret-2026";
const SUIT = { characters: "万", bamboo: "条", dots: "筒" };
const TILE = (t) => `${["一","二","三","四","五","六","七","八","九"][t.value-1]}${SUIT[t.suit]}`;
const HAND = (h) => h ? [...h].sort((a,b)=>{const o={characters:0,bamboo:1,dots:2};return(o[a.suit]??3)-(o[b.suit]??3)||a.value-b.value}).map(TILE).join(" ") : "?";
const DIM="\x1b[2m", R="\x1b[0m", BOLD="\x1b[1m";
const C = ["\x1b[31m","\x1b[33m","\x1b[35m","\x1b[32m"];
const ts = () => new Date().toLocaleTimeString("en",{hour12:false});
const log = (i,...a) => console.log(`${DIM}${ts()}${R} ${C[i]}[${NAMES[i]}]${R}`,...a);

async function callLLM(prompt, model) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(LLM_URL, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 300 }),
    });
    const j = await r.json();
    clearTimeout(t);
    const txt = j.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return null;
  } catch { clearTimeout(t); return null; }
}

function buildPrompt(hand, actions, matchState) {
  let p = `你正在玩四川麻将（血战到底）。\n\n你的手牌: ${HAND(hand)}\n\n可选操作:\n`;
  actions.forEach((a, i) => {
    let desc = a.type;
    if (a.type === "discard" && a.data?.tile) desc = `打出 ${TILE(a.data.tile)}`;
    else if (a.type === "declare_lack") desc = `定缺 ${SUIT[a.data?.suit] || a.data?.suit}`;
    else if (a.type === "pong" && a.data?.tile) desc = `碰 ${TILE(a.data.tile)}`;
    else if (a.type === "kong" && a.data?.tile) desc = `杠 ${TILE(a.data.tile)}`;
    else if (a.type === "hu" && a.data?.tile) desc = `胡 ${TILE(a.data.tile)}`;
    else if (a.type === "hu") desc = "自摸胡";
    p += `  [${i}] ${desc}\n`;
  });
  p += `\n请选择最优操作。回复JSON: {"choice": <数字>, "reason": "<简短理由>"}`;
  return p;
}

class Agent {
  constructor(i) {
    this.i = i; this.name = NAMES[i];
    this.token = null; this.ws = null; this.matchId = null;
    this.model = i === 0 ? BOSS_MODEL : LLM_MODEL;
  }
  async register() {
    const r = await fetch(`${BASE}/api/v1/agents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: this.name, secret: SECRET }),
    });
    if (!r.ok) {
      const lr = await fetch(`${BASE}/api/v1/agents/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.name, secret: SECRET }),
      });
      const lj = await lr.json(); this.token = lj.token;
    } else { const j = await r.json(); this.token = j.token; }
    log(this.i, `${BOLD}Authenticated ✓${R}`);
  }
  connect() {
    return new Promise((res) => {
      this.ws = new WebSocket(`ws://localhost:3001/ws?token=${this.token}`);
      this.ws.on("open", () => { log(this.i, `${BOLD}WS connected ✓${R}`); res(); });
      this.ws.on("message", (d) => this.onMsg(JSON.parse(d.toString())));
      this.ws.on("error", (e) => log(this.i, "WS error:", e.message));
    });
  }
  send(msg) { this.ws.readyState === 1 && this.ws.send(JSON.stringify(msg)); }
  async queue() {
    const r = await fetch(`${BASE}/api/v1/matchmaking/join`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ game_type: "mahjong" }),
    });
    const j = await r.json();
    log(this.i, `Queued (pos ${j.position}) ✓`);
  }

  async onMsg(msg) {
    if (msg.type === "match_found") { this.matchId = msg.match_id; }
    if (msg.type === "game_start") {
      log(this.i, `手牌: ${HAND(msg.payload?.your_hand)} (${msg.payload?.your_hand?.length}张)`);
    }
    if (msg.type === "action_request") {
      const p = msg.payload;
      const actions = p.available_actions || [];
      if (actions.length === 0) return;
      if (actions.length === 1) {
        const a = actions[0];
        const reason = "auto (single option)";
        this.send({ type: "action", payload: { match_id: this.matchId, action_type: a.type, data: a.data, reason }, timestamp: new Date().toISOString() });
        const desc = a.data?.tile ? TILE(a.data.tile) : "";
        log(this.i, `${BOLD}✅ [0] ${a.type} ${desc}${R} — ${DIM}auto${R}`);
        return;
      }
      const hand = p.your_hand;
      log(this.i, `手牌: ${HAND(hand)} (${hand?.length}张)`);
      log(this.i, `⚡ ${actions.length} options`);
      log(this.i, `${DIM}🤖 Calling ${this.model}...${R}`);
      const prompt = buildPrompt(hand, actions);
      const result = await callLLM(prompt, this.model);
      let idx = 0; let reason = "fallback";
      if (result && typeof result.choice === "number" && result.choice >= 0 && result.choice < actions.length) {
        idx = result.choice; reason = result.reason || "";
        log(this.i, `${DIM}🤖 choice=${idx}: ${reason}${R}`);
      } else {
        log(this.i, `${DIM}🤖 fallback to 0${R}`);
      }
      const chosen = actions[idx];
      // Broadcast thinking
      this.send({ type: "agent_thinking", payload: { match_id: this.matchId, agent_id: "self", reason }, timestamp: new Date().toISOString() });
      this.send({ type: "action", payload: { match_id: this.matchId, action_type: chosen.type, data: chosen.data, reason }, timestamp: new Date().toISOString() });
      const desc = chosen.data?.tile ? TILE(chosen.data.tile) : "";
      log(this.i, `${BOLD}✅ [${idx}] ${chosen.type} ${desc}${R} — ${DIM}${reason}${R}`);
    }
    if (msg.type === "action_result") {
      const p = msg.payload;
      log(this.i, `${DIM}📋 ${p.actor?.slice(0,8)} did ${p.action_type}${R}`);
    }
    if (msg.type === "game_end") {
      log(this.i, `${BOLD}🏁 Game ended!${R}`);
    }
  }
}

async function main() {
  console.log(`${BOLD}${"═".repeat(60)}${R}`);
  console.log(`${BOLD}  🦀 Crab Boss Mahjong — XieLaoBan vs 3 LLM Bots${R}`);
  console.log(`${BOLD}${"═".repeat(60)}${R}`);
  console.log(`  Boss model: ${BOSS_MODEL}`);
  console.log(`  Bot model:  ${LLM_MODEL}`);
  console.log(`${BOLD}${"═".repeat(60)}${R}\n`);

  const agents = NAMES.map((_, i) => new Agent(i));

  // Register
  for (const a of agents) await a.register();
  // Connect WS
  for (const a of agents) await a.connect();
  // Queue
  for (const a of agents) await a.queue();

  console.log(`\n${DIM}${ts()}${R} \x1b[34m[System]${R} ${BOLD}Waiting for match...${R}\n`);

  // Wait for game end
  await new Promise((res) => {
    let ended = 0;
    for (const a of agents) {
      const orig = a.onMsg.bind(a);
      a.onMsg = async (msg) => {
        await orig(msg);
        if (msg.type === "game_end") { ended++; if (ended >= 4) setTimeout(res, 3000); }
      };
    }
    setTimeout(res, 600000);
  });

  console.log(`\n${DIM}${ts()}${R} \x1b[34m[System]${R} ${BOLD}Done!${R}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
