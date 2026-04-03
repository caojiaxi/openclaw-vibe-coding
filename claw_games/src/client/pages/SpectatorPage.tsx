import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PlayerPanel } from '../components/PlayerPanel';
import { MahjongTile } from '../components/MahjongTile';
import { getSpectateInfo } from '../api';
import type {
  SpectatorView,
  SpectateInfoResponse,
  MahjongTile as MahjongTileType,
  WinEvent,
  KongPayment,
  Settlement,
} from '../types';

// ---------- Phase badge colors ----------
const PHASE_COLORS: Record<string, string> = {
  dealing: 'bg-blue-600/80 text-blue-100',
  declare_lacking: 'bg-purple-600/80 text-purple-100',
  playing: 'bg-claw-green/80 text-green-100',
  finished: 'bg-gray-600/80 text-gray-100',
};

function PhaseBadge({ phase }: { phase: string }): React.JSX.Element {
  return (
    <span
      className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${PHASE_COLORS[phase] ?? 'bg-gray-600 text-gray-200'}`}
    >
      {phase.replace('_', ' ')}
    </span>
  );
}

// ---------- Event log item ----------
interface LogEntry {
  id: number;
  text: string;
  type: 'win' | 'kong';
}

function formatTile(t: MahjongTileType): string {
  const suitChar: Record<string, string> = { bamboo: '\u6761', dots: '\u7B52', characters: '\u4E07' };
  return `${t.value}${suitChar[t.suit] ?? '?'}`;
}

function buildLogEntries(
  wins: WinEvent[],
  kongs: KongPayment[],
  nameOf: (seat: number) => string,
): LogEntry[] {
  let id = 0;
  const entries: LogEntry[] = [];

  for (const w of wins) {
    const fanDetails = w.fan_breakdown.map((f) => `${f.pattern}(${f.fan})`).join(', ');
    entries.push({
      id: id++,
      type: 'win',
      text: `${nameOf(w.winner_seat)} wins with ${formatTile(w.winning_tile)} (${w.total_fan} fan: ${fanDetails}) — ${w.win_type === 'self_draw' ? 'Self draw' : `from ${w.payer_seats.map(nameOf).join(', ')}`}`,
    });
  }

  for (const k of kongs) {
    entries.push({
      id: id++,
      type: 'kong',
      text: `${nameOf(k.declarer_seat)} ${k.kong_type} kong — ${k.points_per_payer} pts from ${k.payer_seats.map(nameOf).join(', ')}`,
    });
  }

  return entries;
}

// ---------- Settlement overlay ----------
function SettlementOverlay({
  settlements,
  nameOf,
  matchId,
}: {
  settlements: Settlement[];
  nameOf: (seat: number) => string;
  matchId: string;
}): React.JSX.Element {
  const sorted = [...settlements].sort((a, b) => a.finish_order - b.finish_order);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Game over results">
      <div className="w-full max-w-md rounded-2xl border border-claw-700 bg-claw-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-center text-xl font-bold text-claw-gold">Game Over</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.seat} className="border-t border-claw-700">
                <td className="px-3 py-2 text-gray-400">{s.finish_order + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-100">{nameOf(s.seat)}</td>
                <td className="px-3 py-2 text-right font-mono text-claw-gold">{s.final_score}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold capitalize ${
                    s.result === 'win'
                      ? 'text-claw-green'
                      : s.result === 'lose'
                        ? 'text-claw-red'
                        : 'text-gray-400'
                  }`}
                >
                  {s.result}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 text-center">
          <Link
            to={`/matches/${matchId}`}
            className="inline-block rounded-lg bg-claw-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Back to Match Details
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------- Connection status dot ----------
function ConnectionDot({ connected }: { connected: boolean }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" aria-live="polite">
      <span
        className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
      />
      {connected ? 'Live' : 'Disconnected'}
    </span>
  );
}

// ---------- Main page component ----------
export function SpectatorPage(): React.JSX.Element {
  const { matchId } = useParams<{ matchId: string }>();

  const [state, setState] = useState<SpectatorView | null>(null);
  const [info, setInfo] = useState<SpectateInfoResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const unmountedRef = useRef(false);
  const shouldReconnectRef = useRef(true);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasReceivedStateRef = useRef(false);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);

  // Seat -> name map
  const nameMapRef = useRef<Map<number, string>>(new Map());
  const nameOf = useCallback(
    (seat: number): string => nameMapRef.current.get(seat) ?? `Seat ${seat + 1}`,
    [],
  );

  // Connect WS
  const connectWs = useCallback(() => {
    if (unmountedRef.current || !matchId) return;

    // W1: Close existing socket before creating a new one
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // W2: Null the reconnect timer ref now that it has fired
    reconnectTimer.current = null;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/spectate?match_id=${matchId}`);
    wsRef.current = ws;

    // W3: Connection timeout – if no spectator_state within 15s, show error
    hasReceivedStateRef.current = false;
    connectTimeoutRef.current = setTimeout(() => {
      if (unmountedRef.current) return;
      if (!hasReceivedStateRef.current) {
        setConnectionTimedOut(true);
        ws.close();
      }
    }, 15000);

    ws.onopen = () => {
      if (unmountedRef.current || ws !== wsRef.current) return;
      setConnected(true);
      backoffRef.current = 1000;
    };

    ws.onmessage = (ev) => {
      // C2: Only process messages from the current socket
      if (unmountedRef.current || ws !== wsRef.current) return;
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; payload?: SpectatorView };
        if (msg.type === 'spectator_state' && msg.payload) {
          // W3: Clear connection timeout on successful state
          hasReceivedStateRef.current = true;
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          setConnectionTimedOut(false);
          setState(msg.payload);
          // C1 + W4: If game is already finished, stop reconnecting and show overlay
          if (msg.payload.is_finished || msg.payload.phase === 'finished') {
            shouldReconnectRef.current = false;
            if (msg.payload.settlements) {
              setShowEnd(true);
            }
          }
        } else if (msg.type === 'game_end') {
          if (msg.payload) setState(msg.payload);
          setShowEnd(true);
          // C1: Game ended, stop reconnecting
          shouldReconnectRef.current = false;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      // C2: Only handle close for the current socket
      if (unmountedRef.current || ws !== wsRef.current) return;
      setConnected(false);
      // C1: Only reconnect if the game hasn't finished
      if (shouldReconnectRef.current) {
        const delay = Math.min(backoffRef.current, 8000);
        backoffRef.current = delay * 2;
        reconnectTimer.current = setTimeout(connectWs, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [matchId]);

  // On mount – fetch info then connect
  useEffect(() => {
    unmountedRef.current = false;
    shouldReconnectRef.current = true;
    if (!matchId) return;

    getSpectateInfo(matchId)
      .then((data) => {
        if (unmountedRef.current) return;
        setInfo(data);
        // W5: Check spectate permission before connecting
        if (!data.can_spectate) {
          setError('This match cannot be spectated');
          return;
        }
        const map = new Map<number, string>();
        for (const p of data.participants) {
          map.set(p.seat, p.name);
        }
        nameMapRef.current = map;
        connectWs();
      })
      .catch((err) => {
        if (!unmountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load spectate info');
        }
      });

    return () => {
      unmountedRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    };
  }, [matchId, connectWs]);

  // ---------- Render ----------

  if (error) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="rounded-xl border border-claw-700 bg-claw-800 p-8 text-center">
          <p className="mb-4 text-lg text-red-400">{error}</p>
          <Link
            to={matchId ? `/matches/${matchId}` : '/matches'}
            className="text-sm text-claw-accent underline"
          >
            &larr; Back
          </Link>
        </div>
      </div>
    );
  }

  if (!state) {
    // W3: Connection timeout – show retry button
    if (connectionTimedOut) {
      return (
        <div className="flex min-h-[80vh] items-center justify-center">
          <div className="rounded-xl border border-claw-700 bg-claw-800 p-8 text-center">
            <p className="mb-4 text-lg text-red-400">Connection failed</p>
            <p className="mb-4 text-sm text-gray-400">Could not connect to the match within 15 seconds.</p>
            <button
              onClick={() => {
                setConnectionTimedOut(false);
                backoffRef.current = 1000;
                shouldReconnectRef.current = true;
                connectWs();
              }}
              className="mr-3 inline-block rounded-lg bg-claw-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Retry
            </button>
            <Link
              to={matchId ? `/matches/${matchId}` : '/matches'}
              className="text-sm text-claw-accent underline"
            >
              &larr; Back
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-2 border-claw-accent border-t-transparent" />
          <p className="text-sm text-gray-400">Connecting to match&hellip;</p>
        </div>
      </div>
    );
  }

  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const bottomPlayer = players.find((p) => p.seat === 0);
  const rightPlayer = players.find((p) => p.seat === 1);
  const topPlayer = players.find((p) => p.seat === 2);
  const leftPlayer = players.find((p) => p.seat === 3);

  const logEntries = buildLogEntries(state.win_events, state.kong_payments, nameOf);

  return (
    <div className="relative flex min-h-screen flex-col bg-claw-900">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-claw-700 bg-claw-800/90 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to={matchId ? `/matches/${matchId}` : '/matches'}
            className="text-sm text-gray-500 transition hover:text-gray-300"
          >
            &larr; Back
          </Link>
          <span className="text-sm font-semibold text-gray-100">
            {info ? `${info.game_type.charAt(0).toUpperCase() + info.game_type.slice(1)} Spectator` : 'Spectator'}
          </span>
        </div>
        <ConnectionDot connected={connected} />
      </div>

      {/* Main content */}
      <div className="flex flex-1">
        {/* Table area */}
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="relative flex h-[640px] w-[800px] flex-col items-center justify-between">
            {/* Top player (seat 2) */}
            <div className="w-full max-w-xs">
              {topPlayer && (
                <PlayerPanel
                  player={topPlayer}
                  isActive={state.current_turn === 2}
                  position="top"
                  playerName={nameOf(2)}
                />
              )}
            </div>

            {/* Middle row: left player, table center, right player */}
            <div className="flex w-full items-center justify-between">
              {/* Left player (seat 3) */}
              <div className="w-40">
                {leftPlayer && (
                  <PlayerPanel
                    player={leftPlayer}
                    isActive={state.current_turn === 3}
                    position="left"
                    playerName={nameOf(3)}
                  />
                )}
              </div>

              {/* Center table */}
              <div className="flex h-48 w-64 flex-col items-center justify-center rounded-xl border border-green-900/50 shadow-inner"
                style={{ backgroundColor: '#1a472a' }}
              >
                <PhaseBadge phase={state.phase} />
                {state.sub_phase && (
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-green-300/60">
                    {state.sub_phase.replace('_', ' ')}
                  </span>
                )}
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-green-200/80">
                  <span>Tiles left</span>
                  <span className="text-right font-mono">{state.tiles_remaining}</span>
                  <span>Turn</span>
                  <span className="text-right font-mono">{state.turn_count}</span>
                </div>
                {state.current_discard && (
                  <div className="mt-3 flex flex-col items-center">
                    <span className="mb-1 text-[10px] uppercase tracking-wider text-green-300/50">
                      Discard
                    </span>
                    <MahjongTile tile={state.current_discard.tile} size="md" highlighted />
                  </div>
                )}
              </div>

              {/* Right player (seat 1) */}
              <div className="w-40">
                {rightPlayer && (
                  <PlayerPanel
                    player={rightPlayer}
                    isActive={state.current_turn === 1}
                    position="right"
                    playerName={nameOf(1)}
                  />
                )}
              </div>
            </div>

            {/* Bottom player (seat 0) */}
            <div className="w-full max-w-xs">
              {bottomPlayer && (
                <PlayerPanel
                  player={bottomPlayer}
                  isActive={state.current_turn === 0}
                  position="bottom"
                  playerName={nameOf(0)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar – event log */}
        <div className="flex w-72 flex-col border-l border-claw-700 bg-claw-800/60">
          <div className="border-b border-claw-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">Event Log</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {logEntries.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-600">No events yet</p>
            ) : (
              <ul className="space-y-2">
                {logEntries.map((e) => (
                  <li
                    key={e.id}
                    className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      e.type === 'win'
                        ? 'border-l-2 border-claw-gold bg-claw-gold/5 text-gray-200'
                        : 'border-l-2 border-blue-500 bg-blue-500/5 text-gray-300'
                    }`}
                  >
                    {e.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Settlement overlay */}
      {showEnd && state.settlements && matchId && (
        <SettlementOverlay settlements={state.settlements} nameOf={nameOf} matchId={matchId} />
      )}
    </div>
  );
}
