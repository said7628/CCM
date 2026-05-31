/**
 * Multi-pair feeds for triangular arbitrage on a SINGLE exchange. The loop is
 * always anchored on BTC/USDT; each active candidate coin adds two more pairs
 * (COIN/USDT, COIN/BTC). Two implementations behind one tiny interface:
 *   - SimTriFeed: synthetic, deterministic, occasionally dislocates a COIN/BTC
 *     cross so a loop appears (for the demo and tests, no network).
 *   - CcxtTriFeed: polls the real books for the active coins on one exchange.
 *
 * Both accept the active coin set up front and can be told to switch coins (the
 * server rebuilds the feed when the exchange changes; coin changes are applied
 * in place so LIVE polling adjusts which pairs it fetches without a reconnect).
 */
import type { OrderBook, PriceLevel } from '../domain/types';
import { createWsClient, wsSupported, type WsClient } from './ws-source';

export interface TriFeed {
  start(): Promise<void>;
  stop(): Promise<void>;
  getBooks(): Record<string, OrderBook>;
  /** Update the active candidate coins (BTC/USDT always remain the anchors). */
  setCoins?(coins: readonly string[]): void;
  /** Optional per-pair status used by the dashboard to explain missing books. */
  getPairStatuses?(): Record<string, string>;
  /** Optional exact pair universe being synchronized. */
  getRequiredPairs?(): string[];
}

/** All pairs needed to price the loops for a set of candidate coins. */
export function pairsForCoins(coins: readonly string[]): string[] {
  const out = new Set<string>(['BTC/USDT']);
  for (const c of coins) {
    if (c === 'BTC' || c === 'USDT') continue;
    out.add(`${c}/USDT`);
    out.add(`${c}/BTC`);
  }
  return [...out];
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
    // Size levels by approximate quote notional instead of raw base units.
    // That keeps cheap coins (DOGE/XRP/ADA) usable for the same TRI_NOTIONAL
    // as BTC/ETH and prevents the dashboard from being dominated by synthetic
    // "Sin profundidad suficiente" rows.
    const quoteDepth = 7_500 + rng() * 22_500;
    const liq = +(quoteDepth / Math.max(mid, 1e-9)).toFixed(6);
    bids.push({ price: round(mid - step), amount: liq });
    asks.push({ price: round(mid + step), amount: liq });
  }
  return { exchange, symbol, bids, asks, timestamp: Date.now() };
}
function round(x: number): number {
  return x >= 100 ? Math.round(x * 100) / 100 : Math.round(x * 1e6) / 1e6;
}

/** Approximate USD reference prices for the synthetic feed (demo only). */
const SYNTH_USD: Record<string, number> = {
  BTC: 70_000, ETH: 3_500, SOL: 170, XRP: 0.55, BNB: 600,
  ADA: 0.45, DOGE: 0.14, LTC: 85, USDC: 1, EUR: 1.08,
};
function synthUsd(coin: string): number {
  return SYNTH_USD[coin] ?? 100;
}

export class SimTriFeed implements TriFeed {
  private rng = makeRng(7);
  private btc = 70_000;
  /** Per-coin USD mid, mean-reverting random walk. */
  private usd: Record<string, number> = {};
  private coins: string[];
  private books: Record<string, OrderBook> = {};
  private timer?: NodeJS.Timeout;
  constructor(private exchange: string, coins: readonly string[] = ['ETH'], private intervalMs = 200) {
    this.coins = [...coins].filter((c) => c !== 'BTC' && c !== 'USDT');
    if (!this.coins.length) this.coins = ['ETH'];
    for (const c of this.coins) this.usd[c] = synthUsd(c);
    this.regen();
  }
  setCoins(coins: readonly string[]): void {
    const next = [...coins].filter((c) => c !== 'BTC' && c !== 'USDT');
    this.coins = next.length ? next : ['ETH'];
    for (const c of this.coins) if (this.usd[c] === undefined) this.usd[c] = synthUsd(c);
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
  getPairStatuses(): Record<string, string> {
    const statuses: Record<string, string> = {};
    for (const pair of pairsForCoins(this.coins)) statuses[pair] = this.books[pair] ? 'Listo' : 'Cargando';
    return statuses;
  }
  getRequiredPairs(): string[] { return pairsForCoins(this.coins); }
  private regen(): void {
    // Mean-reverting walk for BTC/USD.
    this.btc += (70_000 - this.btc) * 0.05 + this.btc * (this.rng() - 0.5) * 0.0006;
    const books: Record<string, OrderBook> = {
      'BTC/USDT': synthBook(this.exchange, 'BTC/USDT', this.btc, this.rng),
    };
    for (const coin of this.coins) {
      const fair = synthUsd(coin);
      this.usd[coin] += (fair - this.usd[coin]) * 0.05 + this.usd[coin] * (this.rng() - 0.5) * 0.0006;
      const usd = this.usd[coin];
      // COIN/BTC normally tracks usd/btc, but occasionally dislocates -> a loop appears.
      let coinbtc = usd / this.btc;
      if (this.rng() < 0.25) coinbtc *= 1 + (this.rng() - 0.5) * 0.01; // ±0.5%
      books[`${coin}/USDT`] = synthBook(this.exchange, `${coin}/USDT`, usd, this.rng);
      books[`${coin}/BTC`] = synthBook(this.exchange, `${coin}/BTC`, coinbtc, this.rng);
    }
    this.books = books;
  }
}



function pairFromCompact(symbol: string): string {
  const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'EUR', 'USD'];
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) return `${symbol.slice(0, -q.length)}/${q}`;
  }
  return symbol;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

const BINANCE_SPOT_SYMBOL_CACHE = new Map<string, Set<string>>();
const BINANCE_SPOT_ERROR_CACHE = new Map<string, string>();
const CCXT_SPOT_SYMBOL_CACHE = new Map<string, Set<string>>();
const CCXT_SPOT_ERROR_CACHE = new Map<string, string>();



type CcxtMarketLoader = {
  loadMarkets(): Promise<Record<string, { active?: boolean; spot?: boolean }>>;
};

async function loadCcxtSpotSymbols(exchange: string): Promise<Set<string>> {
  const cached = CCXT_SPOT_SYMBOL_CACHE.get(exchange);
  if (cached) return cached;
  const failed = CCXT_SPOT_ERROR_CACHE.get(exchange);
  if (failed) throw new Error(failed);
  try {
    const ccxt = (await import('ccxt')).default as unknown as Record<string, new (cfg: object) => CcxtMarketLoader>;
    const Cls = ccxt[exchange];
    if (!Cls) throw new Error(`Unknown ccxt exchange: ${exchange}`);
    const client = new Cls({ enableRateLimit: true, options: { defaultType: 'spot', defaultSubType: 'spot' } });
    const markets = await client.loadMarkets();
    const symbols = new Set<string>();
    for (const [symbol, m] of Object.entries(markets)) {
      if (m.active === false) continue;
      if (m.spot === false) continue;
      symbols.add(symbol);
    }
    CCXT_SPOT_SYMBOL_CACHE.set(exchange, symbols);
    return symbols;
  } catch (err) {
    const msg = errorMessage(err);
    CCXT_SPOT_ERROR_CACHE.set(exchange, msg);
    throw new Error(msg);
  }
}

async function loadBinanceSpotSymbols(): Promise<Set<string>> {
  const base = process.env.BINANCE_REST_BASE ?? 'https://data-api.binance.vision';
  const cached = BINANCE_SPOT_SYMBOL_CACHE.get(base);
  if (cached) return cached;
  const failed = BINANCE_SPOT_ERROR_CACHE.get(base);
  if (failed) throw new Error(failed);

  const url = `${base}/api/v3/exchangeInfo`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
    const json = (await res.json()) as { symbols?: { symbol: string; status?: string; isSpotTradingAllowed?: boolean }[] };
    const symbols = new Set<string>();
    for (const row of json.symbols ?? []) {
      if (row.status && row.status !== 'TRADING') continue;
      if (row.isSpotTradingAllowed === false) continue;
      symbols.add(pairFromCompact(row.symbol));
    }
    BINANCE_SPOT_SYMBOL_CACHE.set(base, symbols);
    return symbols;
  } catch (err) {
    const msg = errorMessage(err);
    BINANCE_SPOT_ERROR_CACHE.set(base, msg);
    throw new Error(msg);
  }
}

/**
 * Native spot WebSocket triangular feed. For Binance this uses the existing
 * BinanceWsClient, which is hard-wired to data-stream.binance.vision +
 * data-api.binance.vision spot depth snapshots, so it never touches fapi.
 */
export class NativeWsTriFeed implements TriFeed {
  private pairs: string[];
  private clients = new Map<string, WsClient>();
  private books: Record<string, OrderBook> = {};
  private statuses: Record<string, string> = {};
  private running = false;
  private logged = new Set<string>();
  private startedAt: Record<string, number> = {};
  private readonly wsTimeoutMs = Number(process.env.TRI_WS_TIMEOUT_MS ?? 8000);

  constructor(private exchange: string, coins: readonly string[] = ['ETH'], private depth = 20) {
    this.pairs = pairsForCoins(coins);
  }

  async start(): Promise<void> {
    this.running = true;
    await this.rebuildClients();
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.clients.values()].map((c) => c.stop().catch(() => undefined)));
    this.clients.clear();
    this.books = {};
  }

  setCoins(coins: readonly string[]): void {
    this.pairs = pairsForCoins(coins);
    if (this.running) void this.rebuildClients();
  }

  getBooks(): Record<string, OrderBook> {
    const now = Date.now();
    for (const [pair, client] of this.clients) {
      if (client.isReady()) {
        const book = client.getOrderBook();
        this.books[pair] = book;
        this.statuses[pair] = book.bids[0] && book.asks[0] ? 'Listo' : 'Sin liquidez';
      } else if (!this.books[pair]) {
        const age = now - (this.startedAt[pair] ?? now);
        this.statuses[pair] = age >= this.wsTimeoutMs ? 'WebSocket pendiente' : 'Cargando';
      }
    }
    return { ...this.books };
  }

  getPairStatuses(): Record<string, string> {
    this.getBooks();
    for (const pair of this.pairs) if (!this.statuses[pair]) this.statuses[pair] = 'Cargando';
    return { ...this.statuses };
  }

  getRequiredPairs(): string[] { return [...this.pairs]; }

  private async rebuildClients(): Promise<void> {
    const keep = new Set(this.pairs);
    for (const [pair, client] of this.clients) {
      if (!keep.has(pair)) {
        await client.stop().catch(() => undefined);
        this.clients.delete(pair);
        delete this.books[pair];
        delete this.statuses[pair];
      }
    }

    let available: Set<string> | null = null;
    let endpointError: string | null = null;
    try {
      available = this.exchange === 'binance'
        ? await loadBinanceSpotSymbols()
        : await loadCcxtSpotSymbols(this.exchange);
    } catch (err) {
      endpointError = errorMessage(err);
    }

    for (const pair of this.pairs) {
      if (this.clients.has(pair)) continue;
      if (endpointError) {
        this.statuses[pair] = `Endpoint bloqueado: ${endpointError}`;
        this.logOnce('__endpoint__', this.statuses[pair]);
        continue;
      }
      if (available && !available.has(pair)) {
        this.statuses[pair] = 'Par no disponible';
        this.logOnce(pair, this.statuses[pair]);
        continue;
      }
      if (!wsSupported(this.exchange)) {
        this.statuses[pair] = 'Endpoint bloqueado: Sin conector WebSocket';
        this.logOnce(pair, this.statuses[pair]);
        continue;
      }
      try {
        const client = createWsClient(this.exchange, pair, this.depth, () => {
          if (client.isReady()) {
            this.books[pair] = client.getOrderBook();
            const b = this.books[pair];
            this.statuses[pair] = b.bids[0] && b.asks[0] ? 'Listo' : 'Sin liquidez';
          }
        });
        this.clients.set(pair, client);
        this.startedAt[pair] = Date.now();
        this.statuses[pair] = 'Cargando';
        await client.start();
      } catch (err) {
        this.statuses[pair] = `WebSocket pendiente: ${errorMessage(err)}`;
        this.logOnce(pair, this.statuses[pair]);
      }
    }
  }

  private logOnce(pair: string, msg: string): void {
    const key = `${pair}:${msg}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
    const label = pair === '__endpoint__' ? 'endpoint' : pair;
    console.error(`[triangular:${this.exchange}:spot] ${label}: ${msg}`);
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
  private statuses: Record<string, string> = {};
  private pairs: string[];
  constructor(private exchange: string, coins: readonly string[] = ['ETH'], private intervalMs = 1000, private depth = 20) {
    this.pairs = pairsForCoins(coins);
  }

  setCoins(coins: readonly string[]): void {
    this.pairs = pairsForCoins(coins);
    // Drop books for pairs no longer tracked so stale data can't be used.
    const keep = new Set(this.pairs);
    for (const k of Object.keys(this.books)) if (!keep.has(k)) delete this.books[k];
    for (const k of Object.keys(this.statuses)) if (!keep.has(k)) delete this.statuses[k];
    if (this.running) this.startPolling();
  }

  async start(): Promise<void> {
    const ccxt = (await import('ccxt')).default as unknown as Record<string, new (cfg: object) => CcxtExchange>;
    const Cls = ccxt[this.exchange];
    if (!Cls) throw new Error(`Unknown ccxt exchange for triangular: ${this.exchange}`);
    const client = new Cls({
      enableRateLimit: true,
      options: { defaultType: 'spot', defaultSubType: 'spot', fetchMarkets: ['spot'] },
    });
    if (this.exchange === 'binance') {
      try {
        const base = process.env.BINANCE_REST_BASE ?? 'https://data-api.binance.vision';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).options.defaultType = 'spot';
        (client as any).options.defaultSubType = 'spot';
        (client as any).urls.api.public = `${base}/api/v3`;
        (client as any).urls.api.sapi = `${base}/sapi/v1`;
        delete (client as any).urls.api.fapi;
        delete (client as any).urls.api.dapi;
      } catch { /* default */ }
    }
    this.client = client;
    this.running = true;
    await Promise.all(this.pairs.map((p) => this.pollOne(p)));
    this.startPolling();
  }
  private startPolling(): void {
    // Clear any existing schedule, then (re)schedule one loop per current pair.
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const pair of this.pairs) {
      const loop = async (): Promise<void> => {
        if (!this.running) return;
        if (!this.pairs.includes(pair)) return; // pair was removed by setCoins
        await this.pollOne(pair);
        if (this.running && this.pairs.includes(pair)) this.timers.push(setTimeout(loop, this.intervalMs));
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
  getPairStatuses(): Record<string, string> {
    for (const pair of this.pairs) {
      if (this.books[pair]) this.statuses[pair] = this.books[pair].bids[0] && this.books[pair].asks[0] ? 'Listo' : 'Sin liquidez';
      else if (!this.statuses[pair]) this.statuses[pair] = 'Cargando';
    }
    return { ...this.statuses };
  }
  getRequiredPairs(): string[] { return [...this.pairs]; }
  private async pollOne(pair: string): Promise<void> {
    if (!this.client) return;
    try {
      const raw = await this.client.fetchOrderBook(pair, this.depth);
      const lv = (rows: [number, number][]): PriceLevel[] =>
        rows.filter(([p, a]) => p > 0 && a > 0).map(([p, a]) => ({ price: p, amount: a }));
      this.books[pair] = { exchange: this.exchange, symbol: pair, bids: lv(raw.bids), asks: lv(raw.asks), timestamp: raw.timestamp ?? Date.now() };
      this.statuses[pair] = this.books[pair].bids[0] && this.books[pair].asks[0] ? 'Listo' : 'Sin liquidez';
      if (this.errored.has(pair)) { this.errored.delete(pair); }
    } catch (err) {
      if (!this.errored.has(pair)) {
        this.errored.add(pair);
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        const lower = msg.toLowerCase();
        this.statuses[pair] = lower.includes('451') || lower.includes('restricted') || lower.includes('blocked')
          ? `Endpoint bloqueado: ${msg}`
          : (lower.includes('symbol') || lower.includes('market') ? `Par no disponible: ${msg}` : `Sin order book todavía: ${msg}`);
        console.error(`[triangular:${this.exchange}:spot] ${pair} unavailable: ${this.statuses[pair]}`);
      }
    }
  }
}
