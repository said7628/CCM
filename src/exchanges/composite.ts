/**
 * Composite market data source.
 *
 * Real venues have different reachability and latency profiles. This source
 * combines several underlying MarketDataSources behind one interface — e.g. a
 * WebSocketSource for binance+kraken (low latency, reachable via data-only
 * mirror) and a ccxt LiveSource for okx+coinbase (REST). The engine, CLI and web
 * layer see a single unified book feed and don't care how each venue arrives.
 *
 * It emits 'update' whenever any push-based part updates, plus on a steady timer
 * so REST-polled parts are picked up too. A venue that's geo-blocked simply
 * never contributes books and is skipped — the engine trades whatever is live.
 */
import { EventEmitter } from 'events';
import type { MarketDataSource } from './source';
import type { OrderBook } from '../domain/types';

export class CompositeSource extends EventEmitter implements MarketDataSource {
  readonly name = 'composite';
  private timer?: NodeJS.Timeout;

  constructor(
    private parts: MarketDataSource[],
    private restPollMs = 300,
  ) {
    super();
  }

  async start(): Promise<void> {
    await Promise.all(this.parts.map((p) => p.start()));
    // Forward push updates from event-driven parts (WebSocket).
    for (const p of this.parts) {
      if (p.onUpdate) p.onUpdate(() => this.emit('update'));
    }
    // Steady heartbeat so REST-polled parts (which don't push) are re-evaluated.
    this.timer = setInterval(() => this.emit('update'), this.restPollMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.parts.map((p) => p.stop()));
  }

  getBooks(): OrderBook[] {
    return this.parts.flatMap((p) => p.getBooks());
  }

  onUpdate(cb: () => void): void {
    this.on('update', cb);
  }
}
