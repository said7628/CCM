/**
 * Risk management layer.
 *
 * A good arbitrage bot doesn't just chase every edge — it protects capital when
 * conditions turn adverse. This circuit breaker halts trading when:
 *   - too many consecutive losing trades occur (e.g. we're consistently getting
 *     adversely selected / latency-picked-off), or
 *   - cumulative drawdown from the equity peak exceeds a hard limit.
 * After tripping it enforces a cooldown before trading may resume.
 */
import type { Trade } from '../domain/types';
import type { RiskConfig } from '../domain/config';

export type TripReason = 'consecutive_losses' | 'max_drawdown';

export interface RiskState {
  consecutiveLosses: number;
  peakEquity: number;
  drawdown: number;
  breakerActive: boolean;
  /** Epoch ms until which trading is paused. */
  breakerUntil: number;
  tripReason?: TripReason;
}

export class RiskManager {
  private state: RiskState;

  constructor(private cfg: RiskConfig, initialEquity: number) {
    this.state = {
      consecutiveLosses: 0,
      peakEquity: initialEquity,
      drawdown: 0,
      breakerActive: false,
      breakerUntil: 0,
    };
  }

  getState(): RiskState {
    return { ...this.state };
  }

  /**
   * Whether trading is currently allowed. If the breaker was active but the
   * cooldown has elapsed, it auto-resets here and trading resumes.
   */
  canTrade(now: number = Date.now()): boolean {
    if (this.state.breakerActive) {
      if (now < this.state.breakerUntil) return false;
      // Cooldown elapsed -> reset and resume.
      this.state.breakerActive = false;
      this.state.consecutiveLosses = 0;
      this.state.tripReason = undefined;
    }
    return true;
  }

  /** Record a trade outcome and current equity; may trip the breaker. */
  onTrade(trade: Trade, equity: number, now: number = Date.now()): void {
    if (trade.netProfit < 0) this.state.consecutiveLosses += 1;
    else this.state.consecutiveLosses = 0;

    if (equity > this.state.peakEquity) this.state.peakEquity = equity;
    this.state.drawdown = this.state.peakEquity - equity;

    if (this.state.consecutiveLosses >= this.cfg.maxConsecutiveLosses) {
      this.trip('consecutive_losses', now);
    } else if (this.state.drawdown >= this.cfg.maxDrawdownAbs) {
      this.trip('max_drawdown', now);
    }
  }

  private trip(reason: TripReason, now: number): void {
    this.state.breakerActive = true;
    this.state.breakerUntil = now + this.cfg.circuitBreakerCooldownMs;
    this.state.tripReason = reason;
  }
}
