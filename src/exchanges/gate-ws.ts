/**
 * Gate.io live order book over WebSocket (spot v4 `spot.order_book` channel).
 *
 * The `spot.order_book` channel pushes a limited-depth full snapshot on a short
 * interval (no delta sequencing). Payload is [pair, limit, interval], e.g.
 * ["BTC_USDT", "20", "100ms"]. Public, no auth.
 *
 *   endpoint : wss://api.gateio.ws/ws/v4/
 *   subscribe: {time, channel:"spot.order_book", event:"subscribe", payload:["BTC_USDT","20","100ms"]}
 *   message  : {channel:"spot.order_book", event:"update", result:{bids:[[px,sz]], asks:[[px,sz]], t}}
 *
 * Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const WS_URL = process.env.GATE_WS_BASE ?? 'wss://api.gateio.ws/ws/v4/';

interface GateMessage {
  channel?: string;
  event?: string;
  result?: { bids?: [string, string][]; asks?: [string, string][]; t?: number; status?: string };
}

export class GateWsClient {
  readonly id = 'gate';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private pair: string;
  private limit: string;
  private pingTimer?: NodeJS.Timeout;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('gate', symbol, depth);
    this.pair = symbol.replace('/', '_').toUpperCase(); // BTC/USDT -> BTC_USDT
    // Gate supports order_book limits of 5/10/20/50/100.
    this.limit = String([5, 10, 20, 50, 100].find((d) => d >= depth) ?? 20);
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
      ws.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.order_book',
        event: 'subscribe',
        payload: [this.pair, this.limit, '100ms'],
      }));
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'spot.ping' }));
        }
      }, 20_000);
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[gate] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: GateMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.channel !== 'spot.order_book' || msg.event !== 'update' || !msg.result) return;
    const bids = (msg.result.bids ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    const asks = (msg.result.asks ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    this.book.setSnapshot(bids, asks);
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
