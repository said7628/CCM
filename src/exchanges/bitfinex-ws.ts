/**
 * Bitfinex live order book over WebSocket (v2 public `book` channel).
 *
 * Bitfinex sends a snapshot (array of [price, count, amount]) then per-level
 * updates of the same shape. Semantics:
 *   - count > 0  -> level exists/updated. amount > 0 is a BID, amount < 0 is an ASK.
 *   - count = 0  -> remove the level (from bid side if amount==1, ask if amount==-1).
 *   - amount is SIGNED size; we take the absolute value for our book.
 * Public, no auth.
 *
 *   endpoint : wss://api-pub.bitfinex.com/ws/2
 *   subscribe: {"event":"subscribe","channel":"book","symbol":"tBTCUSD","prec":"P0","freq":"F0","len":"25"}
 *   message  : [CHAN_ID, [[price,count,amount], ...]]  (snapshot)
 *              [CHAN_ID, [price,count,amount]]          (update)
 *
 * Bitfinex quotes tBTCUSD; USD≈USDT for arbitrage (tBTCUST also exists — set
 * BITFINEX_SYMBOL=tBTCUST to use the Tether market). Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.BITFINEX_WS_BASE ?? 'wss://api-pub.bitfinex.com/ws/2';

export class BitfinexWsClient {
  readonly id = 'bitfinex';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private bfxSymbol: string;
  private len: string;
  private gotSnapshot = false;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('bitfinex', symbol, depth);
    // BTC/USDT -> tBTCUST (Bitfinex Tether market) by default.
    const base = symbol.split('/')[0].toUpperCase();
    this.bfxSymbol = process.env.BITFINEX_SYMBOL ?? `t${base}UST`;
    this.len = String([1, 25, 100, 250].find((d) => d >= depth) ?? 25);
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
      ws.send(JSON.stringify({ event: 'subscribe', channel: 'book', symbol: this.bfxSymbol, prec: 'P0', freq: 'F0', len: this.len }));
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[bitfinex] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Event objects (subscribed/info/error) are objects, not arrays — ignore.
    if (!Array.isArray(msg)) return;
    const payload = msg[1];
    if (payload === 'hb') return; // heartbeat
    if (!Array.isArray(payload)) return;

    if (Array.isArray(payload[0])) {
      // Snapshot: array of [price, count, amount]
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (const lvl of payload as [number, number, number][]) {
        const [price, count, amount] = lvl;
        if (count > 0) {
          if (amount > 0) bids.push([price, Math.abs(amount)]);
          else asks.push([price, Math.abs(amount)]);
        }
      }
      this.book.setSnapshot(bids, asks);
      this.gotSnapshot = true;
    } else {
      // Single update: [price, count, amount]
      const [price, count, amount] = payload as [number, number, number];
      if (count === 0) {
        // Remove from whichever side: amount 1 => bid, -1 => ask.
        this.book.upsert(amount > 0 ? 'bid' : 'ask', price, 0);
      } else {
        this.book.upsert(amount > 0 ? 'bid' : 'ask', price, Math.abs(amount));
      }
    }
    this.lastMessageAt = Date.now();
    if (this.gotSnapshot) this.onUpdate();
  }
}
