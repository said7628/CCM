/**
 * Coinbase live order book over WebSocket (Advanced Trade `level2` channel).
 *
 * Coinbase sends one `snapshot` message, then `update` messages with per-level
 * changes. A level update carries side ("bid"/"offer"), price_level and
 * new_quantity (0 removes the level). We maintain the book locally. Public
 * market-data channels can be used without authentication.
 *
 *   endpoint : wss://advanced-trade-ws.coinbase.com
 *   subscribe: {"type":"subscribe","product_ids":["BTC-USD"],"channel":"level2"}
 *
 * NOTE: Coinbase quotes BTC against USD (not USDT). We subscribe to BTC-USD and
 * keep the engine's unified symbol label; for arbitrage purposes USD≈USDT, and
 * the tiny basis is part of what makes the cross-venue spread interesting. Set
 * COINBASE_PRODUCT to override (e.g. "BTC-USDT" once listed in your region).
 *
 * Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.COINBASE_WS_BASE ?? 'wss://advanced-trade-ws.coinbase.com';

interface L2Update { side: string; event_time?: string; price_level: string; new_quantity: string }
interface L2Event { type: 'snapshot' | 'update'; product_id: string; updates: L2Update[] }
interface CoinbaseMessage { channel?: string; events?: L2Event[] }

export class CoinbaseWsClient {
  readonly id = 'coinbase';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private product: string;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('coinbase', symbol, depth);
    // BTC/USDT -> BTC-USD (Coinbase's deepest BTC market). Overridable.
    this.product = process.env.COINBASE_PRODUCT ?? symbol.replace('/', '-').replace('USDT', 'USD').toUpperCase();
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
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', product_ids: [this.product], channel: 'level2' }));
      ws.send(JSON.stringify({ type: 'subscribe', product_ids: [this.product], channel: 'heartbeats' }));
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[coinbase] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: CoinbaseMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.channel !== 'l2_data' || !msg.events) return;
    for (const ev of msg.events) {
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (const u of ev.updates) {
        const price = parseFloat(u.price_level);
        const qty = parseFloat(u.new_quantity);
        if (u.side === 'bid') bids.push([price, qty]);
        else asks.push([price, qty]); // "offer"
      }
      if (ev.type === 'snapshot') {
        this.book.setSnapshot(bids.filter((l) => l[1] > 0), asks.filter((l) => l[1] > 0));
      } else {
        this.book.applyLevels(bids, asks);
      }
    }
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
