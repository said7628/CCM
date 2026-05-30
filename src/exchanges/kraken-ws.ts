/**
 * Kraken live order book over WebSocket (v2 `book` channel).
 *
 * Kraken pushes a snapshot then incremental updates (qty 0 removes a level). It
 * also publishes a CRC32 checksum of the top-10 levels; we can validate against
 * our locally-computed checksum to catch a desync and resubscribe. Checksum
 * enforcement is opt-in (KRAKEN_CHECKSUM=1) because the exact string formatting
 * is precision-sensitive and should be confirmed against the live feed first;
 * when off, the book is still maintained from snapshot + updates. Requires `ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_V2 = 'wss://ws.kraken.com/v2';

interface KrakenLevel {
  price: number;
  qty: number;
}
interface KrakenBookData {
  symbol: string;
  bids: KrakenLevel[];
  asks: KrakenLevel[];
  checksum?: number;
}
interface KrakenMessage {
  channel?: string;
  type?: 'snapshot' | 'update';
  data?: KrakenBookData[];
}

export class KrakenWsClient {
  readonly id = 'kraken';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private depthOpt: number;
  private validateChecksum: boolean;
  lastMessageAt = 0;

  constructor(
    private symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('kraken', symbol, depth);
    // Kraken supports depth ∈ {10,25,100,500,1000}; pick the smallest that covers.
    this.depthOpt = [10, 25, 100, 500, 1000].find((d) => d >= depth) ?? 25;
    this.validateChecksum = process.env.KRAKEN_CHECKSUM === '1';
  }

  isReady(): boolean {
    return this.book.ready;
  }
  getOrderBook(): OrderBook {
    return this.book.toOrderBook(this.lastMessageAt || Date.now());
  }

  async start(): Promise<void> {
    this.running = true;
    this.connect();
  }
  async stop(): Promise<void> {
    this.running = false;
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    this.book.reset();
    const ws = new WebSocket(WS_V2);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          method: 'subscribe',
          params: { channel: 'book', symbol: [this.symbol], depth: this.depthOpt },
        }),
      );
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[kraken] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: KrakenMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.channel !== 'book' || !msg.data) return;

    for (const d of msg.data) {
      const bids = d.bids.map((l) => [l.price, l.qty] as [number, number]);
      const asks = d.asks.map((l) => [l.price, l.qty] as [number, number]);
      if (msg.type === 'snapshot') {
        this.book.setSnapshot(bids, asks);
      } else {
        this.book.applyLevels(bids, asks);
      }

      if (this.validateChecksum && d.checksum !== undefined) {
        const local = this.book.krakenChecksum((n) => n.toString());
        if (local !== d.checksum) {
          // Desynced — drop and resubscribe for a fresh snapshot.
          console.error('[kraken] checksum mismatch -> resync');
          this.ws?.close();
          return;
        }
      }
    }
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
