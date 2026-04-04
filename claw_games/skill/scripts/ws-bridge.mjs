#!/usr/bin/env node
// ws-bridge.mjs — WebSocket bridge for OpenClaw agent
// stdin: JSON commands from agent  →  WebSocket server
// stdout: JSON events from server  →  agent
// Usage: node ws-bridge.mjs <server_url> <agent_name> <agent_secret>
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const [,, SERVER, NAME, SECRET] = process.argv;
if (!SERVER || !NAME || !SECRET) {
  console.error(JSON.stringify({type:"error",msg:"Usage: node ws-bridge.mjs <server> <name> <secret>"}));
  process.exit(1);
}
const API = `${SERVER}/api/v1`;
const out = (obj) => console.log(JSON.stringify(obj));
const SUIT_CN = { characters: "万", bamboo: "条", dots: "筒" };
const TILE_CN = (t) => {
  if (!t || !t.suit) return "?";
  const nums = ["一","二","三","四","五","六","七","八","九"];
  return `${nums[t.value-1]}${SUIT_CN[t.suit]}`;
};
const HAND_CN = (h) => h ? [...h].sort((a,b)=>{
  const o={characters:0,bamboo:1,dots:2};
  return (o[a.suit]??3)-(o[b.suit]??3)||a.value-b.value;
}).map(TILE_CN).join(" ") : "?";

let token = null;
let ws = null;
let matchId = null;
let view = {};

async function register() {
  let resp = await fetch(`${API}/agents`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({name: NAME, secret: SECRET}),
  });
  if (resp.status === 409) {
    resp = await fetch(`${API}/agents/login`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name: NAME, secret: SECRET}),
    });
  }
  const j = await resp.json();
  if (!j.token) { out({type:"error",msg:"Auth failed: "+JSON.stringify(j)}); process.exit(1); }
  token = j.token;
  out({type:"system",msg:`Authenticated as ${NAME}`});
}

async function joinQueue() {
  const resp = await fetch(`${API}/matchmaking/join`, {
    method: "POST",
    headers: {"Content-Type":"application/json","Authorization":`Bearer ${token}`},
    body: JSON.stringify({game_type:"mahjong"}),
  });
  const j = await resp.json();
  out({type:"system",msg:`Joined queue (pos ${j.position})`});
}

function connectWS() {
  return new Promise((resolve) => {
    ws = new WebSocket(`${SERVER.replace("http","ws")}/ws?token=${token}`);
    ws.on("open", () => { out({type:"system",msg:"WebSocket connected"}); resolve(); });
    ws.on("message", (d) => handleServerMsg(JSON.parse(d.toString())));
    ws.on("close", () => out({type:"system",msg:"WebSocket closed"}));
    ws.on("error", (e) => out({type:"error",msg:`WS error: ${e.message}`}));
  });
}

function handleServerMsg(msg) {
  const t = msg.type;
  if (t === "heartbeat") {
    ws.send(JSON.stringify({type:"heartbeat_ack",payload:{},timestamp:new Date().toISOString()}));
    return;
  }
  if (t === "match_found") {
    matchId = msg.match_id;
    out({type:"match_found",match_id:matchId,players:msg.payload?.participants});
    return;
  }
  if (t === "state_update") {
    const v = msg.payload?.visible_state;
    if (v) {
      view = v;
      matchId = msg.match_id || matchId;
    }
    return; // state updates are silent, agent reads them via action_request
  }
  if (t === "game_start") {
    const v = msg.payload?.visible_state;
    if (v) view = v;
    out({type:"game_start",
      your_seat: view.your_seat,
      hand: HAND_CN(view.your_hand),
      hand_count: view.your_hand?.length,
    });
    return;
  }
  if (t === "action_request") {
    const options = msg.payload?.options || [];
    // Auto-execute single-option actions (draw, pass, etc.)
    if (options.length === 1) {
      const a = options[0];
      ws.send(JSON.stringify({
        type: "action",
        payload: { match_id: matchId, action_type: a.type, data: a.data || {}, reason: "auto (single option)" },
        timestamp: new Date().toISOString(),
      }));
      out({type:"auto_action",action_type:a.type,desc:a.type==="draw"?"摸牌":"auto"});
      return;
    }
    // Format options for agent
    const formatted = options.map((a,i) => {
      let desc = a.type;
      if (a.type === "discard" && a.data?.tile) desc = `打出 ${TILE_CN(a.data.tile)}`;
      else if (a.type === "declare_lack") desc = `定缺 ${SUIT_CN[a.data?.suit]||a.data?.suit}`;
      else if (a.type === "pong") desc = `碰 ${a.data?.tile?TILE_CN(a.data.tile):""}`;
      else if (a.type === "kong") desc = `杠 ${a.data?.tile?TILE_CN(a.data.tile):""} (${a.data?.kong_type||""})`;
      else if (a.type === "hu") desc = a.data?.tile ? `胡 ${TILE_CN(a.data.tile)}` : "自摸胡";
      else if (a.type === "draw") desc = "摸牌";
      else if (a.type === "pass") desc = "过";
      return {index:i, type:a.type, desc, data:a.data};
    });
    out({
      type:"action_request",
      match_id: matchId,
      hand: HAND_CN(view.your_hand),
      hand_count: view.your_hand?.length,
      declared_lack: view.your_declared_lack ? SUIT_CN[view.your_declared_lack] : null,
      tiles_remaining: view.tiles_remaining,
      phase: view.phase,
      sub_phase: view.sub_phase,
      options: formatted,
      timeout_ms: msg.payload?.timeout_ms,
    });
    return;
  }


  if (t === "action_result") {
    const p = msg.payload;
    out({type:"action_result",actor:p?.actor?.slice(0,8),action:p?.action_type,
      tile:p?.tile?TILE_CN(p.tile):null});
    return;
  }
  if (t === "game_end") {
    const results = msg.payload?.results || [];
    out({type:"game_end",results,rating_changes:msg.payload?.rating_changes});
    setTimeout(() => process.exit(0), 1000);
    return;
  }
  if (t === "error") {
    out({type:"error",msg:msg.payload?.message||JSON.stringify(msg.payload)});
    return;
  }
  out({type:"server_msg",raw_type:t,payload:msg.payload});
}

// ── File-based command input ──
// Agent writes JSON to CMD_FILE, bridge watches and processes
import { readFileSync, writeFileSync, watchFile, existsSync } from "fs";
const CMD_FILE = process.env.BRIDGE_CMD_FILE || "/tmp/claw-bridge-cmd.json";
// Clear command file on start
writeFileSync(CMD_FILE, "");
let lastCmdMtime = 0;

setInterval(() => {
  try {
    if (!existsSync(CMD_FILE)) return;
    const stat = require("fs").statSync(CMD_FILE);
    if (stat.mtimeMs <= lastCmdMtime) return;
    lastCmdMtime = stat.mtimeMs;
    const content = readFileSync(CMD_FILE, "utf8").trim();
    writeFileSync(CMD_FILE, ""); // Clear immediately to prevent re-read
    if (!content) return;
    const cmd = JSON.parse(content);
    if (cmd.type === "action") {
      ws.send(JSON.stringify({
        type: "action",
        payload: {
          match_id: matchId,
          action_type: cmd.action_type,
          data: cmd.data || {},
          reason: cmd.reason || "",
        },
        timestamp: new Date().toISOString(),
      }));
      // Also broadcast thinking for spectators
      if (cmd.reason) {
        ws.send(JSON.stringify({
          type: "agent_thinking",
          payload: { match_id: matchId, reason: cmd.reason, action: cmd.action_type },
          timestamp: new Date().toISOString(),
        }));
      }
      out({type:"action_sent",action_type:cmd.action_type,reason:cmd.reason||""});
    }
  } catch { /* ignore */ }
}, 200);

async function main() {
  out({type:"system",msg:`Command file: ${CMD_FILE}`});
  await register();
  await connectWS();
  await joinQueue();
  out({type:"system",msg:"Waiting for match..."});
}
main().catch(e => { out({type:"error",msg:e.message}); process.exit(1); });
