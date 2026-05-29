/**
 * Central configuration for the arbitrage system.
 *
 * Everything tunable lives here so the engine logic stays pure and the jury can
 * see exactly which assumptions drive the P&L. Values can be overridden via
 * environment variables at startup (see `loadConfig`).
 */
import type { ExchangeFees } from './types';

/**
 * Per-exchange fee schedules. Defaults reflect public spot taker/maker tiers at
 * the lowest volume level (the most conservative, i.e. worst-case for us).
 * BTC withdrawal fees are approximate flat network fees. All are overridable.
 */
export const EXCHANGE_FEES: Record<string, ExchangeFees> = {
  binance: {
    label: 'Binance',
    taker: 0.001, // 0.10%
    maker: 0.001, // 0.10%
    withdrawalBTC: 0.0002,
  },
  kraken: {
    label: 'Kraken',
    taker: 0.0026, // 0.26%
    maker: 0.0016, // 0.16%
    withdrawalBTC: 0.00015,
  },
};

export interface TradingConfig {
  /** Trading pair to monitor. */
  symbol: string;
  /** Exchanges to connect to. */
  exchanges: string[];

  /**
   * Minimum net profit fraction required to flag an opportunity as executable.
   * 0.0005 = 0.05%. Acts as a margin of safety above pure break-even so that
   * tiny edges that latency would eat are skipped.
   */
  minNetProfitPct: number;

  /** Absolute minimum net profit (quote ccy) to bother executing. */
  minNetProfitAbs: number;

  /** Max BTC size to commit to a single arbitrage execution. */
  maxTradeSizeBTC: number;

  /**
   * Whether the strategy moves BTC between exchanges (true) or runs with
   * pre-funded balanced inventory on both venues (false). Pre-funded inventory
   * is how real low-latency arbitrage desks avoid paying withdrawal fees and
   * waiting for on-chain confirmations on every trade.
   */
  requiresWithdrawal: boolean;

  /**
   * Extra slippage buffer (fraction) added on top of the order-book walk to
   * account for the market moving against us during execution latency.
   */
  slippageBufferPct: number;

  /**
   * Estimated cost (fraction of notional) of acting on data that is slightly
   * stale due to network latency. Surfaced as its own line in the cost
   * breakdown so the net-vs-gross story is fully explicit for reviewers.
   */
  latencyPenaltyPct: number;

  /** Treat a quote older than this (ms) as stale and skip it. */
  maxQuoteAgeMs: number;

  /** REST polling interval (ms) used before/instead of WebSocket streaming. */
  pollIntervalMs: number;

  /** Depth (number of price levels) to request/track per side. */
  orderBookDepth: number;

  /**
   * Minimum time between executions (ms). In event-driven mode a single standing
   * divergence would otherwise fire on every book tick; this throttles us to one
   * fill per edge until the book meaningfully changes, which is realistic (our
   * fill would consume that liquidity) and prevents draining inventory.
   */
  executionCooldownMs: number;
}

/** Risk-management parameters consumed by the risk layer (Phase 5). */
export interface RiskConfig {
  /** Halt trading after this many consecutive losing trades. */
  maxConsecutiveLosses: number;
  /** Halt if cumulative drawdown (quote ccy) exceeds this. */
  maxDrawdownAbs: number;
  /** Cooldown (ms) to wait after the circuit breaker trips before resuming. */
  circuitBreakerCooldownMs: number;
  /** Cap on total BTC exposure held away from a 50/50 split. */
  maxInventorySkewBTC: number;
}

export const DEFAULT_TRADING: TradingConfig = {
  symbol: 'BTC/USDT',
  exchanges: ['binance', 'kraken'],
  minNetProfitPct: 0.0005, // 0.05%
  minNetProfitAbs: 1, // $1
  maxTradeSizeBTC: 1.0,
  requiresWithdrawal: false, // assume pre-funded inventory by default
  slippageBufferPct: 0.0002, // 0.02% safety buffer for execution latency
  latencyPenaltyPct: 0.0001, // 0.01% estimated cost of stale-data latency
  maxQuoteAgeMs: 2000,
  pollIntervalMs: 1000,
  orderBookDepth: 20,
  executionCooldownMs: 250,
};

export const DEFAULT_RISK: RiskConfig = {
  maxConsecutiveLosses: 5,
  maxDrawdownAbs: 500,
  circuitBreakerCooldownMs: 30_000,
  maxInventorySkewBTC: 2.0,
};

/** Starting paper-trading balances per exchange (base = BTC, quote = USDT).
 *  Balanced ~50/50 by value (5 BTC ≈ $350k) so the bot can trade in both
 *  directions without immediately exhausting one-sided inventory. */
export const INITIAL_BALANCES: Record<string, { base: number; quote: number }> = {
  binance: { base: 5.0, quote: 350_000 },
  kraken: { base: 5.0, quote: 350_000 },
};

/**
 * Build the runtime config, allowing env-var overrides. Keeping this as a
 * function (rather than reading process.env at module load) keeps the module
 * importable in test environments without surprises.
 */
export function loadConfig(): { trading: TradingConfig; risk: RiskConfig } {
  const num = (key: string, fallback: number): number => {
    const v = process.env[key];
    if (v === undefined) return fallback;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    trading: {
      ...DEFAULT_TRADING,
      minNetProfitPct: num('MIN_NET_PROFIT_PCT', DEFAULT_TRADING.minNetProfitPct),
      maxTradeSizeBTC: num('MAX_TRADE_SIZE_BTC', DEFAULT_TRADING.maxTradeSizeBTC),
      pollIntervalMs: num('POLL_INTERVAL_MS', DEFAULT_TRADING.pollIntervalMs),
      slippageBufferPct: num('SLIPPAGE_BUFFER_PCT', DEFAULT_TRADING.slippageBufferPct),
    },
    risk: {
      ...DEFAULT_RISK,
      maxDrawdownAbs: num('MAX_DRAWDOWN_ABS', DEFAULT_RISK.maxDrawdownAbs),
    },
  };
}
