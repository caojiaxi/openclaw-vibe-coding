#!/usr/bin/env node
// 🦀 Crab Boss vs 3 LLM Bots — Protocol-correct version
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/caojiaxi/.openclaw/workspace/openclaw-vibe-coding/claw_games/node_modules/ws");

const BASE_URL = "http://localhost:3001";
const LLM_URL = "http://localhost:3000/v1/chat/completions";
const LLM_API_KEY = "sk-zHxp6kDOflAEKUDr53iQhQRFM5sxDIx4Bv68kx1ccxD3khyW";
const LLM_MODEL = "gemini-3.1-flash-lite-preview";
const BOSS_MODEL = "gemini-3.1-flash-lite-preview";
const BOT_NAMES = ["XieLaoBan", "LLM_B", "LLM_C", "LLM_D"];
const BOT_SECRET = "bot-secret-2026";
const LLM_TIMEOUT_MS = 10000;
const ACTION_DELAY_MS = 300;
const GAME_TIMEOUT_MS = 600000; // 10 minutes

const COLORS = ["\x1b[36m", "\x1b[33m", "\x1b[35m", "\x1b[32m"];
const R = "\x1b[0m", DIM = "\x1b[2m", BOLD = "\x1b[1m", RED = "\x1b[31m", BLUE = "\x1b[34m";
const SUIT_NAMES = { characters: "万", bamboo: "条", dots: "筒" };
const NUM = ["","一","二","三","四","五","六","七","八","九"];

function tileStr(t) {
  if (!t || typeof t !== "object") return String(t);
  return NUM[t.value] + SUIT_NAMES[t.suit];
}
function tilesStr(arr) {
  return !arr?.length ? "(无)" : arr.map(tileStr).join(" ");
}
function formatHand(tiles) {
  if (!tiles?.length) return "(空)";
  const g = { characters: [], bamboo: [], dots: [] };
  for (const t of tiles) if (g[t.suit]) g[t.suit].push(t);
  return ["characters","bamboo","dots"]
    .map(s => g[s].length ? g[s].sort((a,b)=>a.value-b.value).map(tileStr).join(" ") : null)
    .filter(Boolean).join(" | ");
}
function suitCN(s) { return SUIT_NAMES[s] || s; }
function now() { return new Date().toISOString(); }
function ts() { return new Date().toLocaleTimeString("en-US",{hour12:false}); }
function alog(i,...a) { console.log(DIM+ts()+R+" "+COLORS[i]+"["+BOT_NAMES[i]+"]"+R,...a); }
function slog(...a) { console.log(DIM+ts()+R+" "+BLUE+"[System]"+R,...a); }
function elog(i,...a) { console.error(DIM+ts()+R+" "+COLORS[i]+"["+BOT_NAMES[i]+"]"+R+" "+RED+"ERR:"+R,...a); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ─── LLM System Prompt ─────────────────────────────
const SYSTEM_PROMPT = `你是四川麻将(血战到底)高手AI。

## 核心规则
1. 只能碰不能吃
2. 定缺: 选一门花色,必须先打完才能胡
3. 杠分: 明杠各付1分,暗杠各付2分,加杠各付1分
4. 血战到底: 一家胡后继续
5. 花色: 万(characters)/条(bamboo)/筒(dots),1-9各4张

## 策略
- 定缺选手牌最少的花色
- 优先打定缺花色
- 保留对子和连续牌
- 能胡就胡

只返回JSON: { "choice": <索引>, "reason": "理由" }`;

// ─── LLM Call ───────────────────────────────────────
async function callLLM(prompt, idx, retry = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    alog(idx, DIM+"🤖 Calling LLM..."+R);
    const resp = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer "+LLM_API_KEY },
      body: JSON.stringify({
        model: idx === 0 ? BOSS_MODEL : LLM_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT },{ role: "user", content: prompt }],
        temperature: 0.3, max_tokens: 256,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error("HTTP "+resp.status);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response");
    alog(idx, DIM+"🤖 "+content.slice(0,100)+R);
    let js = content;
    const cm = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (cm) js = cm[1].trim();
    const bm = js.match(/\{[\s\S]*\}/);
    if (bm) js = bm[0];
    const p = JSON.parse(js);
    if (typeof p.choice !== "number") throw new Error("No choice");
    return p;
  } catch(e) {
    clearTimeout(timer);
    elog(idx, "LLM: "+e.message);
    return retry < 1 ? callLLM(prompt, idx, retry+1) : null;
  }
}

// ─── Build LLM Prompt ───────────────────────────────
function buildPrompt(view, options, idx) {
  const L = [];
  L.push("## 当前局面");
  L.push("你是玩家 "+(view.your_seat ?? idx)+"号位");
  L.push("阶段: "+(view.phase||"?")+" / "+(view.sub_phase||"?"));
  L.push("");
  if (view.your_hand?.length) {
    L.push("## 你的手牌 ("+view.your_hand.length+"张)");
    L.push(formatHand(view.your_hand));
    L.push("");
  }
  if (view.your_declared_lack) {
    L.push("## 定缺: "+suitCN(view.your_declared_lack));
    L.push("");
  }
  if (view.exposed_sets) {
    L.push("## 各家明牌");
    for (let i = 0; i < view.exposed_sets.length; i++) {
      const sets = view.exposed_sets[i];
      if (sets?.length) {
        const me = i === view.your_seat ? "(你)" : "";
        for (const s of sets) L.push("  玩家"+i+me+": "+s.type+" "+tilesStr(s.tiles));
      }
    }
    L.push("");
  }
  if (view.discards) {
    L.push("## 各家弃牌");
    for (let i = 0; i < view.discards.length; i++) {
      const me = i === view.your_seat ? "(你)" : "";
      L.push("  玩家"+i+me+": "+tilesStr(view.discards[i]));
    }
    L.push("");
  }
  if (view.tiles_remaining !== undefined) L.push("牌墙剩余: "+view.tiles_remaining+"张");
  if (view.scores) L.push("分数: "+view.scores.map((s,i) => "玩家"+i+":"+s).join(" "));
  if (view.current_discard) L.push("当前弃牌: "+tileStr(view.current_discard.tile)+" (玩家"+view.current_discard.source_seat+")");
  L.push("");
  L.push("## 可选操作");
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    let desc = o.type;
    if (o.data?.tile) desc += " "+tileStr(o.data.tile);
    if (o.data?.suit) desc += " ["+suitCN(o.data.suit)+"]";
    if (o.data?.kong_type) desc += " ("+o.data.kong_type+")";
    L.push("  "+i+": "+desc);
  }
  L.push("");
  L.push("请选择最优操作,返回JSON: { \"choice\": <索引>, \"reason\": \"理由\" }");
  return L.join("\n");
}

// ─── Fallback Heuristic ─────────────────────────────
function fallback(options, view, idx) {
  if (!options?.length) return 0;
  const prio = ["hu","kong","pong"];
  for (const p of prio) {
    const i = options.findIndex(o => o.type === p);
    if (i >= 0) { alog(idx, DIM+"⚙️ Fallback: "+p+R); return i; }
  }
  // Discard from lacking suit first
  if (view?.your_declared_lack) {
    const li = options.findIndex(o => o.type==="discard" && o.data?.tile?.suit === view.your_declared_lack);
    if (li >= 0) { alog(idx, DIM+"⚙️ Fallback: discard lack"+R); return li; }
  }
  // Any discard
  const di = options.findIndex(o => o.type === "discard");
  if (di >= 0) { alog(idx, DIM+"⚙️ Fallback: discard"+R); return di; }
  // declare_lack: pick suit with fewest tiles
  if (options[0]?.type === "declare_lack" && view?.your_hand) {
    const cnt = { characters: 0, bamboo: 0, dots: 0 };
    for (const t of view.your_hand) cnt[t.suit]++;
    let minS = "characters", minC = 999;
    for (const [s,c] of Object.entries(cnt)) { if (c < minC) { minC = c; minS = s; } }
    const li = options.findIndex(o => o.data?.suit === minS);
    if (li >= 0) { alog(idx, DIM+"⚙️ Fallback: lack "+suitCN(minS)+R); return li; }
  }
  // draw
  const dri = options.findIndex(o => o.type === "draw");
  if (dri >= 0) return dri;
  // pass
  const pi = options.findIndex(o => o.type === "pass");
  if (pi >= 0) return pi;
  return 0;
}

// ─── Agent Class ────────────────────────────────────
class MahjongAgent {
  constructor(index) {
    this.index = index;
    this.name = BOT_NAMES[index];
    this.token = null;
    this.agentId = null;
    this.ws = null;
    this.view = {};
    this.matchId = null;
    this.pending = false;
    this.finished = false;
  }
  log(...a) { alog(this.index, ...a); }
  err(...a) { elog(this.index, ...a); }

  async register() {
    this.log("Registering...");
    let resp = await fetch(BASE_URL+"/api/v1/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: this.name, secret: BOT_SECRET }),
    });
    if (resp.status === 409) {
      this.log("Already exists, logging in...");
      resp = await fetch(BASE_URL+"/api/v1/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.name, secret: BOT_SECRET }),
      });
      if (!resp.ok) throw new Error("Login failed: "+(await resp.text()));
      const d = await resp.json();
      this.token = d.token;
    } else if (resp.ok) {
      const d = await resp.json();
      this.agentId = d.id;
      this.token = d.token;
    } else {
      throw new Error("Register failed: "+(await resp.text()));
    }
    this.log(BOLD+"Authenticated ✓"+R);
  }

  async joinQueue() {
    this.log("Joining mahjong queue...");
    const resp = await fetch(BASE_URL+"/api/v1/matchmaking/join", {
      method: "POST",
      headers: { "Content-Type":"application/json", Authorization:"Bearer "+this.token },
      body: JSON.stringify({ game_type: "mahjong" }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error("Join queue failed: "+t);
    }
    const d = await resp.json();
    this.log("Queued (pos "+d.position+") ✓");
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = BASE_URL.replace("http","ws")+"/ws?token="+this.token;
      this.log("Connecting WS...");
      this.ws = new WebSocket(url);
      this.ws.on("open", () => { this.log(BOLD+"WS connected ✓"+R); resolve(); });
      this.ws.on("error", e => { this.err("WS error: "+e.message); reject(e); });
      this.ws.on("close", (code,reason) => { this.log("WS closed ("+code+")"); });
      this.ws.on("message", raw => {
        try { this.handleMsg(JSON.parse(raw.toString())); }
        catch(e) { this.err("Parse error: "+e.message); }
      });
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  handleMsg(msg) {
    const type = msg.type;
    switch(type) {
      case "heartbeat":
        this.send({ type: "heartbeat_ack", payload: {}, timestamp: now() });
        break;
      case "state_update":
        this.onStateUpdate(msg);
        break;
      case "action_request":
        this.onActionRequest(msg);
        break;
      case "action_result":
        this.onActionResult(msg);
        break;
      case "game_end":
        this.onGameEnd(msg);
        break;
      case "error":
        this.err("Server: "+(msg.payload?.message || JSON.stringify(msg.payload)));
        break;
      default:
        this.log(DIM+"📨 "+type+": "+JSON.stringify(msg).slice(0,80)+R);
    }
  }

  onStateUpdate(msg) {
    const v = msg.payload?.visible_state;
    if (!v) return;
    this.view = v;
    this.matchId = msg.match_id || v.match_id || this.matchId;
    if (v.your_hand) {
      this.log("手牌: "+formatHand(v.your_hand)+" ("+v.your_hand.length+"张)");
    }
    if (v.is_finished) {
      this.log(BOLD+"🏁 Game finished!"+R);
    }
  }

  onActionResult(msg) {
    const p = msg.payload;
    if (p) {
      this.log(DIM+"📋 "+p.actor?.slice(0,8)+" did "+p.action_type+R);
    }
  }

  async onActionRequest(msg) {
    if (this.pending) return;
    this.pending = true;
    try {
      const options = msg.payload?.options || [];
      this.matchId = msg.match_id || this.matchId;
      this.log("⚡ Action request ("+options.length+" options)");

      await sleep(ACTION_DELAY_MS);

      let choiceIdx = 0;
      let reason = "fallback";

      // Skip LLM for single-option actions (draw, etc.)
      if (options.length === 1) {
        choiceIdx = 0;
        reason = "auto (single option)";
      } else {
      // Try LLM
      const prompt = buildPrompt(this.view, options, this.index);
      const llmRes = await callLLM(prompt, this.index);

      if (llmRes && typeof llmRes.choice === "number") {
        if (llmRes.choice >= 0 && llmRes.choice < options.length) {
          choiceIdx = llmRes.choice;
          reason = llmRes.reason || "LLM";
        } else {
          this.err("LLM out of range: "+llmRes.choice);
          choiceIdx = fallback(options, this.view, this.index);
        }
      } else {
        choiceIdx = fallback(options, this.view, this.index);
      }
      } // end of else (multi-option)

      const chosen = options[choiceIdx];
      const chosenType = chosen?.type || "?";
      const chosenTile = chosen?.data?.tile ? " "+tileStr(chosen.data.tile) : "";
      this.log(BOLD+"✅ ["+choiceIdx+"] "+chosenType+chosenTile+R+" — "+DIM+reason+R);

      // Broadcast thinking to spectators
      this.send({
        type: "agent_thinking",
        payload: {
          match_id: this.matchId,
          reason: reason,
          action: chosenType,
          tile: chosen?.data?.tile ? tileStr(chosen.data.tile) : null,
        },
        timestamp: now(),
      });

      // Send action response in server-expected format
      this.send({
        type: "action",
        payload: {
          match_id: this.matchId,
          action_type: chosen.type,
          data: chosen.data,
          reason: reason,
        },
        timestamp: now(),
      });
    } catch(e) {
      this.err("Action handling: "+e.message);
    } finally {
      this.pending = false;
    }
  }

  onGameEnd(msg) {
    this.finished = true;
    const p = msg.payload || {};
    this.log(BOLD+"🏁 Game ended!"+R);
    if (p.results) {
      for (const r of p.results) {
        this.log("  "+r.agent_id?.slice(0,8)+": score="+r.score+" rank="+r.rank);
      }
    }
    if (p.rating_changes) {
      for (const rc of p.rating_changes) {
        this.log("  Rating: "+rc.old_rating+" → "+rc.new_rating+" ("+rc.agent_id?.slice(0,8)+")");
      }
    }
  }

  disconnect() {
    try { this.ws?.close(); } catch(e) {}
  }
}

// ─── Main ───────────────────────────────────────────
async function main() {
  console.log("\n"+BOLD+"═".repeat(60)+R);
  console.log(BOLD+"  🀄 LLM Sichuan Mahjong Bot (4 Agents)"+R);
  console.log(BOLD+"═".repeat(60)+R);
  console.log("  Server:  "+BASE_URL);
  console.log("  LLM:     "+LLM_URL);
  console.log("  Model:   "+LLM_MODEL);
  console.log(BOLD+"═".repeat(60)+R+"\n");

  const gameTimer = setTimeout(() => {
    slog(RED+BOLD+"⏰ Game timeout!"+R);
    process.exit(1);
  }, GAME_TIMEOUT_MS);

  const agents = BOT_NAMES.map((_,i) => new MahjongAgent(i));

  try {
    // 1. Register
    slog(BOLD+"Step 1: Registering agents..."+R);
    for (const a of agents) await a.register();
    slog("All registered ✓\n");

    // 2. Connect WS
    slog(BOLD+"Step 2: Connecting WebSockets..."+R);
    await Promise.all(agents.map(a => a.connect()));
    slog("All connected ✓\n");

    // 3. Join queue
    slog(BOLD+"Step 3: Joining queue..."+R);
    for (const a of agents) {
      await a.joinQueue();
      await sleep(200);
    }
    slog("All queued ✓\n");
    slog(BOLD+"Waiting for match and LLM decisions..."+R+"\n");

    // Wait for all to finish
    const check = setInterval(() => {
      if (agents.every(a => a.finished)) {
        clearInterval(check);
        clearTimeout(gameTimer);
        slog(BOLD+"All agents finished. Exiting in 3s..."+R);
        setTimeout(() => {
          agents.forEach(a => a.disconnect());
          process.exit(0);
        }, 3000);
      }
    }, 1000);
  } catch(e) {
    slog(RED+BOLD+"Fatal: "+e.message+R);
    console.error(e);
    agents.forEach(a => a.disconnect());
    clearTimeout(gameTimer);
    process.exit(1);
  }
}

process.on("SIGINT", () => { slog("Interrupted"); process.exit(0); });
process.on("uncaughtException", e => { console.error(RED+"Uncaught: "+e.message+R); process.exit(1); });
process.on("unhandledRejection", e => { console.error(RED+"Unhandled: "+e+R); process.exit(1); });

main();