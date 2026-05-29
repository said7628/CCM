/**
 * Binance diff-depth stream synchronizer.
 *
 * Binance's correct procedure for a live local book (from their docs):
 *   1. Open the diff stream `<sym>@depth@100ms` and BUFFER events.
 *   2. Fetch a REST depth snapshot (has `lastUpdateId`).
 *   3. Discard buffered events with `u <= lastUpdateId`.
 *   4. The first event applied must satisfy `U <= lastUpdateId+1 <= u`.
 *   5. Apply events in order; each event's `U` must equal previous `u + 1`,
 *      otherwise the book has desynced and we must resync from step 1.
 *
 * Getting this wrong silently corrupts the book, so the sequencing lives here as
 * a pure unit and is tested with mock events. The socket wiring just feeds it.
 */
import { LocalOrderBook } from './localbook';

export interface DiffEvent {
  /** First update id in event. */
  U: number;
  /** Final update id in event. */
  u: number;
  /** Bid deltas [price, size] (size 0 removes). */
  b: [number, number][];
  /** Ask deltas. */
  a: [number, number][];
}

export type ApplyResult = 'applied' | 'buffered' | 'ignored' | 'resync_needed';

export class BinanceBookSyncer {
  private buffer: DiffEvent[] = [];

  constructor(private bookRef: LocalOrderBook) {}

  /** Buffer an event received before the snapshot is in place. */
  buffer_(evt: DiffEvent): void {
    this.buffer.push(evt);
  }

  /**
   * Apply the REST snapshot, then flush buffered events that are still relevant.
   * Returns 'resync_needed' if the buffer can't be reconciled with the snapshot.
   */
  applySnapshot(
    bids: [number, number][],
    asks: [number, number][],
    lastUpdateId: number,
  ): ApplyResult {
    this.bookRef.setSnapshot(bids, asks, lastUpdateId);
    // Drop stale buffered events, then apply the rest with validation.
    const relevant = this.buffer.filter((e) => e.u > lastUpdateId);
    this.buffer = [];
    if (relevant.length === 0) return 'applied';

    const first = relevant[0];
    if (!(first.U <= lastUpdateId + 1 && lastUpdateId + 1 <= first.u)) {
      return 'resync_needed';
    }
    for (const evt of relevant) {
      const r = this.applyEvent(evt);
      if (r === 'resync_needed') return 'resync_needed';
    }
    return 'applied';
  }

  /**
   * Apply a live event once the book is ready, validating sequence continuity.
   */
  applyEvent(evt: DiffEvent): ApplyResult {
    if (!this.bookRef.ready) {
      this.buffer_(evt);
      return 'buffered';
    }
    // Already-seen event.
    if (evt.u <= this.bookRef.lastUpdateId) return 'ignored';
    // Gap detection: the next event must continue exactly from lastUpdateId+1.
    if (evt.U > this.bookRef.lastUpdateId + 1) return 'resync_needed';

    this.bookRef.applyLevels(evt.b, evt.a);
    this.bookRef.lastUpdateId = evt.u;
    return 'applied';
  }

  clearBuffer(): void {
    this.buffer = [];
  }
}
