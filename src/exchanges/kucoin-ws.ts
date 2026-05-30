/**
 * KuCoin live order book over WebSocket (`level2Depth5` channel).
 *
 * IMPORTANT — the ONE unavoidable non-WS call: KuCoin requires a single POST to
 * /api/v1/bullet-public to obtain a connection token and the WS endpoint before
 * you may open the socket. This is a one-time handshake mandated by their API,
 * not data polling — once connected, ALL market data arrives over WebSocket with
 * zero further HTTP. If a fully zero-HTTP setup is a hard requirement, omit
 * 'kucoin' from EXCHANGES; every other venue here is pure WebSocket.
 *
 * The `level2Depth5` channel pushes the full top-5 each tick (no delta
 * sequencing) — ideal for arbitrage top-of-book. Public token, no API key.
 *
 *   token POST: https://api.kucoin.com/api/v1/bullet-public
 *   subscribe : {id, type:"subscribe", topic:"/spotMarket/level2Depth5:BTC-USDT", response:true}
 *   message   : {topic, type:"message", data:{asks:[[px,sz]], bids:[[px,sz]], timestamp}}
 *
 * Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import type { OrderBook } from '../domain/types';

const TOKEN_URL = process.env.KUCOIN_REST_BASE ?? 'https://api.kucoin.com';

interface KucoinMessage {
  type?: string;
  topic?: string;
  data?: { asks?: [string, string][]; bids?: [string, string][]; timestamp?: number };
}

export class KucoinWsClient {
  readonly id = 'kucoin';
  private book: LocalOrderBook;
  private ws?: WebSocket;
  private running = false;
  private kSymbol: string;
  private topic: string;
  private pingTimer?: NodeJS.Timeout;
  private pingIntervalMs = 18_000;
  lastMessageAt = 0;

  constructor(
    symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('kucoin', symbol, depth);
    this.kSymbol = symbol.replace('/', '-').toUpperCase(); // BTC/USDT -> BTC-USDT
    this.topic = `/spotMarket/level2Depth5:${this.kSymbol}`;
  }

  isReady(): boolean {
    return this.book.ready;
  }
  getOrderBook(): OrderBook {
    return this.book.toOrderBook(this.lastMessageAt || Date.now());
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connect();
  }
  async stop(): Promise<void> {
    this.running = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  private async connect(): Promise<void> {
    this.book.reset();
    try {
      // One-time token handshake (mandated by KuCoin's API).
      const r = await fetch(`${TOKEN_URL}/api/v1/bullet-public`, { method: 'POST' });
      const json = (await r.json()) as {
        data?: { token: string; instanceServers: { endpoint: string; pingInterval: number }[] };
      };
      const server = json.data?.instanceServers?.[0];
      const token = json.data?.token;
      if (!server || !token) throw new Error('no token/instanceServer in bullet-public response');
      if (server.pingInterval) this.pingIntervalMs = Math.max(5000, server.pingInterval - 2000);

      const url = `${server.endpoint}?token=${token}&connectId=arbicore-${Date.now()}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: Date.now(), type: 'subscribe', topic: this.topic, response: true }));
        this.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
        }, this.pingIntervalMs);
      });
      ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
      ws.on('error', (err: Error) => console.error(`[kucoin] ws error: ${err.message}`));
      ws.on('close', () => {
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.running) setTimeout(() => void this.connect(), 1500);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kucoin] connect failed: ${msg}`);
      if (this.running) setTimeout(() => void this.connect(), 2000);
    }
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: KucoinMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'message' || msg.topic !== this.topic || !msg.data) return;
    const bids = (msg.data.bids ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    const asks = (msg.data.asks ?? []).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as [number, number]);
    this.book.setSnapshot(bids, asks); // level2Depth5 is a full top-5 snapshot each push
    this.lastMessageAt = Date.now();
    this.onUpdate();
  }
}
