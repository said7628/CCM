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
  }
  async stop(): Promise<void> {
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
