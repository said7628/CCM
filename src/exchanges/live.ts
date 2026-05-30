/**
 * Live market data source (Binance, Kraken, ... via ccxt).
 *
 * Implements the same MarketDataSource interface as the simulator, so the
 * engine/CLI/web don't change at all — you just construct this instead:
 *
 *     const source = new LiveSource(['binance','kraken'], 'BTC/USDT', 20, 1000);
 *
 * This uses REST polling (ccxt.fetchOrderBook) which is simple and rock-solid
 * for a first live run. A WebSocket variant (ccxt.pro / raw ws) can drop latency
 * further and slot in behind the same interface — see notes at the bottom.
 *
 * NOTE: requires `npm install ccxt`. ccxt normalizes the unified symbol
 * 'BTC/USDT' across exchanges (e.g. it maps to XBT/USDT on Kraken internally),
 * and returns bids sorted desc / asks sorted asc — exactly our invariant.
 */
import ccxt from 'ccxt';
import type { MarketDataSource } from './source';
import type { OrderBook, PriceLevel } from '../domain/types';

type CcxtExchange = {
  fetchOrderBook(symbol: string, limit?: number): Promise<{
    bids: [number, number][];
    asks: [number, number][];
    timestamp?: number | null;
  }>;
};

export class LiveSource implements MarketDataSource {
  readonly name = 'live';
  private clients: Record<string, CcxtExchange> = {};
  private books: Record<string, OrderBook> = {};
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private errored = new Set<string>();

  constructor(
    private exchangeIds: string[],
    private symbol: string,
    private depth = 20,
    private pollIntervalMs = 1000,
  ) {}

  async start(): Promise<void> {
    // Instantiate ccxt clients: spot-only (avoids loading geo-restricted futures
    // markets), with built-in rate limiting.
    for (const id of this.exchangeIds) {
      const ExchangeClass = (ccxt as unknown as Record<string, new (cfg: object) => CcxtExchange>)[id];
      if (!ExchangeClass) throw new Error(`Unknown ccxt exchange: ${id}`);
      const cfg: Record<string, unknown> = {
        enableRateLimit: true,
        options: id === 'binance' ? { defaultType: 'spot', fetchMarkets: ['spot'] } : { defaultType: 'spot' },
      };
      const client = new ExchangeClass(cfg);
      // Binance's main + futures hosts return HTTP 451 from many datacenter IPs;
      // redirect spot public market-data calls to the data-only mirror.
      if (id === 'binance') {
        try {
          const base = process.env.BINANCE_REST_BASE ?? 'https://data-api.binance.vision';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).urls.api.public = `${base}/api/v3`;
        } catch {
          /* fall back to ccxt default if the structure differs */
        }
      }
      this.clients[id] = client;
    }
    this.running = true;

    // Prime the books once so the engine has data on the first tick.
    await Promise.all(this.exchangeIds.map((id) => this.pollOne(id)));

    // Each exchange polls on its own loop so a slow venue doesn't block others.
    for (const id of this.exchangeIds) {
      const loop = async (): Promise<void> => {
        if (!this.running) return;
        await this.pollOne(id);
        if (this.running) this.timers.push(setTimeout(loop, this.pollIntervalMs));
      };
      this.timers.push(setTimeout(loop, this.pollIntervalMs));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  getBooks(): OrderBook[] {
    return Object.values(this.books);
  }

  private async pollOne(id: string): Promise<void> {
    try {
      const raw = await this.clients[id].fetchOrderBook(this.symbol, this.depth);
      const toLevels = (rows: [number, number][]): PriceLevel[] =>
        rows
          .filter(([price, amount]) => price > 0 && amount > 0)
          .map(([price, amount]) => ({ price, amount }));
      this.books[id] = {
        exchange: id,
        symbol: this.symbol,
        bids: toLevels(raw.bids),
        asks: toLevels(raw.asks),
        timestamp: raw.timestamp ?? Date.now(),
      };
      if (this.errored.has(id)) {
        this.errored.delete(id);
        console.log(`[${id}] recovered — order book streaming again`);
      }
    } catch (err) {
      // Log the first failure per venue only, then go quiet (a permanently
      // geo-blocked venue is simply skipped; the engine trades the rest).
      if (!this.errored.has(id)) {
        this.errored.add(id);
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        console.error(`[${id}] unavailable, skipping this venue: ${msg}`);
      }
    }
  }
}

/*
 * Lower-latency upgrade path (same interface, drop-in):
 *  - Use ccxt.pro (`import { pro as ccxtpro } from 'ccxt'`) and watchOrderBook()
 *    to receive push updates over WebSocket instead of polling.
 *  - Or connect raw WS streams:
 *      Binance: wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms
 *      Kraken:  wss://ws.kraken.com  (subscribe {"event":"subscribe",
 *               "pair":["XBT/USDT"],"subscription":{"name":"book","depth":25}})
 *    maintaining a local book and updating `this.books[id]` on each message.
 * Either way, getBooks() stays identical and nothing downstream changes.
 */
