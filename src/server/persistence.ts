/**
 * Lightweight persistence — zero dependencies, pure `fs`.
 *
 * P&L/trade history is stored in independent buckets by data mode (LIVE/SIM)
 * and strategy (Cross-Exchange/Triangular) so backtesting never mixes real and
 * simulated executions, nor cross-exchange with triangular routes.
 */
import fs from 'fs';
import path from 'path';

export type PersistedMode = 'live' | 'sim';
export type PersistedStrategy = 'cross' | 'triangular';

export interface PnlPoint { t: number; pnl: number; value: number }
export interface PersistedBucket {
  pnlHistory: PnlPoint[];
  trades: unknown[];
  stats?: unknown;
}

export interface PersistedState {
  savedAt: number;
  /** Legacy/session curve kept for old readers; mirrors the current cross bucket. */
  pnlHistory: PnlPoint[];
  trades: unknown[];
  stats: unknown;
  buckets: Record<PersistedMode, Record<PersistedStrategy, PersistedBucket>>;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'arbicore-state.json');

const emptyBucket = (): PersistedBucket => ({ pnlHistory: [], trades: [] });
export function emptyState(): PersistedState {
  return {
    savedAt: Date.now(),
    pnlHistory: [],
    trades: [],
    stats: {},
    buckets: {
      live: { cross: emptyBucket(), triangular: emptyBucket() },
      sim: { cross: emptyBucket(), triangular: emptyBucket() },
    },
  };
}

function normalizeState(parsed: Partial<PersistedState> | null | undefined): PersistedState {
  const state = emptyState();
  if (!parsed || typeof parsed !== 'object') return state;
  state.savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now();
  state.pnlHistory = Array.isArray(parsed.pnlHistory) ? parsed.pnlHistory : [];
  state.trades = Array.isArray(parsed.trades) ? parsed.trades : [];
  state.stats = parsed.stats ?? {};

  const rawBuckets = parsed.buckets as PersistedState['buckets'] | undefined;
  for (const mode of ['live', 'sim'] as PersistedMode[]) {
    for (const strategy of ['cross', 'triangular'] as PersistedStrategy[]) {
      const raw = rawBuckets?.[mode]?.[strategy];
      if (raw) {
        state.buckets[mode][strategy] = {
          pnlHistory: Array.isArray(raw.pnlHistory) ? raw.pnlHistory : [],
          trades: Array.isArray(raw.trades) ? raw.trades : [],
          stats: raw.stats,
        };
      }
    }
  }

  // Backward compatibility: old files only had one session-level cross curve.
  if (!rawBuckets && (state.pnlHistory.length || state.trades.length)) {
    state.buckets.sim.cross = { pnlHistory: state.pnlHistory, trades: state.trades, stats: state.stats };
  }
  return state;
}

/** Load persisted state on boot. Returns an empty normalized state if nothing valid is on disk. */
export function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return normalizeState(JSON.parse(raw) as Partial<PersistedState>);
  } catch {
    return emptyState();
  }
}

let pending: NodeJS.Timeout | null = null;
let queued: PersistedState | null = null;
let lastWrite = 0;
const MIN_INTERVAL_MS = 4000;

function writeNow(state: PersistedState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

/** Debounced atomic save. Safe to call on every tick; disk writes are throttled. */
export function saveState(state: PersistedState): void {
  queued = state;
  if (pending) return;
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastWrite));
  pending = setTimeout(() => {
    pending = null;
    lastWrite = Date.now();
    try {
      if (queued) writeNow(queued);
    } catch (err) {
      console.error('[persist] write failed:', (err as Error).message);
    }
  }, wait);
  if (typeof pending.unref === 'function') pending.unref();
}

/** Flush immediately (e.g. on SIGINT) so the last few seconds aren't lost. */
export function flushState(state: PersistedState): void {
  try { writeNow(state); } catch { /* best-effort */ }
}
