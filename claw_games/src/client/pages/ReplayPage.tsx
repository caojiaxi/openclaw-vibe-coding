import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PlayerPanel } from '../components/PlayerPanel';
import { MahjongTile } from '../components/MahjongTile';
import { getReplay } from '../api';
import type {
  SpectatorView,
  MahjongTile as MahjongTileType,
  WinEvent,
  KongPayment,
  ReplayData,
} from '../types';

// ---------- Phase badge ----------
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

// ---------- Event log helpers ----------
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

// ---------- Speed options ----------
const SPEEDS = [0.5, 1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

export function ReplayPage(): React.JSX.Element {
  const { matchId } = useParams<{ matchId: string }>();

  // Data
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Playback state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  // Refs for interval
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesRef = useRef<SpectatorView[]>([]);

  // Name map
  const [nameMap, setNameMap] = useState<Record<number, string>>({});

  const nameOf = useCallback(
    (seat: number) => nameMap[seat] ?? `Seat ${seat}`,
    [nameMap],
  );

  // ---------- Fetch replay data ----------
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getReplay(matchId)
      .then((data) => {
        if (cancelled) return;
        setReplay(data);
        framesRef.current = data.frames;

        const map: Record<number, string> = {};
        for (const p of data.participants) {
          map[p.seat] = p.name;
        }
        setNameMap(map);
        setCurrentFrame(0);
        setPlaying(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load replay');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // ---------- Auto-play interval ----------
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!playing) return;

    const ms = 1000 / speed;
    intervalRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        const maxFrame = framesRef.current.length - 1;
        if (prev >= maxFrame) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, ms);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, speed]);

  // ---------- Controls ----------
  const stepBack = useCallback(() => {
    setPlaying(false);
    setCurrentFrame((prev) => Math.max(0, prev - 1));
  }, []);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setCurrentFrame((prev) => Math.min(framesRef.current.length - 1, prev + 1));
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      // If at last frame and pressing play, restart from beginning
      if (!prev && currentFrame >= framesRef.current.length - 1) {
        setCurrentFrame(0);
      }
      return !prev;
    });
  }, [currentFrame]);

  const seekTo = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  // ---------- Loading / error states ----------
  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-2 border-claw-accent border-t-transparent" />
          <p className="text-sm text-gray-400">Loading replay&hellip;</p>
        </div>
      </div>
    );
  }

  if (error || !replay || replay.frames.length === 0) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="rounded-xl border border-claw-700 bg-claw-800 p-8 text-center">
          <p className="mb-4 text-lg text-red-400">{error ?? 'No replay data available'}</p>
          <Link
            to={matchId ? `/matches/${matchId}` : '/matches'}
            className="text-sm text-claw-accent underline"
          >
            &larr; Back to Match
          </Link>
        </div>
      </div>
    );
  }

  // ---------- Render current frame ----------
  const state = replay.frames[currentFrame];
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const bottomPlayer = players.find((p) => p.seat === 0);
  const rightPlayer = players.find((p) => p.seat === 1);
  const topPlayer = players.find((p) => p.seat === 2);
  const leftPlayer = players.find((p) => p.seat === 3);

  const logEntries = buildLogEntries(state.win_events, state.kong_payments, nameOf);
  const totalFrames = replay.frames.length;

  // Build thinking entries from actions up to current frame (skip auto actions)
  const thinkingEntries = replay.actions
    .slice(0, currentFrame)
    .map((a, i) => ({ ...a, frameIdx: i + 1 }))
    .filter(a => a.reason && a.reason !== 'auto (single option)')
    .reverse()
    .slice(0, 30);

  const ACTION_ZH: Record<string, string> = {
    declare_lack: '定缺', draw: '摸牌', discard: '打牌',
    pong: '碰', kong: '杠', hu: '胡', pass: '过',
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-claw-900">
      {/* Top bar */}
      <div className="flex-none flex items-center justify-between border-b border-claw-700 bg-claw-800/90 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to={matchId ? `/matches/${matchId}` : '/matches'}
            className="text-sm text-gray-500 transition hover:text-gray-300"
          >
            &larr; Back
          </Link>
          <span className="text-sm font-semibold text-gray-100">
            Mahjong Replay
          </span>
          <span className="rounded bg-claw-700 px-2 py-0.5 text-xs text-gray-400">
            🔄 Replay
          </span>
        </div>
      </div>

      {/* Main content — fills between top bar and bottom control bar */}
      <div className="flex flex-1 min-h-0">
        {/* Table area — 3x3 grid, 4 players around center */}
        <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
          <div className="grid grid-cols-[minmax(200px,1fr)_auto_minmax(200px,1fr)] grid-rows-[auto_1fr_auto] gap-2 max-w-[1100px] max-h-full w-full">

            {/* Row 1 col 1: empty */}
            <div />
            {/* Row 1 col 2: Top player (seat 2) */}
            <div className="flex justify-center">
              {topPlayer && (
                <div className="w-[360px]">
                  <PlayerPanel player={topPlayer} isActive={state.current_turn === 2} position="top" playerName={nameOf(2)} />
                </div>
              )}
            </div>
            {/* Row 1 col 3: empty */}
            <div />

            {/* Row 2 col 1: Left player (seat 3) */}
            <div className="flex items-start justify-end">
              <div className="w-full max-w-[320px]">
                {leftPlayer && (
                  <PlayerPanel player={leftPlayer} isActive={state.current_turn === 3} position="left" playerName={nameOf(3)} />
                )}
              </div>
            </div>

            {/* Row 2 col 2: Center table */}
            <div className="flex items-center justify-center">
              <div
                className="flex h-44 w-60 flex-col items-center justify-center rounded-xl border border-green-900/50 shadow-inner flex-none"
                style={{ backgroundColor: '#1a472a' }}
              >
                <PhaseBadge phase={state.phase} />
                {state.sub_phase && (
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-green-300/60">
                    {state.sub_phase.replace('_', ' ')}
                  </span>
                )}
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-green-200/80">
                  <span>Tiles left</span>
                  <span className="text-right font-mono">{state.tiles_remaining}</span>
                  <span>Turn</span>
                  <span className="text-right font-mono">{state.turn_count}</span>
                </div>
                {state.current_discard && (
                  <div className="mt-2 flex flex-col items-center">
                    <span className="mb-0.5 text-[10px] uppercase tracking-wider text-green-300/50">
                      Discard
                    </span>
                    <MahjongTile tile={state.current_discard.tile} size="md" highlighted />
                  </div>
                )}
              </div>
            </div>

            {/* Row 2 col 3: Right player (seat 1) */}
            <div className="flex items-start justify-start">
              <div className="w-full max-w-[320px]">
                {rightPlayer && (
                  <PlayerPanel player={rightPlayer} isActive={state.current_turn === 1} position="right" playerName={nameOf(1)} />
                )}
              </div>
            </div>

            {/* Row 3 col 1: empty */}
            <div />
            {/* Row 3 col 2: Bottom player (seat 0) */}
            <div className="flex justify-center">
              {bottomPlayer && (
                <div className="w-[360px]">
                  <PlayerPanel player={bottomPlayer} isActive={state.current_turn === 0} position="bottom" playerName={nameOf(0)} />
                </div>
              )}
            </div>
            {/* Row 3 col 3: empty */}
            <div />

          </div>
        </div>

        {/* Right sidebar – AI thinking + event log, independent scroll */}
        <div className="flex w-80 flex-none flex-col border-l border-claw-700 bg-claw-800/60">
          <div className="flex-none border-b border-claw-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">🤖 AI Thinking</h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            {thinkingEntries.length === 0 && logEntries.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-600">Advance frames to see AI decisions...</p>
            ) : (
              <ul className="space-y-2">
                {thinkingEntries.map((t, i) => {
                  const p = replay.participants.find(pp => pp.agent_id === t.agent_id);
                  const name = p ? p.name : t.agent_id.slice(0, 8);
                  return (
                    <li key={`t-${t.frameIdx}-${i}`} className={`rounded-lg border-l-2 px-3 py-2 text-xs leading-relaxed ${t.frameIdx === currentFrame ? 'border-claw-gold bg-claw-gold/10' : 'border-purple-500 bg-purple-500/5'}`}>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="font-semibold text-purple-300">{name}</span>
                        <span className="text-gray-500">→</span>
                        <span className="font-mono text-claw-gold">{ACTION_ZH[t.type] ?? t.type}</span>
                        <span className="ml-auto text-gray-600">#{t.frameIdx}</span>
                      </div>
                      <p className="text-gray-400">{t.reason}</p>
                    </li>
                  );
                })}
                {logEntries.map((e) => (
                  <li key={`ev-${e.id}`} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    e.type === 'win' ? 'border-l-2 border-claw-gold bg-claw-gold/5 text-gray-200'
                    : 'border-l-2 border-blue-500 bg-blue-500/5 text-gray-300'
                  }`}>{e.text}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Bottom control bar — static within flex column, not fixed */}
      <div className="flex-none flex h-14 items-center justify-between border-t border-claw-700 bg-claw-800 px-4">
        {/* Left: playback buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={stepBack}
            disabled={currentFrame === 0}
            className="rounded-lg px-3 py-2 text-lg text-gray-300 transition hover:bg-claw-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            title="Step back"
          >
            ⏮
          </button>
          <button
            onClick={togglePlay}
            className="rounded-lg px-3 py-2 text-lg text-gray-300 transition hover:bg-claw-700 hover:text-white"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={stepForward}
            disabled={currentFrame >= totalFrames - 1}
            className="rounded-lg px-3 py-2 text-lg text-gray-300 transition hover:bg-claw-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            title="Step forward"
          >
            ⏭
          </button>
        </div>

        {/* Center: progress bar */}
        <div className="mx-4 flex flex-1 items-center">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="w-full cursor-pointer accent-claw-accent"
          />
        </div>

        {/* Right: speed selector + frame counter */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded px-2 py-1 text-xs font-semibold transition ${
                  speed === s
                    ? 'bg-claw-accent text-white'
                    : 'bg-claw-700 text-gray-400 hover:bg-claw-600 hover:text-gray-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <span className="min-w-[5rem] text-right font-mono text-xs text-gray-400">
            {currentFrame + 1} / {totalFrames}
          </span>
        </div>
      </div>
    </div>
  );
}
