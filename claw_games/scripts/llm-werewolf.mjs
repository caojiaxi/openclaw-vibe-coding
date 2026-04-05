#!/usr/bin/env node
// LLM Werewolf Bot — 8 agents with real AI decision-making
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const BASE = process.env.BASE_URL || "http://localhost:3001";
const LLM_URL = process.env.LLM_URL || "http://localhost:3000/v1/chat/completions";
const LLM_API_KEY = process.env.LLM_API_KEY || "sk-zHxp6kDOflAEKUDr53iQhQRFM5sxDIx4Bv68kx1ccxD3khyW";
const LLM_MODEL = process.env.LLM_MODEL || "gemini-3.1-flash-lite-preview";
const SECRET = "bot-secret-2026";
const NAMES = ["Alpha","Bravo","Charlie","Delta","Echo","Foxtrot","Golf","Hotel"];
const LLM_TIMEOUT_MS = 15000;
const ACTION_DELAY_MS = 500;
const GAME_TIMEOUT_MS = 900000; // 15 min

const COLORS = ["\x1b[36m","\x1b[33m","\x1b[35m","\x1b[32m","\x1b[91m","\x1b[94m","\x1b[96m","\x1b[93m"];
const R="\x1b[0m", DIM="\x1b[2m", BOLD="\x1b[1m", RED="\x1b[31m", BLUE="\x1b[34m", GREEN="\x1b[32m";

const ROLE_CN = {
  werewolf: "🐺 狼人", villager: "👤 村民", seer: "🔮 预言家",
  witch: "🧙 女巫", hunter: "🏹 猎人", guard: "🛡️ 守卫",
};
const PHASE_CN = {
  night: "🌙 夜晚", day_announce: "📢 天亮了", day_discuss: "💬 讨论",
  day_vote: "🗳️ 投票", hunter_shoot: "🏹 猎人开枪", game_over: "🏁 游戏结束",
};

function now() { return new Date().toISOString(); }
function ts() { return new Date().toLocaleTimeString("en",{hour12:false}); }
function log(i,...a) { console.log(`${DIM}${ts()}${R} ${COLORS[i]}[${NAMES[i]}]${R}`,...a); }
function slog(...a) { console.log(`${DIM}${ts()}${R} ${BLUE}[System]${R}`,...a); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ─── System Prompts per Role ────────────────────────
const BASE_RULES = `你正在玩8人狼人杀。
角色配置: 2狼人 + 预言家 + 女巫 + 守卫 + 猎人 + 2村民
夜间顺序: 守卫→狼人→女巫→预言家
胜利条件: 狼人阵营——杀光好人方或狼人数>=好人数; 好人阵营——投票处决所有狼人
关键规则:
- 守卫不能连续两晚保护同一人
- 女巫第一晚可以自救，之后不能自救
- 女巫不能同一晚既救人又毒人
- 猎人被毒死时不能开枪
- 投票平票则无人出局`;

const ROLE_PROMPTS = {
  werewolf: `你是狼人。你知道谁是你的狼人队友。
策略: 白天伪装好人，引导投票处决关键好人(预言家/女巫)。晚上和队友协商杀谁。
发言时不要暴露自己，可以适当怀疑别人来转移注意力。`,
  villager: `你是普通村民，没有特殊能力。
策略: 仔细听每个人的发言，找出逻辑漏洞。注意谁在帮狼人说话。投票时跟随可信的信息。`,
  seer: `你是预言家，每晚可以查验一名玩家是否为狼人。
策略: 合理使用查验信息，但要小心暴露身份。可以选择在合适时机跳出来公布查验结果。`,
  witch: `你是女巫，有一瓶解药(救人)和一瓶毒药(毒人)，各只能用一次。
策略: 解药要用在关键时刻(第一晚通常救人)。毒药留给确认的狼人。`,
  hunter: `你是猎人，被投票出局时可以带走一名玩家(被女巫毒死不能开枪)。
策略: 不要轻易暴露身份，除非能确认狼人。开枪要打狼人。`,
  guard: `你是守卫，每晚可以保护一名玩家不被狼人杀死(不能连续保护同一人)。
策略: 优先保护可能是预言家或女巫的玩家。注意轮换保护对象。`,
};

// ─── LLM Call ───────────────────────────────────────
async function callLLM(systemPrompt, userPrompt, idx, retry = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    log(idx, DIM + "🤖 Thinking..." + R);
    const resp = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + LLM_API_KEY },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 512,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response");
    log(idx, DIM + "🤖 " + content.slice(0, 120) + R);
    // Parse JSON from response
    let js = content;
    const cm = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (cm) js = cm[1].trim();
    const bm = js.match(/\{[\s\S]*\}/);
    if (bm) js = bm[0];
    return JSON.parse(js);
  } catch (e) {
    clearTimeout(timer);
    log(idx, RED + "LLM error: " + e.message + R);
    if (retry < 2) {
      await sleep(1000 * (retry + 1)); // Backoff: 1s, 2s
      return callLLM(systemPrompt, userPrompt, idx, retry + 1);
    }
    return null;
  }
}

// ─── Prompt Builders ────────────────────────────────
function buildSystemPrompt(role) {
  return BASE_RULES + "\n\n" + (ROLE_PROMPTS[role] || ROLE_PROMPTS.villager)
    + "\n\n回复格式: 只返回JSON，不要其他内容。";
}

function buildNightPrompt(view, options, memory) {
  const L = [];
  L.push(`## 当前状态`);
  L.push(`你是 ${view.your_seat} 号位，角色: ${ROLE_CN[view.your_role] || view.your_role}`);
  L.push(`第 ${view.turn} 晚`);
  L.push(`存活玩家: ${view.alive_players.join(", ")} 号位`);
  if (view.dead_players?.length) {
    L.push(`已死亡: ${view.dead_players.map(d => d.seat + "号" + (d.role ? "(" + ROLE_CN[d.role] + ")" : "")).join(", ")}`);
  }
  // Role-specific info
  if (view.wolf_teammates) {
    L.push(`\n你的狼人队友: ${view.wolf_teammates.join(", ")} 号位`);
  }
  if (view.seer_results?.length) {
    L.push(`\n你的查验记录:`);
    for (const r of view.seer_results) {
      L.push(`  ${r.seat}号位 → ${r.is_wolf ? "🐺 狼人!" : "✅ 好人"}`);
    }
  }
  if (view.witch_potions) {
    L.push(`\n你的药水: 解药${view.witch_potions.antidote ? "✅可用" : "❌已用"} / 毒药${view.witch_potions.poison ? "✅可用" : "❌已用"}`);
    if (view.wolf_target !== undefined && view.wolf_target >= 0) {
      L.push(`今晚狼人杀了: ${view.wolf_target}号位`);
    }
  }
  if (memory.length) {
    L.push(`\n## 你的记忆`);
    for (const m of memory.slice(-10)) L.push(`- ${m}`);
  }
  L.push(`\n## 可选操作`);
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    let desc = o.type;
    if (o.data?.target !== undefined) desc += ` → ${o.data.target === -1 ? "跳过/不使用" : o.data.target + "号位"}`;
    if (o.data?.save !== undefined) desc += ` (救人: ${o.data.save ? "是" : "否"}, 毒: ${o.data.poison_target === -1 ? "不毒" : o.data.poison_target + "号"})`;
    L.push(`  ${i}: ${desc}`);
  }
  L.push(`\n请选择最优操作。返回JSON: { "choice": <索引>, "reason": "简短理由" }`);
  return L.join("\n");
}

function buildDiscussPrompt(view, memory) {
  const L = [];
  L.push(`## 讨论阶段 — 第 ${view.turn} 天`);
  L.push(`你是 ${view.your_seat} 号位，角色: ${ROLE_CN[view.your_role] || view.your_role}`);
  L.push(`存活玩家: ${view.alive_players.join(", ")} 号位`);
  if (view.dead_players?.length) {
    L.push(`已死亡: ${view.dead_players.map(d => d.seat + "号" + (d.role ? "(" + ROLE_CN[d.role] + ")" : "")).join(", ")}`);
  }
  if (view.wolf_teammates) {
    L.push(`(你的狼人队友: ${view.wolf_teammates.join(", ")} 号位 — 不要暴露!)`);
  }
  if (view.seer_results?.length) {
    L.push(`你的查验记录: ${view.seer_results.map(r => r.seat + "号=" + (r.is_wolf ? "狼人" : "好人")).join(", ")}`);
  }
  if (view.discussion?.length) {
    L.push(`\n## 之前的发言:`);
    for (const d of view.discussion) {
      L.push(`  ${d.seat}号位: "${d.message}"`);
    }
  }
  if (memory.length) {
    L.push(`\n## 你的记忆`);
    for (const m of memory.slice(-10)) L.push(`- ${m}`);
  }
  if (view.last_vote_result) {
    L.push(`\n## 上轮投票结果:`);
    const vr = view.last_vote_result;
    for (const [voter, target] of Object.entries(vr.votes)) {
      L.push(`  ${voter}号 → ${target == -1 ? "弃权" : target + "号"}`);
    }
    if (vr.eliminated !== undefined) L.push(`  → ${vr.eliminated}号被投票出局`);
    else L.push(`  → 平票，无人出局`);
  }
  L.push(`\n现在轮到你发言。根据你的角色和掌握的信息，说一段有策略性的话(1-3句)。`);
  L.push(`返回JSON: { "message": "你的发言内容", "reason": "内心想法(不会公开)" }`);
  return L.join("\n");
}

function buildVotePrompt(view, memory) {
  const L = [];
  L.push(`## 投票阶段 — 第 ${view.turn} 天`);
  L.push(`你是 ${view.your_seat} 号位，角色: ${ROLE_CN[view.your_role] || view.your_role}`);
  L.push(`存活玩家: ${view.alive_players.join(", ")} 号位`);
  if (view.wolf_teammates) {
    L.push(`(你的狼人队友: ${view.wolf_teammates.join(", ")} 号位)`);
  }
  if (view.seer_results?.length) {
    L.push(`你的查验: ${view.seer_results.map(r => r.seat + "号=" + (r.is_wolf ? "狼人" : "好人")).join(", ")}`);
  }
  if (view.discussion?.length) {
    L.push(`\n## 今天的讨论:`);
    for (const d of view.discussion) {
      L.push(`  ${d.seat}号位: "${d.message}"`);
    }
  }
  if (memory.length) {
    L.push(`\n## 你的记忆`);
    for (const m of memory.slice(-10)) L.push(`- ${m}`);
  }
  L.push(`\n## 可投票目标 (不能投自己):`);
  const targets = view.alive_players.filter(s => s !== view.your_seat);
  for (const s of targets) L.push(`  ${s}号位`);
  L.push(`  或选择 -1 弃权`);
  L.push(`\n请选择要投票处决的玩家。返回JSON: { "target": <座位号或-1>, "reason": "理由" }`);
  return L.join("\n");
}

function buildHunterPrompt(view, options) {
  const L = [];
  L.push(`## 猎人开枪！`);
  L.push(`你是猎人，你被淘汰了。你可以带走一名玩家。`);
  L.push(`存活玩家: ${view.alive_players.join(", ")} 号位`);
  L.push(`\n可选目标:`);
  for (let i = 0; i < options.length; i++) {
    const t = options[i].data?.target;
    L.push(`  ${i}: ${t === -1 ? "不开枪" : t + "号位"}`);
  }
  L.push(`\n返回JSON: { "choice": <索引>, "reason": "理由" }`);
  return L.join("\n");
}

// ─── Fallback Logic ─────────────────────────────────
function fallbackChoice(options, view) {
  if (!options?.length) return 0;
  // For night actions, prefer action over skip (-1)
  const nonSkip = options.findIndex(o => {
    const t = o.data?.target;
    return t !== undefined && t !== -1;
  });
  if (nonSkip >= 0) return nonSkip;
  return 0;
}

// ─── Agent Class ────────────────────────────────────
class WerewolfAgent {
  constructor(index) {
    this.index = index;
    this.name = NAMES[index];
    this.token = null;
    this.ws = null;
    this.matchId = null;
    this.view = {};
    this.role = null;
    this.seat = null;
    this.memory = []; // per-game memory for context
    this.pending = false;
    this.finished = false;
  }

  async register() {
    let r = await fetch(`${BASE}/api/v1/agents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: this.name, secret: SECRET }),
    });
    if (r.status === 409) {
      r = await fetch(`${BASE}/api/v1/agents/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.name, secret: SECRET }),
      });
    }
    if (!r.ok) throw new Error(`Auth failed for ${this.name}: ${await r.text()}`);
    const j = await r.json();
    this.token = j.token;
    log(this.index, BOLD + "Authenticated ✓" + R);
  }

  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`${BASE.replace("http", "ws")}/ws?token=${this.token}`);
      this.ws.on("open", () => { log(this.index, "WS ✓"); res(); });
      this.ws.on("message", d => this.onMsg(JSON.parse(d.toString())));
      this.ws.on("error", e => { log(this.index, RED + "WS ERR: " + e.message + R); rej(e); });
      this.ws.on("close", () => log(this.index, DIM + "WS closed" + R));
    });
  }

  send(msg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(msg)); }

  async queue() {
    const r = await fetch(`${BASE}/api/v1/matchmaking/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ game_type: "werewolf" }),
    });
    if (!r.ok) throw new Error(`Queue failed: ${await r.text()}`);
    log(this.index, "Queued ✓");
  }

  disconnect() { try { this.ws?.close(); } catch (e) {} }

  // ─── Message Handler ──────────────────────────────
  onMsg(msg) {
    if (msg.type === "heartbeat") {
      this.send({ type: "heartbeat_ack", payload: {}, timestamp: now() });
      return;
    }
    if (msg.type === "match_found") {
      this.matchId = msg.match_id;
      log(this.index, BOLD + "🎮 Match found!" + R);
    }
    if (msg.type === "state_update" || msg.type === "game_start") {
      const v = msg.payload?.visible_state;
      if (v) {
        this.view = v;
        this.matchId = msg.match_id || v.match_id || this.matchId;
        if (v.your_role && !this.role) {
          this.role = v.your_role;
          this.seat = v.your_seat;
          log(this.index, BOLD + `${ROLE_CN[v.your_role] || v.your_role} (${v.your_seat}号位)` + R);
          this.memory.push(`我是${ROLE_CN[v.your_role]}，坐在${v.your_seat}号位`);
          if (v.wolf_teammates) {
            this.memory.push(`我的狼人队友: ${v.wolf_teammates.join(",")}号位`);
          }
        }
        if (v.phase) {
          log(this.index, DIM + `阶段: ${PHASE_CN[v.phase] || v.phase} (第${v.turn}轮)` + R);
        }
      }
    }
    if (msg.type === "action_request") {
      this.handleActionRequest(msg);
    }
    if (msg.type === "action_result") {
      const p = msg.payload;
      if (p) {
        log(this.index, DIM + `📋 ${p.actor?.slice(0,8)} → ${p.action_type}` + R);
      }
    }
    if (msg.type === "game_end") {
      this.finished = true;
      log(this.index, BOLD + GREEN + "🏁 游戏结束!" + R);
      const results = msg.payload?.results || [];
      for (const r of results) {
        const won = r.result === "win";
        log(this.index, `  ${r.seat}号 ${ROLE_CN[r.role]||r.role} ${r.alive?"存活":"死亡"} → ${won ? GREEN+"胜利"+R : RED+"失败"+R}`);
      }
    }
    if (msg.type === "error") {
      log(this.index, RED + "❌ " + (msg.payload?.message || JSON.stringify(msg.payload)) + R);
    }
  }

  // ─── Action Request Handler ───────────────────────
  async handleActionRequest(msg) {
    if (this.pending) return;
    this.pending = true;
    try {
      const options = msg.payload?.options || [];
      this.matchId = msg.match_id || this.matchId;
      const phase = this.view.phase || "unknown";
      log(this.index, `⚡ ${PHASE_CN[phase]||phase} — ${options.length} options`);
      await sleep(ACTION_DELAY_MS);

      // Acknowledge = auto-pick (always)
      if (options[0]?.type === "acknowledge") {
        log(this.index, BOLD + `✅ Auto: acknowledge` + R);
        this.sendAction(options[0], "auto-acknowledge");
        return;
      }

      // Single option = auto-pick (but NOT for discuss — we want LLM to write speech)
      if (options.length === 1 && options[0]?.type !== "discuss") {
        const o = options[0];
        log(this.index, BOLD + `✅ Auto: ${o.type}` + R);
        this.sendAction(o, "auto (single option)");
        return;
      }

      const systemPrompt = buildSystemPrompt(this.role || "villager");
      let result = null;

      if (phase === "night") {
        const prompt = buildNightPrompt(this.view, options, this.memory);
        result = await callLLM(systemPrompt, prompt, this.index);
        if (result && typeof result.choice === "number" && result.choice >= 0 && result.choice < options.length) {
          const chosen = options[result.choice];
          this.recordNightMemory(chosen, result.reason);
          log(this.index, BOLD + `✅ [${result.choice}] ${chosen.type}` + R + ` — ${DIM}${result.reason||""}${R}`);
          this.sendAction(chosen, result.reason || "LLM");
        } else {
          const fi = fallbackChoice(options, this.view);
          log(this.index, `⚙️ Fallback: [${fi}] ${options[fi].type}`);
          this.sendAction(options[fi], "fallback");
        }
      } else if (phase === "day_discuss") {
        const prompt = buildDiscussPrompt(this.view, this.memory);
        result = await callLLM(systemPrompt, prompt, this.index);
        let message = "我暂时没有什么要说的。";
        let reason = "fallback";
        if (result && result.message) {
          message = result.message;
          reason = result.reason || "LLM";
          this.memory.push(`第${this.view.turn}天我说: "${message}"`);
        }
        log(this.index, BOLD + `💬 "${message.slice(0,60)}"` + R);
        this.sendAction({ type: "discuss", data: { message } }, reason);

      } else if (phase === "day_vote") {
        const prompt = buildVotePrompt(this.view, this.memory);
        result = await callLLM(systemPrompt, prompt, this.index);
        let target = -1;
        let reason = "fallback-abstain";
        if (result && typeof result.target === "number") {
          // Validate target is in alive_players and not self
          const valid = this.view.alive_players?.filter(s => s !== this.view.your_seat) || [];
          if (result.target === -1 || valid.includes(result.target)) {
            target = result.target;
            reason = result.reason || "LLM";
          }
        }
        const targetStr = target === -1 ? "弃权" : `${target}号`;
        log(this.index, BOLD + `🗳️ 投票: ${targetStr}` + R + ` — ${DIM}${reason}${R}`);
        this.memory.push(`第${this.view.turn}天我投了${targetStr}`);
        // Find the matching option
        const oi = options.findIndex(o => o.data?.target === target);
        this.sendAction(oi >= 0 ? options[oi] : { type: "vote", data: { target } }, reason);

      } else if (phase === "hunter_shoot") {
        const prompt = buildHunterPrompt(this.view, options);
        result = await callLLM(systemPrompt, prompt, this.index);
        if (result && typeof result.choice === "number" && result.choice >= 0 && result.choice < options.length) {
          log(this.index, BOLD + `🏹 开枪: ${options[result.choice].data?.target}号` + R);
          this.sendAction(options[result.choice], result.reason || "LLM");
        } else {
          this.sendAction(options[0], "fallback");
        }

      } else {
        // Unknown phase, pick first option
        this.sendAction(options[0], "fallback-unknown-phase");
      }
    } catch (e) {
      log(this.index, RED + "Action error: " + e.message + R);
    } finally {
      this.pending = false;
    }
  }

  sendAction(chosen, reason) {
    this.send({
      type: "agent_thinking",
      payload: { match_id: this.matchId, reason, action: chosen.type },
      timestamp: now(),
    });
    this.send({
      type: "action",
      payload: {
        match_id: this.matchId,
        action_type: chosen.type,
        data: chosen.data || {},
        reason: reason,
      },
      timestamp: now(),
    });
  }

  recordNightMemory(chosen, reason) {
    const t = chosen.data?.target;
    switch (chosen.type) {
      case "guard_protect":
        this.memory.push(`第${this.view.turn}晚我保护了${t === -1 ? "无人" : t + "号"}`);
        break;
      case "wolf_kill":
        this.memory.push(`第${this.view.turn}晚我投票杀${t === -1 ? "无人" : t + "号"}`);
        break;
      case "witch_act": {
        const d = chosen.data;
        if (d.save) this.memory.push(`第${this.view.turn}晚我用解药救了被杀的人`);
        if (d.poison_target >= 0) this.memory.push(`第${this.view.turn}晚我毒了${d.poison_target}号`);
        if (!d.save && d.poison_target < 0) this.memory.push(`第${this.view.turn}晚我没有用药`);
        break;
      }
      case "seer_inspect":
        // Result will come in next state_update via seer_results
        this.memory.push(`第${this.view.turn}晚我查验了${t}号`);
        break;
    }
  }
}

// ─── Main ───────────────────────────────────────────
async function main() {
  console.log("\n" + BOLD + "=".repeat(60) + R);
  console.log(BOLD + "  🐺 LLM Werewolf Bot (8 Agents)" + R);
  console.log(BOLD + "=".repeat(60) + R);
  console.log("  Server:  " + BASE);
  console.log("  LLM:     " + LLM_URL);
  console.log("  Model:   " + LLM_MODEL);
  console.log(BOLD + "=".repeat(60) + R + "\n");

  const gameTimer = setTimeout(() => {
    slog(RED + BOLD + "Game timeout!" + R);
    process.exit(1);
  }, GAME_TIMEOUT_MS);

  const agents = NAMES.map((_, i) => new WerewolfAgent(i));

  try {
    slog(BOLD + "Step 1: Registering agents..." + R);
    for (const a of agents) await a.register();
    slog("All registered\n");

    slog(BOLD + "Step 2: Connecting WebSockets..." + R);
    await Promise.all(agents.map(a => a.connect()));
    slog("All connected\n");

    slog(BOLD + "Step 3: Joining werewolf queue..." + R);
    for (const a of agents) {
      await a.queue();
      await sleep(200);
    }
    slog("All queued\n");
    slog(BOLD + "Waiting for match and LLM decisions...\n" + R);

    // Wait for all to finish
    const check = setInterval(() => {
      if (agents.every(a => a.finished)) {
        clearInterval(check);
        clearTimeout(gameTimer);
        slog(BOLD + "All agents finished. Exiting in 5s..." + R);
        setTimeout(() => {
          agents.forEach(a => a.disconnect());
          process.exit(0);
        }, 5000);
      }
    }, 1000);
  } catch (e) {
    slog(RED + BOLD + "Fatal: " + e.message + R);
    console.error(e);
    agents.forEach(a => a.disconnect());
    clearTimeout(gameTimer);
    process.exit(1);
  }
}

process.on("SIGINT", () => { slog("Interrupted"); process.exit(0); });
process.on("uncaughtException", e => { console.error(RED + "Uncaught: " + e.message + R); process.exit(1); });
process.on("unhandledRejection", e => { console.error(RED + "Unhandled: " + e + R); process.exit(1); });

main();
