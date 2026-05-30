/**
 * Gemini live order book over WebSocket (v2 `l2` market-data channel).
 *
 * Gemini v2 sends an initial `l2_updates` message containing the full book
 * snapshot (the `changes` array), then subsequent `l2_updates` with the changed
 * levels. Each change is [side, price, quantity] where side is "buy"/"sell" and
 * quantity 0 removes the level. Public, no auth.
 *
 *   endpoint : wss://api.gemini.com/v2/marketdata
 *   subscribe: {"type":"subscribe","subscriptions":[{"name":"l2","symbols":["BTCUSD"]}]}
 *   message  : {type:"l2_updates", symbol, changes:[["buy"|"sell", px, qty], ...]}
 *
 * Gemini quotes BTCUSD (not USDT); USD≈USDT for arbitrage. Override via
 * GEMINI_SYMBOL. Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.GEMINI_WS_BASE ?? 'wss://api.gemini.com/v2/marketdata';

interface GeminiMessage {
  type?: string;
  symbol?: string;
  changes?: [string, string, string][]; // [side, price, qty]
}

export class GeminiWsClient {
  readonly id = 'gemini';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private gSymbol: string;
  private gotSnapshot = false;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('gemini', symbol, depth);
    // BTC/USDT -> BTCUSD
    this.gSymbol = process.env.GEMINI_SYMBOL ?? symbol.replace('/', '').replace('USDT', 'USD').toUpperCase();
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
    this.gotSnapshot = false;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'l2', symbols: [this.gSymbol] }] }));
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[gemini] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: GeminiMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'l2_updates' || !msg.changes) return;
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (const [side, px, qty] of msg.changes) {
      const price = parseFloat(px);
      const quantity = parseFloat(qty);
      if (side === 'buy') bids.push([price, quantity]);
      else asks.push([price, quantity]); // "sell"
    }
    // The first l2_updates after subscribe is the full snapshot; the rest deltas.
    if (!this.gotSnapshot) {
      this.book.setSnapshot(bids.filter((l) => l[1] > 0), asks.filter((l) => l[1] > 0));
      this.gotSnapshot = true;
    } else {
      this.book.applyLevels(bids, asks);
    }
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
