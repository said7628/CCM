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

  constructor(
    private wallets: WalletManager,
    private deps: EngineDeps,
  ) {
    // Baseline equity for drawdown tracking; the real mark-to-market peak is
    // refined on every trade via risk.onTrade().
    const initialEquity = wallets.totalQuote();
    this.risk = new RiskManager(deps.risk, initialEquity);
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
    if (Number.isFinite(a)) this.riskAppetite = Math.min(4, Math.max(0.25, a));
  }
  getRiskAppetite(): number {
    return this.riskAppetite;
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

    // Risk appetite scales the profit gates: higher appetite -> lower thresholds
    // -> thinner edges accepted. We pass an adjusted config to detection only;
    // the persisted defaults are untouched.
    const tradingForTick =
      this.riskAppetite === 1
        ? this.deps.trading
        : {
            ...this.deps.trading,
            minNetProfitPct: this.deps.trading.minNetProfitPct / this.riskAppetite,
            minNetProfitAbs: this.deps.trading.minNetProfitAbs / this.riskAppetite,
          };

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
        executionLatencyMs: this.deps.trading.executionLatencyMs,
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
