#!/usr/bin/env node
// 8-bot Werewolf test — all bots auto-pick first option
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const BASE = "http://localhost:3001";
const SECRET = "bot-secret-2026";
const NAMES = ["Wolf_A","Wolf_B","Seer_C","Witch_D","Guard_E","Hunter_F","Vill_G","Vill_H"];
const DIM="\x1b[2m", R="\x1b[0m", BOLD="\x1b[1m";
const ts = () => new Date().toLocaleTimeString("en",{hour12:false});
const log = (n,...a) => console.log(`${DIM}${ts()}${R} [${n}]`,...a);

class Bot {
  constructor(i) {
    this.i = i; this.name = NAMES[i];
    this.token = null; this.ws = null; this.matchId = null;
    this.role = null; this.seat = null;
  }
  async register() {
    let r = await fetch(`${BASE}/api/v1/agents`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name: this.name, secret: SECRET}),
    });
    if (r.status === 409) {
      r = await fetch(`${BASE}/api/v1/agents/login`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({name: this.name, secret: SECRET}),
      });
    }
    const j = await r.json();
    this.token = j.token;
    log(this.name, "Authenticated ✓");
  }
  connect() {
    return new Promise((res) => {
      this.ws = new WebSocket(`ws://localhost:3001/ws?token=${this.token}`);
      this.ws.on("open", () => { log(this.name, "WS ✓"); res(); });
      this.ws.on("message", (d) => this.onMsg(JSON.parse(d.toString())));
      this.ws.on("error", (e) => log(this.name, "ERR:", e.message));
    });
  }
  send(msg) { this.ws.readyState === 1 && this.ws.send(JSON.stringify(msg)); }
  async queue() {
    await fetch(`${BASE}/api/v1/matchmaking/join`, {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${this.token}`},
      body: JSON.stringify({game_type:"werewolf"}),
    });
    log(this.name, "Queued ✓");
  }

  onMsg(msg) {
    if (msg.type === "heartbeat") {
      this.send({type:"heartbeat_ack",payload:{},timestamp:new Date().toISOString()});
      return;
    }
    if (msg.type === "match_found") {
      this.matchId = msg.match_id;
      log(this.name, `${BOLD}Match found!${R}`);
    }
    if (msg.type === "state_update") {
      const v = msg.payload?.visible_state;
      if (v) {
        if (v.your_role && !this.role) {
          this.role = v.your_role;
          this.seat = v.your_seat;
          log(this.name, `${BOLD}Role: ${v.your_role} (seat ${v.your_seat})${R}`);
        }
      }
    }
    if (msg.type === "game_start") {
      const v = msg.payload?.visible_state;
      if (v && v.your_role) {
        this.role = v.your_role;
        this.seat = v.your_seat;
        log(this.name, `${BOLD}Role: ${v.your_role} (seat ${v.your_seat})${R}`);
      }
    }
    if (msg.type === "action_request") {
      const options = msg.payload?.options || [];
      if (options.length > 0) {
        const chosen = options[0];
        log(this.name, `${DIM}Action: ${chosen.type} (${options.length} options)${R}`);
        this.send({
          type: "action",
          payload: {
            match_id: this.matchId,
            action_type: chosen.type,
            data: chosen.data || {},
            reason: "bot-auto",
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (msg.type === "action_result") {
      const p = msg.payload;
      log(this.name, `${DIM}📋 ${p?.actor?.slice(0,8)} did ${p?.action_type}${R}`);
    }
    if (msg.type === "game_end") {
      log(this.name, `${BOLD}🏁 Game Over!${R}`);
      const results = msg.payload?.results || [];
      for (const r of results) {
        log(this.name, `  seat ${r.seat}: ${r.role} — ${r.alive ? "alive" : "dead"} — ${r.faction}`);
      }
    }
    if (msg.type === "error") {
      log(this.name, `❌ ${msg.payload?.message || JSON.stringify(msg.payload)}`);
    }
  }
}

async function main() {
  console.log(`${BOLD}${"═".repeat(50)}${R}`);
  console.log(`${BOLD}  🐺 Werewolf 8-Bot Test${R}`);
  console.log(`${BOLD}${"═".repeat(50)}${R}\n`);

  const bots = NAMES.map((_, i) => new Bot(i));
  for (const b of bots) await b.register();
  for (const b of bots) await b.connect();
  for (const b of bots) await b.queue();

  console.log(`\n${DIM}${ts()}${R} [System] Waiting for match...\n`);

  await new Promise((res) => {
    let ended = 0;
    for (const b of bots) {
      const orig = b.onMsg.bind(b);
      b.onMsg = (msg) => {
        orig(msg);
        if (msg.type === "game_end") { ended++; if (ended >= 8) setTimeout(res, 3000); }
      };
    }
    setTimeout(res, 300000); // 5 min timeout
  });

  console.log(`\n${ts()} [System] Done!`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
