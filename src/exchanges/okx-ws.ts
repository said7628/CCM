/**
 * OKX live order book over WebSocket (public `books5` channel).
 *
 * OKX's `books5` channel pushes the full top-5 of the book on every change
 * (~100ms), so there is NO incremental-delta sequencing to get right: each
 * message is a complete snapshot of the levels we care about. For cross-exchange
 * arbitrage we only need the top of book, so this is both the simplest and the
 * lowest-latency option. Public market data needs no API key.
 *
 *   endpoint : wss://ws.okx.com:8443/ws/v5/public
 *   subscribe: {"op":"subscribe","args":[{"channel":"books5","instId":"BTC-USDT"}]}
 *   message  : {arg:{channel,instId}, data:[{asks:[[px,sz,..]], bids:[[px,sz,..]], ts}]}
 *
 * Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.OKX_WS_BASE ?? 'wss://ws.okx.com:8443/ws/v5/public';

interface OkxMessage {
  arg?: { channel?: string; instId?: string };
  event?: string;
  data?: { asks: [string, string, string, string][]; bids: [string, string, string, string][]; ts: string }[];
}

export class OkxWsClient {
  readonly id = 'okx';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private instId: string;
  private pingTimer?: NodeJS.Timeout;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('okx', symbol, depth);
    this.instId = symbol.replace('/', '-').toUpperCase(); // BTC/USDT -> BTC-USDT
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
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    this.book.reset();
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'books5', instId: this.instId }] }));
      // OKX drops idle connections after 30s; keep it warm with a ping frame.
      this.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 20_000);
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[okx] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    const text = raw.toString();
    if (text === 'pong') return;
    let msg: OkxMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.arg?.channel !== 'books5' || !msg.data) return;
    for (const d of msg.data) {
      // books5 sends the full top-5 each time -> treat every message as a snapshot.
      const bids = d.bids.map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
      const asks = d.asks.map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
      this.book.setSnapshot(bids, asks);
    }
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
