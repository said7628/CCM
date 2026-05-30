/**
 * Server-side engine preferences — persisted to disk so they survive restarts
 * AND are shared across browsers/devices (unlike localStorage, which is
 * per-browser). The dashboard reads these from the SSE state and writes them via
 * /control, so toggling an exchange on your laptop is reflected on your phone.
 *
 * Pure `fs`, atomic write, debounced — same lightweight approach as the P&L
 * persistence layer.
 */
import fs from 'fs';
import path from 'path';

export interface EnginePrefs {
  /** Exchanges the user has enabled. null/empty = all connected venues active. */
  activeExchanges: string[] | null;
  /** Risk appetite multiplier (0.25..4); 1 = configured defaults. */
  riskAppetite: number;
  /** Active strategy id ('cross' | 'triangular' | 'auto'). */
  strategy: string;
}

const DEFAULT_PREFS: EnginePrefs = {
  activeExchanges: null,
  riskAppetite: 1,
  strategy: 'cross',
};

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'arbicore-prefs.json');

export function loadPrefs(): EnginePrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<EnginePrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let pending: NodeJS.Timeout | null = null;
export function savePrefs(prefs: EnginePrefs): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(prefs));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('[prefs] write failed:', (err as Error).message);
    }
  }, 300);
  if (typeof pending.unref === 'function') pending.unref();
}
