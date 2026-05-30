/**
 * Live volatility estimator for the latency-risk model.
 *
 * The whole point of "ghost opportunity" rejection is to ask: during the time it
 * takes us to act on a quote (the slower leg's staleness + our execution
 * latency), how far can the price move against us? That depends on how volatile
 * the market is *right now*, not on a fixed constant. So we measure it live.
 *
 * We track each venue's mid and maintain an exponentially-weighted moving
 * average (EWMA) of the absolute per-second return. EWMA reacts quickly to
 * regime changes (a calm book vs a fast one) while staying smooth enough not to
 * over-react to a single tick. Until enough samples exist, we fall back to a
 * conservative configured estimate.
 *
 * Pure and deterministic given its inputs — easy to unit-test.
 */
export class VolatilityEstimator {
  /** EWMA of |return| per second, as a fraction of price. */
  private ewmaPerSec = 0;
  private samples = 0;
  private lastMid = new Map<string, { mid: number; t: number }>();

  constructor(
    /** Fallback used until `minSamples` observations exist. */
    private fallbackPctPerSec: number,
    /** Smoothing factor (0..1); higher = more reactive. ~0.05 ≈ last ~20 samples. */
    private alpha = 0.05,
    /** Observations required before trusting the live estimate. */
    private minSamples = 8,
  ) {}

  /**
   * Feed a fresh mid for an exchange. Updates the volatility estimate from the
   * per-second return since that venue's previous mid.
   */
  observe(exchange: string, mid: number, now: number): void {
    if (!(mid > 0)) return;
    const prev = this.lastMid.get(exchange);
    this.lastMid.set(exchange, { mid, t: now });
    if (!prev || prev.mid <= 0) return;

    const dtSec = (now - prev.t) / 1000;
    if (dtSec <= 0 || dtSec > 10) return; // ignore zero/huge gaps (reconnects)

    const ret = Math.abs(mid - prev.mid) / prev.mid; // |return| over dt
    const perSec = ret / dtSec;
    if (!Number.isFinite(perSec)) return;

    this.ewmaPerSec =
      this.samples === 0 ? perSec : this.alpha * perSec + (1 - this.alpha) * this.ewmaPerSec;
    this.samples += 1;
  }

  /** Current volatility estimate (fraction of price per second). */
  pctPerSec(): number {
    return this.samples >= this.minSamples ? this.ewmaPerSec : this.fallbackPctPerSec;
  }

  /** True once the live estimate (rather than the fallback) is in use. */
  isLive(): boolean {
    return this.samples >= this.minSamples;
  }

  /**
   * Expected adverse price move, as a fraction of price, over `exposureMs`.
   * Diffusion scales with √time (a random walk), so we use √(seconds) rather
   * than linear time — standard for short-horizon price-move estimates.
   */
  expectedMovePct(exposureMs: number, z: number): number {
    const seconds = Math.max(0, exposureMs) / 1000;
    return z * this.pctPerSec() * Math.sqrt(seconds);
  }
}
