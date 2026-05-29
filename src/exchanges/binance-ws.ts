/**
 * Binance live order book over WebSocket (diff-depth stream + REST snapshot).
 *
 * Uses the tested BinanceBookSyncer for all sequencing/correctness; this file is
 * just the socket plumbing: connect, fetch the snapshot, feed events, resync on
 * a detected gap, and reconnect on disconnect. Requires `npm install ws`.
 */
import WebSocket from 'ws';
import { LocalOrderBook } from './localbook';
import { BinanceBookSyncer, type DiffEvent } from './binance-sync';
import type { OrderBook } from '../domain/types';

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const REST_DEPTH = 'https://api.binance.com/api/v3/depth';

export class BinanceWsClient {
  readonly id = 'binance';
  private book: LocalOrderBook;
  private syncer: BinanceBookSyncer;
  private ws?: WebSocket;
  private running = false;
  private restSymbol: string;
  private streamName: string;
  lastMessageAt = 0;

  constructor(
    private symbol: string,
    depth: number,
    private onUpdate: () => void,
  ) {
    this.book = new LocalOrderBook('binance', symbol, depth);
    this.syncer = new BinanceBookSyncer(this.book);
    const compact = symbol.replace('/', '').toUpperCase(); // BTC/USDT -> BTCUSDT
    this.restSymbol = compact;
    this.streamName = `${compact.toLowerCase()}@depth@100ms`;
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
    this.syncer.clearBuffer();
    const ws = new WebSocket(`${WS_BASE}/${this.streamName}`);
    this.ws = ws;
    ws.on('open', () => {
      void this.fetchSnapshot();
    });
    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    ws.on('error', (err: Error) => console.error(`[binance] ws error: ${err.message}`));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this.connect(), 1000);
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: { U?: number; u?: number; b?: [string, string][]; a?: [string, string][] };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.U === undefined || msg.u === undefined) return;
    const evt: DiffEvent = { U: msg.U, u: msg.u, b: parseLevels(msg.b), a: parseLevels(msg.a) };
    const res = this.syncer.applyEvent(evt);
    if (res === 'resync_needed') {
      void this.resync();
    } else if (res === 'applied') {
      this.lastMessageAt = Date.now();
      this.onUpdate();
    }
  }

  private async fetchSnapshot(): Promise<void> {
    try {
      const r = await fetch(`${REST_DEPTH}?symbol=${this.restSymbol}&limit=1000`);
      const json = (await r.json()) as {
        lastUpdateId: number;
        bids: [string, string][];
        asks: [string, string][];
      };
      const res = this.syncer.applySnapshot(parseLevels(json.bids), parseLevels(json.asks), json.lastUpdateId);
      if (res === 'resync_needed') {
        void this.resync();
      } else {
        this.lastMessageAt = Date.now();
        this.onUpdate();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[binance] snapshot failed: ${msg}`);
      if (this.running) setTimeout(() => void this.fetchSnapshot(), 1000);
    }
  }

  private async resync(): Promise<void> {
    this.book.reset();
    this.syncer.clearBuffer();
    await this.fetchSnapshot();
  }
}

function parseLevels(rows?: [string, string][]): [number, number][] {
  if (!rows) return [];
  return rows.map(([p, a]) => [parseFloat(p), parseFloat(a)] as [number, number]);
}
