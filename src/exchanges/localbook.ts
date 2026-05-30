/**
 * Local order book maintenance for low-latency WebSocket feeds.
 *
 * WebSocket feeds push *incremental* updates: you receive a snapshot once, then
 * a stream of deltas (a level's new size, or size 0 = remove). To always have a
 * correct top-of-book we maintain the book locally as price→size maps and only
 * materialize a sorted, depth-capped OrderBook when the engine reads it.
 *
 * This module is pure and fully unit-tested — it's the part that has to be
 * correct for the live connectors to work, so we pin it down with mock events
 * rather than trusting it against the wire.
 */
import type { OrderBook, PriceLevel } from '../domain/types';

export class LocalOrderBook {
  private bids = new Map<number, number>(); // price -> size
  private asks = new Map<number, number>();
  /** Last applied update id (Binance) — used for sequence validation. */
  lastUpdateId = 0;
  /** True once a snapshot has been applied. */
  ready = false;

  constructor(
    private exchange: string,
    private symbol: string,
    private depth = 50,
  ) {}

  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateId = 0;
    this.ready = false;
  }

  /** Replace the entire book from a snapshot. */
  setSnapshot(bids: [number, number][], asks: [number, number][], lastUpdateId = 0): void {
    this.bids.clear();
    this.asks.clear();
    for (const [p, a] of bids) if (a > 0) this.bids.set(p, a);
    for (const [p, a] of asks) if (a > 0) this.asks.set(p, a);
    this.lastUpdateId = lastUpdateId;
    this.ready = true;
  }

  /** Upsert a single level; size <= 0 removes it. */
  upsert(side: 'bid' | 'ask', price: number, size: number): void {
    const m = side === 'bid' ? this.bids : this.asks;
    if (size <= 0) m.delete(price);
    else m.set(price, size);
  }

  /** Apply a batch of delta levels (the common WebSocket update shape). */
  applyLevels(bidLevels: [number, number][], askLevels: [number, number][]): void {
    for (const [p, a] of bidLevels) this.upsert('bid', p, a);
    for (const [p, a] of askLevels) this.upsert('ask', p, a);
  }

  /** Sorted, depth-capped bids (highest first). */
  sortedBids(): PriceLevel[] {
    return [...this.bids.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, this.depth)
      .map(([price, amount]) => ({ price, amount }));
  }

  /** Sorted, depth-capped asks (lowest first). */
  sortedAsks(): PriceLevel[] {
    return [...this.asks.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, this.depth)
      .map(([price, amount]) => ({ price, amount }));
  }

  /** Materialize a normalized OrderBook snapshot for the engine. */
  toOrderBook(timestamp: number = Date.now()): OrderBook {
    return {
      exchange: this.exchange,
      symbol: this.symbol,
      bids: this.sortedBids(),
      asks: this.sortedAsks(),
      timestamp,
    };
  }

  /**
   * Kraken-style integrity check. Kraken publishes a CRC32 of the top-10 levels;
   * comparing it to our locally-computed value detects a desynced book so we can
   * resubscribe. `format` turns a number into the exact string Kraken hashes
   * (precision is symbol-specific, so the connector supplies it).
   */
  krakenChecksum(format: (n: number) => string): number {
    const top = (levels: PriceLevel[]): string =>
      levels
        .slice(0, 10)
        .map((l) => stripForChecksum(format(l.price)) + stripForChecksum(format(l.amount)))
        .join('');
    const payload = top(this.sortedAsks()) + top(this.sortedBids());
    return crc32(payload);
  }
}

/** Kraken checksum formatting: drop the decimal point and leading zeros. */
function stripForChecksum(s: string): string {
  const noDot = s.replace('.', '');
  const stripped = noDot.replace(/^0+/, '');
  return stripped.length === 0 ? '0' : stripped;
}

// ---- CRC32 (IEEE 802.3) ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
