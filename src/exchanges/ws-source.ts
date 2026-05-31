/**
 * Event-driven market data source backed by exchange WebSocket clients.
 *
 * Same MarketDataSource contract as the simulator and the REST source, so the
 * engine/CLI/web don't change. The difference is latency: instead of polling on
 * a clock, each client pushes an 'update' the instant a book changes, and the
 * consumer reacts immediately. Requires `npm install ws`.
 */
import { EventEmitter } from 'events';
import type { MarketDataSource } from './source';
import type { OrderBook } from '../domain/types';
import { BinanceWsClient } from './binance-ws';
import { KrakenWsClient } from './kraken-ws';
import { OkxWsClient } from './okx-ws';
import { CoinbaseWsClient } from './coinbase-ws';
import { BitstampWsClient } from './bitstamp-ws';
import { GeminiWsClient } from './gemini-ws';
import { GateWsClient } from './gate-ws';
import { BitfinexWsClient } from './bitfinex-ws';
import { KucoinWsClient } from './kucoin-ws';

export interface WsClient {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  getOrderBook(): OrderBook;
  /** Epoch ms of the last applied message; 0 until the first update. Used by the
   *  freshness watchdog to detect a silently-dropped (connected but mute) feed. */
  lastMessageAt: number;
}

/** Factory: every venue we support over a native WebSocket connector. */
type WsCtor = new (symbol: string, depth: number, onUpdate: () => void) => WsClient;
const WS_CLIENTS: Record<string, WsCtor> = {
  binance: BinanceWsClient,
  kraken: KrakenWsClient,
  okx: OkxWsClient,
  coinbase: CoinbaseWsClient,
  bitstamp: BitstampWsClient,
  gemini: GeminiWsClient,
  gate: GateWsClient,
  bitfinex: BitfinexWsClient,
  kucoin: KucoinWsClient,
};

/** Exchanges that have a native WebSocket connector here. */
export function wsSupported(id: string): boolean {
  return id in WS_CLIENTS;
}

/** Build one native WebSocket order-book client for a single spot symbol. */
export function createWsClient(id: string, symbol: string, depth: number, onUpdate: () => void): WsClient {
  const Ctor = WS_CLIENTS[id];
  if (!Ctor) throw new Error(`No WebSocket client implemented for "${id}"`);
  return new Ctor(symbol, depth, onUpdate);
}

export class WebSocketSource extends EventEmitter implements MarketDataSource {
  readonly name = 'websocket';
  private clients: WsClient[] = [];
  private watchdog?: NodeJS.Timeout;
  /** Reconnect a client if it has gone this long with no message after first sync. */
  private readonly staleMs = Number(process.env.WS_STALE_MS ?? 12_000);

  constructor(exchangeIds: string[], symbol: string, depth: number) {
    super();
    const emit = (): void => {
      this.emit('update');
    };
    for (const id of exchangeIds) {
      const Ctor = WS_CLIENTS[id];
      if (!Ctor) throw new Error(`No WebSocket client implemented for "${id}"`);
      this.clients.push(new Ctor(symbol, depth, emit));
    }
  }

  async start(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.start()));
    // Freshness watchdog: a WebSocket can stay "open" yet stop delivering data
    // (server-side throttle, half-open socket, regional hiccup). The book then
    // freezes at its last value and looks live but isn't. Every few seconds we
    // check each client; if it synced once but has since gone quiet past the
    // stale threshold, we bounce it (stop+start) to force a fresh reconnect.
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const c of this.clients) {
        if (c.lastMessageAt > 0 && now - c.lastMessageAt > this.staleMs) {
          console.warn(`[ws] ${c.id} stale for ${now - c.lastMessageAt}ms — reconnecting`);
          void (async () => {
            try {
              await c.stop();
              await c.start();
            } catch (e) {
              console.error(`[ws] ${c.id} reconnect failed: ${(e as Error).message}`);
            }
          })();
        }
      }
    }, Math.max(3000, Math.floor(this.staleMs / 2)));
    if (typeof this.watchdog.unref === 'function') this.watchdog.unref();
  }
  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
    await Promise.all(this.clients.map((c) => c.stop()));
  }

  /** Only return books from venues that have a synced snapshot. */
  getBooks(): OrderBook[] {
    return this.clients.filter((c) => c.isReady()).map((c) => c.getOrderBook());
  }

  onUpdate(cb: () => void): void {
    this.on('update', cb);
  }
}
