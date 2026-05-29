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

interface WsClient {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  getOrderBook(): OrderBook;
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
      if (id === 'binance') this.clients.push(new BinanceWsClient(symbol, depth, emit));
      else if (id === 'kraken') this.clients.push(new KrakenWsClient(symbol, depth, emit));
      else throw new Error(`No WebSocket client implemented for "${id}"`);
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
