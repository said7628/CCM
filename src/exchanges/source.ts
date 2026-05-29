/**
 * Market data abstraction.
 *
 * The engine consumes order books through this interface and doesn't care where
 * they come from. That's what lets us run the exact same bot against a simulated
 * feed (for the console demo and tests, no network needed) and, by swapping the
 * implementation, against live Binance/Kraken connectors (Phase 1) — without
 * touching the engine, CLI, or web layer.
 */
import type { OrderBook, PriceLevel } from '../domain/types';
import { EventEmitter } from 'events';

export interface MarketDataSource {
  readonly name: string;
  /** Begin streaming/polling. */
  start(): Promise<void>;
  /** Stop and clean up. */
  stop(): Promise<void>;
  /** Latest known order books, one per exchange. */
  getBooks(): OrderBook[];
  /**
   * Optional: advance a synthetic source by one step (simulator only). Live
   * sources poll/stream in the background, so they don't implement this.
   */
  advance?(): void;
  /**
   * Optional: subscribe to push updates (event-driven sources: WebSocket and the
   * streaming simulator). When present, consumers react the instant data
   * arrives instead of polling on a clock — the low-latency path.
   */
  onUpdate?(cb: () => void): void;
}

interface SimConfig {
  exchanges: string[];
  symbol: string;
  /** Base mid price the random walk starts from. */
  basePrice: number;
  /** Per-tick volatility (fraction of price). */
  volatility: number;
  /** Probability per tick that an exploitable divergence is injected. */
  divergenceChance: number;
  /** Order-book depth to generate per side. */
  depth: number;
  /** Seed for deterministic runs (tests). */
  seed?: number;
  /** If set, the source self-advances and emits 'update' on this interval (ms). */
  streamIntervalMs?: number;
}

const DEFAULT_SIM: SimConfig = {
  exchanges: ['binance', 'kraken'],
  symbol: 'BTC/USDT',
  basePrice: 70_000,
  volatility: 0.0004,
  divergenceChance: 0.25,
  depth: 12,
  seed: 42,
};

/** Tiny deterministic PRNG (mulberry32) so simulated runs are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulated multi-exchange feed. Each exchange's mid does a small random walk
 * around a shared base price; occasionally one exchange is nudged to create a
 * genuine cross-exchange arbitrage (ask on one < bid on the other) so the engine
 * has something real to find.
 */
export class SimulatedSource extends EventEmitter implements MarketDataSource {
  readonly name = 'simulated';
  private cfg: SimConfig;
  private rng: () => number;
  private mids: Record<string, number>;
  private books: OrderBook[] = [];
  private streamTimer?: NodeJS.Timeout;

  constructor(cfg: Partial<SimConfig> = {}) {
    super();
    this.cfg = { ...DEFAULT_SIM, ...cfg };
    this.rng = makeRng(this.cfg.seed ?? Date.now());
    this.mids = {};
    for (const ex of this.cfg.exchanges) this.mids[ex] = this.cfg.basePrice;
    this.regenerate();
  }

  async start(): Promise<void> {
    if (this.cfg.streamIntervalMs && this.cfg.streamIntervalMs > 0) {
      this.streamTimer = setInterval(() => {
        this.regenerate();
        this.emit('update');
      }, this.cfg.streamIntervalMs);
    }
  }
  async stop(): Promise<void> {
    if (this.streamTimer) clearInterval(this.streamTimer);
    this.streamTimer = undefined;
  }

  onUpdate(cb: () => void): void {
    this.on('update', cb);
  }

  getBooks(): OrderBook[] {
    return this.books;
  }

  /** Advance the simulation one step and rebuild the books. */
  advance(): void {
    this.regenerate();
  }

  private regenerate(): void {
    const { exchanges, volatility, divergenceChance, depth } = this.cfg;
    const reversion = 0.05; // pull mids back toward base so edges appear both ways

    // Mean-reverting random walk for each mid. Without reversion the mids drift
    // apart and only ever favor one trade direction, which would exhaust
    // one-sided inventory; reversion keeps two-directional opportunities flowing.
    for (const ex of exchanges) {
      const shock = (this.rng() - 0.5) * 2 * volatility;
      this.mids[ex] =
        this.mids[ex] + (this.cfg.basePrice - this.mids[ex]) * reversion + this.mids[ex] * shock;
    }

    // Occasionally inject a clean divergence between the first two exchanges.
    if (this.rng() < divergenceChance && exchanges.length >= 2) {
      const edge = this.cfg.basePrice * (0.0008 + this.rng() * 0.0015); // 0.08%..0.23%
      // Push one exchange's mid up so its bid clears the other's ask. The lifted
      // venue alternates, so both trade directions occur over time.
      const lifted = exchanges[this.rng() < 0.5 ? 0 : 1];
      this.mids[lifted] += edge;
    }

    const now = Date.now();
    this.books = exchanges.map((ex) => this.buildBook(ex, this.mids[ex], depth, now));
  }

  private buildBook(exchange: string, mid: number, depth: number, ts: number): OrderBook {
    const spread = mid * 0.00008; // ~0.8 bps half-spread baseline
    const bids: PriceLevel[] = [];
    const asks: PriceLevel[] = [];
    for (let i = 0; i < depth; i++) {
      const step = spread * (1 + i);
      const liq = 0.3 + this.rng() * 1.7; // 0.3..2.0 BTC per level
      bids.push({ price: round2(mid - step), amount: round4(liq) });
      asks.push({ price: round2(mid + step), amount: round4(liq) });
    }
    return { exchange, symbol: this.cfg.symbol, bids, asks, timestamp: ts };
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
