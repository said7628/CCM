/**
 * Three-pair feeds for triangular arbitrage (BTC/USDT, ETH/USDT, ETH/BTC) on a
 * single exchange. Two implementations behind one tiny interface:
 *   - SimTriFeed: synthetic, deterministic, occasionally dislocates ETH/BTC so a
 *     loop appears (for the demo and tests, no network).
 *   - CcxtTriFeed: polls the three real books on one exchange via ccxt.
 */
import type { OrderBook, PriceLevel } from '../domain/types';
import { TRIANGLE_PAIRS } from './triangular';

export interface TriFeed {
  start(): Promise<void>;
  stop(): Promise<void>;
  getBooks(): Record<string, OrderBook>;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthBook(exchange: string, symbol: string, mid: number, rng: () => number, depth = 9): OrderBook {
  const half = mid * 0.00008;
  const bids: PriceLevel[] = []; const asks: PriceLevel[] = [];
  for (let i = 0; i < depth; i++) {
    const step = half * (1 + i);
    const liq = +(0.5 + rng() * 4).toFixed(4);
    bids.push({ price: round(mid - step), amount: liq });
    asks.push({ price: round(mid + step), amount: liq });
  }
  return { exchange, symbol, bids, asks, timestamp: Date.now() };
}
function round(x: number): number {
  return x >= 100 ? Math.round(x * 100) / 100 : Math.round(x * 1e6) / 1e6;
}

export class SimTriFeed implements TriFeed {
  private rng = makeRng(7);
  private btc = 70_000;
  private eth = 3_500;
  private books: Record<string, OrderBook> = {};
  private timer?: NodeJS.Timeout;
  constructor(private exchange: string, private intervalMs = 200) {
    this.regen();
  }
  async start(): Promise<void> {
    this.timer = setInterval(() => this.regen(), this.intervalMs);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }
  getBooks(): Record<string, OrderBook> {
    return this.books;
  }
  private regen(): void {
    // Mean-reverting walks for the two USD legs.
    this.btc += (70_000 - this.btc) * 0.05 + this.btc * (this.rng() - 0.5) * 0.0006;
    this.eth += (3_500 - this.eth) * 0.05 + this.eth * (this.rng() - 0.5) * 0.0006;
    // ETH/BTC normally tracks eth/btc, but occasionally dislocates -> a loop appears.
    let ethbtc = this.eth / this.btc;
    if (this.rng() < 0.25) ethbtc *= 1 + (this.rng() - 0.5) * 0.01; // ±0.5%
    this.books = {
      'BTC/USDT': synthBook(this.exchange, 'BTC/USDT', this.btc, this.rng),
      'ETH/USDT': synthBook(this.exchange, 'ETH/USDT', this.eth, this.rng),
      'ETH/BTC': synthBook(this.exchange, 'ETH/BTC', ethbtc, this.rng),
    };
  }
}

type CcxtExchange = {
  fetchOrderBook(symbol: string, limit?: number): Promise<{ bids: [number, number][]; asks: [number, number][]; timestamp?: number | null }>;
};

export class CcxtTriFeed implements TriFeed {
  private client?: CcxtExchange;
  private books: Record<string, OrderBook> = {};
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private errored = new Set<string>();
  constructor(private exchange: string, private intervalMs = 1000, private depth = 20) {}

  async start(): Promise<void> {
    const ccxt = (await import('ccxt')).default as unknown as Record<string, new (cfg: object) => CcxtExchange>;
    const Cls = ccxt[this.exchange];
    if (!Cls) throw new Error(`Unknown ccxt exchange for triangular: ${this.exchange}`);
    const client = new Cls({ enableRateLimit: true, options: { defaultType: 'spot' } });
    if (this.exchange === 'binance') {
      try {
        const base = process.env.BINANCE_REST_BASE ?? 'https://data-api.binance.vision';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).urls.api.public = `${base}/api/v3`;
      } catch { /* default */ }
    }
    this.client = client;
    this.running = true;
    await Promise.all(TRIANGLE_PAIRS.map((p) => this.pollOne(p)));
    for (const pair of TRIANGLE_PAIRS) {
      const loop = async (): Promise<void> => {
        if (!this.running) return;
        await this.pollOne(pair);
        if (this.running) this.timers.push(setTimeout(loop, this.intervalMs));
      };
      this.timers.push(setTimeout(loop, this.intervalMs));
    }
  }
  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
  getBooks(): Record<string, OrderBook> {
    return this.books;
  }
  private async pollOne(pair: string): Promise<void> {
    if (!this.client) return;
    try {
      const raw = await this.client.fetchOrderBook(pair, this.depth);
      const lv = (rows: [number, number][]): PriceLevel[] =>
        rows.filter(([p, a]) => p > 0 && a > 0).map(([p, a]) => ({ price: p, amount: a }));
      this.books[pair] = { exchange: this.exchange, symbol: pair, bids: lv(raw.bids), asks: lv(raw.asks), timestamp: raw.timestamp ?? Date.now() };
      if (this.errored.has(pair)) { this.errored.delete(pair); }
    } catch (err) {
      if (!this.errored.has(pair)) {
        this.errored.add(pair);
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        console.error(`[triangular:${this.exchange}] ${pair} unavailable: ${msg}`);
      }
    }
  }
}
