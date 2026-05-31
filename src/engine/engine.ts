/**
 * Arbitrage engine orchestrator.
 *
 * One `tick(books)` is the full decision cycle:
 *   1. detect & rank opportunities across all exchange pairs,
 *   2. ask the risk layer whether trading is allowed (circuit breaker/cooldown),
 *   3. execute the best executable opportunity against the wallets,
 *   4. apply the trade, update P&L, and feed the outcome back to risk,
 *   5. record history and return a full state snapshot.
 *
 * Both the CLI and the web server are thin consumers of this — they call tick()
 * with fresh books and render the returned TickResult. No business logic leaks
 * into the presentation layer.
 */
import type {
  OrderBook,
  Opportunity,
  Trade,
  PortfolioSnapshot,
  ExchangeFees,
} from '../domain/types';
import type { TradingConfig, RiskConfig } from '../domain/config';
import { detectOpportunities } from './detector';
import { executeOpportunity } from './executor';
import { WalletManager } from './wallet';
import { RiskManager, type RiskState } from './risk';
import { VolatilityEstimator } from './latency';


export type RiskAppetiteLevel = 'conservative' | 'moderate' | 'aggressive' | 'very_aggressive';

export interface EffectiveRiskSettings {
  appetite: number;
  level: RiskAppetiteLevel;
  label: string;
  trading: TradingConfig;
  risk: RiskConfig;
}

function riskLevel(appetite: number): RiskAppetiteLevel {
  if (appetite < 0.75) return 'conservative';
  if (appetite < 1.75) return 'moderate';
  if (appetite < 2.75) return 'aggressive';
  return 'very_aggressive';
}

function clampPositive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function effectiveRiskSettings(
  trading: TradingConfig,
  risk: RiskConfig,
  appetiteRaw: number,
): EffectiveRiskSettings {
  const appetite = Number.isFinite(appetiteRaw) ? Math.min(4, Math.max(0.25, appetiteRaw)) : 1;
  const level = riskLevel(appetite);
  const t: TradingConfig = { ...trading };
  const r: RiskConfig = { ...risk };

  if (level === 'conservative') {
    t.minNetProfitPct = Math.max(trading.minNetProfitPct * 2.5, 0.00125);
    t.minNetProfitAbs = Math.max(trading.minNetProfitAbs * 2, 2);
    t.maxTradeSizeBTC = Math.min(trading.maxTradeSizeBTC, 0.02);
    t.slippageBufferPct = Math.min(trading.slippageBufferPct, 0.0001);
    t.latencyPenaltyPct = Math.max(trading.latencyPenaltyPct, 0.00015);
    t.executionLatencyMs = Math.min(trading.executionLatencyMs, 100);
    t.latencyRiskZ = Math.max(trading.latencyRiskZ, 2.8);
    r.maxConsecutiveLosses = Math.min(risk.maxConsecutiveLosses, 2);
    r.maxDrawdownAbs = Math.min(risk.maxDrawdownAbs, 200);
    r.circuitBreakerCooldownMs = Math.max(risk.circuitBreakerCooldownMs, 60_000);
    r.maxInventorySkewBTC = Math.min(risk.maxInventorySkewBTC, 0.25);
  } else if (level === 'aggressive') {
    t.minNetProfitPct = clampPositive(trading.minNetProfitPct * 0.6, trading.minNetProfitPct);
    t.minNetProfitAbs = clampPositive(trading.minNetProfitAbs * 0.6, trading.minNetProfitAbs);
    t.maxTradeSizeBTC = trading.maxTradeSizeBTC * 1.5;
    t.slippageBufferPct = Math.max(trading.slippageBufferPct, 0.00035);
    t.latencyPenaltyPct = Math.max(trading.latencyPenaltyPct * 0.75, 0.00005);
    t.executionLatencyMs = Math.max(trading.executionLatencyMs, 250);
    t.latencyRiskZ = Math.min(trading.latencyRiskZ, 1.4);
    r.maxConsecutiveLosses = Math.max(risk.maxConsecutiveLosses, 7);
    r.maxDrawdownAbs = Math.max(risk.maxDrawdownAbs, 1_000);
    r.circuitBreakerCooldownMs = Math.min(risk.circuitBreakerCooldownMs, 20_000);
    r.maxInventorySkewBTC = Math.max(risk.maxInventorySkewBTC, 3);
  } else if (level === 'very_aggressive') {
    t.minNetProfitPct = clampPositive(trading.minNetProfitPct * 0.3, trading.minNetProfitPct);
    t.minNetProfitAbs = clampPositive(trading.minNetProfitAbs * 0.3, trading.minNetProfitAbs);
    t.maxTradeSizeBTC = trading.maxTradeSizeBTC * 2;
    t.slippageBufferPct = Math.max(trading.slippageBufferPct, 0.0006);
    t.latencyPenaltyPct = Math.max(trading.latencyPenaltyPct * 0.5, 0.000025);
    t.executionLatencyMs = Math.max(trading.executionLatencyMs, 400);
    t.latencyRiskZ = Math.min(trading.latencyRiskZ, 1.0);
    r.maxConsecutiveLosses = Math.max(risk.maxConsecutiveLosses, 10);
    r.maxDrawdownAbs = Math.max(risk.maxDrawdownAbs, 2_000);
    r.circuitBreakerCooldownMs = Math.min(risk.circuitBreakerCooldownMs, 15_000);
    r.maxInventorySkewBTC = Math.max(risk.maxInventorySkewBTC, 5);
  }

  return { appetite, level, label: level.replace('_', ' '), trading: t, risk: r };
}

export interface EngineDeps {
  fees: Record<string, ExchangeFees>;
  trading: TradingConfig;
  risk: RiskConfig;
}

export interface TickResult {
  timestamp: number;
  /** All evaluated opportunities this tick, ranked (executable first). */
  opportunities: Opportunity[];
  /** The best executable opportunity, if any. */
  best: Opportunity | null;
  /** Trade executed this tick, if any. */
  executed: Trade | null;
  /** True if an executable opp existed but risk halted trading. */
  haltedByRisk: boolean;
  snapshot: PortfolioSnapshot;
  risk: RiskState;
  /** Age (ms) of the freshest order book at decision time — our data latency. */
  bookAgeMs: number;
  /** Latency-risk telemetry for the UI: live volatility + how many ghosts we filtered. */
  latency: {
    /** Current volatility estimate (fraction of price per second). */
    volatilityPctPerSec: number;
    /** True once the estimate is measured live (vs the conservative fallback). */
    volatilityLive: boolean;
    /** Opportunities this tick rejected specifically as latency ghosts. */
    ghostsRejected: number;
    /** Assumed execution latency (ms) feeding the exposure window. */
    executionLatencyMs: number;
  };
}

export interface EngineStats {
  ticks: number;
  /** Cumulative opportunities/routes evaluated over the session. */
  opportunitiesSeen: number;
  /** Cumulative executable opportunities detected over the session. */
  executableOpportunitiesSeen: number;
  /** Executable opportunities in the latest tick. */
  executableNow: number;
  tradesExecuted: number;
  partialTrades: number;
  realizedPnl: number;
  bestTradePnl: number;
  /** Cumulative cost breakdown across all trades (quote currency). */
  grossProfit: number;
  tradingFees: number;
  slippageCost: number;
  latencyPenalty: number;
  /** How many opportunities we declined as latency "ghosts" over the session. */
  ghostsFiltered: number;
}

export class ArbitrageEngine {
  private risk: RiskManager;
  private trades: Trade[] = [];
  private recentOpportunities: Opportunity[] = [];
  private stats: EngineStats = {
    ticks: 0,
    opportunitiesSeen: 0,
    executableOpportunitiesSeen: 0,
    executableNow: 0,
    tradesExecuted: 0,
    partialTrades: 0,
    realizedPnl: 0,
    bestTradePnl: 0,
    grossProfit: 0,
    tradingFees: 0,
    slippageCost: 0,
    latencyPenalty: 0,
    ghostsFiltered: 0,
  };
  private readonly maxHistory = 500;
  private lastExecAt = 0;
  private latencySum = 0;
  private latencySamples = 0;
  private paused = false;
  private vol: VolatilityEstimator;
  /** Exchanges the user has enabled. null = all connected venues are active. */
  private activeExchanges: Set<string> | null = null;
  /**
   * Risk appetite multiplier on the profit gates. 1 = configured defaults
   * (conservative). >1 loosens the minimum-profit thresholds so the bot takes
   * thinner edges (more trades, more risk); <1 tightens them. Bounded for safety.
   */
  private riskAppetite = 1;
  private effective: EffectiveRiskSettings;

  constructor(
    private wallets: WalletManager,
    private deps: EngineDeps,
  ) {
    // Baseline equity for drawdown tracking; the real mark-to-market peak is
    // refined on every trade via risk.onTrade().
    const initialEquity = wallets.totalQuote();
    this.effective = effectiveRiskSettings(deps.trading, deps.risk, this.riskAppetite);
    this.risk = new RiskManager(this.effective.risk, initialEquity);
    this.vol = new VolatilityEstimator(deps.trading.volatilityPctPerSec);
  }

  /** Restrict trading to a subset of venues (UI toggle). null = all active; [] = none. */
  setActiveExchanges(ids: string[] | null): void {
    this.activeExchanges = ids === null ? null : new Set(ids);
  }
  getActiveExchanges(): string[] | null {
    return this.activeExchanges ? [...this.activeExchanges] : null;
  }
  /** Set risk appetite (0.25..4). Higher = thinner edges accepted = more aggressive. */
  setRiskAppetite(a: number): void {
    if (!Number.isFinite(a)) return;
    const next = Math.min(4, Math.max(0.25, a));
    const prevLevel = this.effective.level;
    this.riskAppetite = next;
    this.effective = effectiveRiskSettings(this.deps.trading, this.deps.risk, this.riskAppetite);
    this.risk.setConfig(this.effective.risk);
    if (this.effective.level !== prevLevel) {
      console.log(`[risk] appetite changed to ${this.effective.level}`);
    }
    console.log(`[risk] thresholds updated: minNet=${this.effective.trading.minNetProfitPct}, slippage=${this.effective.trading.slippageBufferPct}, latencyWindow=${this.effective.trading.executionLatencyMs}`);
  }
  getRiskAppetite(): number {
    return this.riskAppetite;
  }
  getEffectiveRiskSettings(): EffectiveRiskSettings {
    return { ...this.effective, trading: { ...this.effective.trading }, risk: { ...this.effective.risk } };
  }

  tick(allBooks: OrderBook[]): TickResult {
    const now = Date.now();
    this.stats.ticks += 1;

    // Active-exchange filter: the user can focus the engine on a subset of venues
    // without disconnecting their feeds. Detection/execution only see these books.
    const books = this.activeExchanges
      ? allBooks.filter((b) => this.activeExchanges!.has(b.exchange))
      : allBooks;

    const freshest = books.reduce((m, b) => Math.max(m, b.timestamp), 0);
    const bookAgeMs = freshest > 0 ? now - freshest : 0;
    this.latencySum += bookAgeMs;
    this.latencySamples += 1;

    const markPrice = computeMark(books);

    // Risk appetite selects the effective thresholds, size limits, slippage and
    // latency assumptions for this tick. The persisted base defaults are untouched.
    const tradingForTick = this.effective.trading;

    // Feed the live volatility estimator with each venue's current mid, so the
    // latency-risk model uses *current* market conditions, not a constant.
    for (const b of books) {
      const bid = b.bids[0]?.price;
      const ask = b.asks[0]?.price;
      if (bid !== undefined && ask !== undefined) this.vol.observe(b.exchange, (bid + ask) / 2, now);
    }

    const opportunities = detectOpportunities(books, {
      fees: this.deps.fees,
      config: tradingForTick,
      volatilityPctPerSec: this.vol.pctPerSec(),
    });
    const executable = opportunities.filter((o) => o.executable);
    this.stats.opportunitiesSeen += opportunities.length;
    this.stats.executableOpportunitiesSeen += executable.length;
    this.stats.executableNow = executable.length;

    // Count latency ghosts: edges that cleared the profit floor but were rejected
    // because they wouldn't survive the exposure window. This is the headline
    // "we didn't get picked off" metric.
    const ghostsRejected = opportunities.filter((o) => o.rejectReason === 'latency_risk').length;
    this.stats.ghostsFiltered += ghostsRejected;

    // Keep a rolling window of opportunities for the UI.
    this.recentOpportunities.push(...opportunities.slice(0, 5));
    if (this.recentOpportunities.length > this.maxHistory) {
      this.recentOpportunities.splice(0, this.recentOpportunities.length - this.maxHistory);
    }

    const best = executable[0] ?? null;
    let executed: Trade | null = null;
    let haltedByRisk = false;

    if (best && !this.paused) {
      if (!this.risk.canTrade(now)) {
        haltedByRisk = true;
      } else if (now - this.lastExecAt < this.deps.trading.executionCooldownMs) {
        // Within the execution cooldown: assume the previous fill consumed this
        // edge; wait for the book to move before firing again.
      } else {
        const buyBook = books.find((b) => b.exchange === best.buyExchange);
        const sellBook = books.find((b) => b.exchange === best.sellExchange);
        const buyWallet = this.wallets.getWallet(best.buyExchange);
        const sellWallet = this.wallets.getWallet(best.sellExchange);

        if (buyBook && sellBook && buyWallet && sellWallet) {
          const trade = executeOpportunity(best, buyBook, sellBook, {
            fees: this.deps.fees,
            config: tradingForTick,
            buyWallet,
            sellWallet,
          });
          if (trade) {
            this.wallets.applyTrade(trade);
            executed = trade;
            this.lastExecAt = now;
            this.trades.push(trade);
            if (this.trades.length > this.maxHistory) this.trades.shift();
            this.stats.tradesExecuted += 1;
            if (trade.partial) this.stats.partialTrades += 1;
            this.stats.realizedPnl = this.wallets.getRealizedPnl();
            this.stats.grossProfit += trade.grossProfit;
            this.stats.tradingFees += trade.tradingFees;
            this.stats.slippageCost += trade.slippageCost;
            this.stats.latencyPenalty += trade.latencyPenalty;
            if (trade.netProfit > this.stats.bestTradePnl) this.stats.bestTradePnl = trade.netProfit;

            const equity = this.wallets.snapshot(markPrice).totalValueQuote;
            this.risk.onTrade(trade, equity, now);
          }
        }
      }
    }

    return {
      timestamp: now,
      opportunities,
      best,
      executed,
      haltedByRisk,
      snapshot: this.wallets.snapshot(markPrice),
      risk: this.risk.getState(),
      bookAgeMs,
      latency: {
        volatilityPctPerSec: this.vol.pctPerSec(),
        volatilityLive: this.vol.isLive(),
        ghostsRejected,
        executionLatencyMs: tradingForTick.executionLatencyMs,
      },
    };
  }

  /** Average data latency (book age at decision) across all ticks, in ms. */
  avgLatencyMs(): number {
    return this.latencySamples > 0 ? this.latencySum / this.latencySamples : 0;
  }

  /** Pause/resume trade execution (detection and streaming continue). */
  setPaused(p: boolean): void {
    this.paused = p;
  }
  isPaused(): boolean {
    return this.paused;
  }

  getTrades(): Trade[] {
    return [...this.trades];
  }
  getRecentOpportunities(): Opportunity[] {
    return [...this.recentOpportunities];
  }
  getStats(): EngineStats {
    return { ...this.stats };
  }
  getWallets(): WalletManager {
    return this.wallets;
  }
}

/** Mid price across exchanges (average of best bid/ask midpoints). Used for marking. */
function computeMark(books: OrderBook[]): number {
  const mids: number[] = [];
  for (const b of books) {
    const bid = b.bids[0]?.price;
    const ask = b.asks[0]?.price;
    if (bid !== undefined && ask !== undefined) mids.push((bid + ask) / 2);
  }
  if (mids.length === 0) return 0;
  return mids.reduce((a, c) => a + c, 0) / mids.length;
}
