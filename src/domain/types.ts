/**
 * Core domain types for the BTC arbitrage engine.
 *
 * These are pure data structures with ZERO external dependencies, so they can
 * be shared by every consumer of the engine: the CLI, the web server, the
 * detection/execution logic, and the exchange connectors.
 *
 * Conventions used throughout the codebase:
 *  - "base" currency  = BTC      (the thing we trade)
 *  - "quote" currency = USDT      (the thing we price it in)
 *  - All amounts are plain `number`. For a 48h hackathon this is fine; for
 *    production money math you'd switch to integer minor-units or a decimal lib.
 *  - Fees are expressed as fractions: 0.001 === 0.1%.
 *  - Timestamps are epoch milliseconds (Date.now()).
 */

/** A single level in an order book: a price and the size available at it. */
export interface PriceLevel {
  /** Price in quote currency (e.g. USDT per BTC). */
  price: number;
  /** Size available at this price, in base currency (BTC). */
  amount: number;
}

/**
 * A full order-book snapshot for one symbol on one exchange.
 *
 * Invariants the engine relies on:
 *  - `bids` are sorted DESCENDING by price (best/highest bid first).
 *  - `asks` are sorted ASCENDING by price (best/lowest ask first).
 * Connectors are responsible for guaranteeing this ordering.
 */
export interface OrderBook {
  exchange: string;
  /** e.g. "BTC/USDT" */
  symbol: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  /** When this snapshot was received locally (ms epoch). */
  timestamp: number;
}

/** Top-of-book summary — the cheapest derived view used for fast scanning. */
export interface Quote {
  exchange: string;
  symbol: string;
  /** Best bid price (highest someone will pay). */
  bid: number;
  /** Size available at the best bid. */
  bidAmount: number;
  /** Best ask price (lowest someone will sell for). */
  ask: number;
  /** Size available at the best ask. */
  askAmount: number;
  timestamp: number;
}

/** Per-exchange cost configuration, used to turn gross spreads into net P&L. */
export interface ExchangeFees {
  /** Taker fee fraction applied to market orders (0.001 = 0.1%). */
  taker: number;
  /** Maker fee fraction (limit orders that add liquidity). */
  maker: number;
  /**
   * Flat fee, in BTC, to withdraw BTC off this exchange.
   * Relevant when an arbitrage strategy requires moving the asset between
   * venues. For pure pre-funded (balanced-inventory) arbitrage this may be
   * amortized to ~0, which the profitability model accounts for explicitly.
   */
  withdrawalBTC: number;
  /** Human-readable label. */
  label: string;
}

/**
 * Result of "walking" an order book to fill a target size.
 * Captures the realistic VWAP and whether liquidity was sufficient — this is
 * what makes our profitability estimate honest instead of using top-of-book.
 */
export interface FillResult {
  /** Base currency (BTC) actually filled — may be < requested if illiquid. */
  filledAmount: number;
  /** Volume-weighted average price actually achieved. */
  avgPrice: number;
  /** Total quote currency moved (spent on a buy / received on a sell), pre-fee. */
  notional: number;
  /** True if the full requested amount was filled. */
  fullyFilled: boolean;
  /** How many price levels were consumed (a proxy for market impact). */
  levelsConsumed: number;
}

/** Why an otherwise-detected opportunity was rejected. */
export type RejectReason =
  | 'negative_net' // profitable gross, but fees/slippage make it a loss
  | 'below_threshold' // positive but under our minimum-profit gate
  | 'no_liquidity' // order books too thin to fill any meaningful size
  | 'insufficient_balance' // wallets can't fund the trade
  | 'stale_data' // a quote was too old to trust
  | 'circuit_breaker'; // risk layer halted trading

/**
 * A detected arbitrage opportunity: buy on `buyExchange`, sell on `sellExchange`.
 * Fields are filled progressively: detector sets the gross fields, the
 * profitability model fills the net/sizing fields and the executable verdict.
 */
export interface Opportunity {
  id: string;
  timestamp: number;
  symbol: string;

  buyExchange: string;
  sellExchange: string;

  // --- Gross (top-of-book) ---
  /** Best ask on the buy side (what we pay per BTC, pre-fee). */
  buyPrice: number;
  /** Best bid on the sell side (what we receive per BTC, pre-fee). */
  sellPrice: number;
  /** sellPrice - buyPrice, per BTC. */
  grossSpread: number;
  /** grossSpread / buyPrice. */
  grossSpreadPct: number;

  // --- Net (after walking books, fees, slippage) ---
  /** BTC size the engine decided to trade (capped by liquidity + balance). */
  amount: number;
  /** Effective VWAP buy price after walking the ask book. */
  effectiveBuyPrice: number;
  /** Effective VWAP sell price after walking the bid book. */
  effectiveSellPrice: number;
  /** Total net profit in quote currency (USDT) for `amount`. */
  netProfit: number;
  /** netProfit / (effectiveBuyPrice * amount). */
  netProfitPct: number;

  /** Final verdict from the profitability + risk pipeline. */
  executable: boolean;
  rejectReason?: RejectReason;
}

/** One side (leg) of an executed simulated trade. */
export interface TradeLeg {
  exchange: string;
  side: 'buy' | 'sell';
  /** BTC filled on this leg. */
  amount: number;
  /** VWAP achieved on this leg. */
  price: number;
  /** Quote currency moved before fees. */
  notional: number;
  /** Fee paid, in quote currency. */
  fee: number;
  fullyFilled: boolean;
}

/** A completed (simulated) arbitrage execution: a buy leg + a sell leg. */
export interface Trade {
  id: string;
  opportunityId: string;
  timestamp: number;
  symbol: string;
  buy: TradeLeg;
  sell: TradeLeg;
  /** Net realized P&L in quote currency for this trade. */
  netProfit: number;
  /** True if either leg was only partially filled. */
  partial: boolean;
}

/** A per-exchange wallet holding base + quote balances. */
export interface Wallet {
  exchange: string;
  /** BTC balance. */
  base: number;
  /** USDT balance. */
  quote: number;
}

/** Snapshot of the whole portfolio's value, used for P&L tracking. */
export interface PortfolioSnapshot {
  timestamp: number;
  /** Total BTC across all wallets. */
  totalBase: number;
  /** Total USDT across all wallets. */
  totalQuote: number;
  /** Mark-to-market total value in quote currency at a given BTC price. */
  markPrice: number;
  totalValueQuote: number;
}
