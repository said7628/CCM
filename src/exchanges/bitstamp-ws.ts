/**
 * Bitstamp live order book over WebSocket (`order_book_<pair>` channel).
 *
 * Bitstamp's `order_book` channel pushes the full top-100 bids/asks on every
 * change — a complete snapshot each time, so no delta sequencing. Public, no
 * auth. (There is also a `diff_order_book` channel for full-depth deltas; for
 * arbitrage the top-of-book snapshot channel is simpler and sufficient.)
 *
 *   endpoint : wss://ws.bitstamp.net
 *   subscribe: {"event":"bts:subscribe","data":{"channel":"order_book_btcusdt"}}
 *   message  : {event:"data", channel, data:{bids:[[px,sz]], asks:[[px,sz]], timestamp}}
 *
 * Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.BITSTAMP_WS_BASE ?? 'wss://ws.bitstamp.net';

interface BitstampMessage {
  event?: string;
  channel?: string;
  data?: { bids?: [string, string][]; asks?: [string, string][]; timestamp?: string };
}

export class BitstampWsClient {
  readonly id = 'bitstamp';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private channel: string;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('bitstamp', symbol, depth);
    // BTC/USDT -> order_book_btcusdt
    this.channel = 'order_book_' + symbol.replace('/', '').toLowerCase();
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
      ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: this.channel } }));
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[bitstamp] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: BitstampMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event !== 'data' || !msg.data) return;
    const bids = (msg.data.bids ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    const asks = (msg.data.asks ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    this.book.setSnapshot(bids, asks);
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
