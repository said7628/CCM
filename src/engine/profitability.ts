/**
 * Net profitability model.
 *
 * The core insight: a raw "ask < bid" spread is gross and per-unit. The real
 * edge erodes as you trade bigger, because buying walks UP the ask book and
 * selling walks DOWN the bid book, while fees, an optional withdrawal cost, and
 * a latency/slippage buffer all eat into it.
 *
 * So we don't pick a fixed size and hope. We compute the PROFIT-MAXIMIZING size
 * by matching the two books slice-by-slice and accumulating volume only while
 * the marginal slice is still net-positive. The result is the optimal `amount`,
 * the effective VWAPs, and an honest net-P&L verdict.
 */
import type {
  OrderBook,
  ExchangeFees,
  Opportunity,
  RejectReason,
} from '../domain/types';
import type { TradingConfig } from '../domain/config';

const EPS = 1e-9;

export interface ProfitParams {
  buyFees: ExchangeFees;
  sellFees: ExchangeFees;
  config: TradingConfig;
  /** Optional hard cap on size (e.g. from wallet balances). Defaults to config.maxTradeSizeBTC. */
  maxAmount?: number;
  /**
   * Expected adverse price move as a FRACTION of price over the exposure window
   * (slowest leg staleness + execution latency), from the live volatility
   * estimator. When provided, the latency-risk model subtracts the corresponding
   * cost and rejects "ghost" edges that can't survive it. Defaults to 0 (the
   * model is a no-op), so existing callers/tests are unaffected.
   */
  expectedAdverseMovePct?: number;
}

interface SizingResult {
  amount: number;
  buyNotional: number; // quote spent on base, pre-fee
  sellNotional: number; // quote received for base, pre-fee
  effectiveBuyPrice: number;
  effectiveSellPrice: number;
}

/**
 * Match the buy-side asks against the sell-side bids, consuming liquidity only
 * while each marginal slice clears fees. Greedy matching of best-ask vs best-bid
 * is optimal here because both books are monotonic (asks ascend, bids descend),
 * so the marginal net is non-increasing — once it goes negative it stays negative.
 */
function optimalSize(
  buyBook: OrderBook,
  sellBook: OrderBook,
  buyFee: number,
  sellFee: number,
  cap: number,
): SizingResult {
  // Mutable copies of remaining size at each level.
  const asks = buyBook.asks.map((l) => ({ price: l.price, amount: l.amount }));
  const bids = sellBook.bids.map((l) => ({ price: l.price, amount: l.amount }));

  let i = 0;
  let j = 0;
  let remainingCap = cap;
  let amount = 0;
  let buyNotional = 0;
  let sellNotional = 0;

  while (i < asks.length && j < bids.length && remainingCap > EPS) {
    const ask = asks[i];
    const bid = bids[j];

    // Marginal net per BTC for this ask/bid pairing, after taker fees.
    const marginalBuyCost = ask.price * (1 + buyFee);
    const marginalSellRevenue = bid.price * (1 - sellFee);
    if (marginalSellRevenue - marginalBuyCost <= 0) break; // no more profitable depth

    const slice = Math.min(ask.amount, bid.amount, remainingCap);
    if (slice <= EPS) {
      // Advance past a dust level to avoid stalling.
      if (ask.amount <= EPS) i++;
      else if (bid.amount <= EPS) j++;
      else break;
      continue;
    }

    amount += slice;
    buyNotional += slice * ask.price;
    sellNotional += slice * bid.price;
    remainingCap -= slice;
    ask.amount -= slice;
    bid.amount -= slice;
    if (ask.amount <= EPS) i++;
    if (bid.amount <= EPS) j++;
  }

  return {
    amount,
    buyNotional,
    sellNotional,
    effectiveBuyPrice: amount > EPS ? buyNotional / amount : 0,
    effectiveSellPrice: amount > EPS ? sellNotional / amount : 0,
  };
}

let opportunityCounter = 0;
function nextId(prefix: string): string {
  opportunityCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${opportunityCounter}`;
}

/**
 * Evaluate a directed pair (buy on `buyBook`'s exchange, sell on `sellBook`'s)
 * and return a fully-populated Opportunity with the net verdict.
 */
export function evaluateOpportunity(
  buyBook: OrderBook,
  sellBook: OrderBook,
  params: ProfitParams,
): Opportunity {
  const { buyFees, sellFees, config } = params;
  const now = Date.now();
  const cap = Math.min(params.maxAmount ?? config.maxTradeSizeBTC, config.maxTradeSizeBTC);

  const bestAsk = buyBook.asks[0]?.price ?? Infinity;
  const bestBid = sellBook.bids[0]?.price ?? 0;
  const grossSpread = bestBid - bestAsk;
  const grossSpreadPct = bestAsk > 0 ? grossSpread / bestAsk : 0;

  const base: Opportunity = {
    id: nextId('opp'),
    timestamp: now,
    symbol: buyBook.symbol,
    buyExchange: buyBook.exchange,
    sellExchange: sellBook.exchange,
    buyPrice: bestAsk,
    sellPrice: bestBid,
    grossSpread,
    grossSpreadPct,
    amount: 0,
    effectiveBuyPrice: 0,
    effectiveSellPrice: 0,
    netProfit: 0,
    netProfitPct: 0,
    executable: false,
  };

  // Staleness guard.
  const age = now - Math.min(buyBook.timestamp, sellBook.timestamp);
  if (age > config.maxQuoteAgeMs) {
    return reject(base, 'stale_data');
  }

  // No gross edge at the top of book -> nothing to size.
  if (grossSpread <= 0) {
    return reject(base, 'below_threshold');
  }

  const sizing = optimalSize(buyBook, sellBook, buyFees.taker, sellFees.taker, cap);
  if (sizing.amount <= EPS) {
    // Sized to zero. Distinguish *why*: if the top of book actually had depth,
    // then fees/spread made even the first slice unprofitable (negative_net);
    // only call it no_liquidity when the books were genuinely empty/dust.
    const hasDepth =
      (buyBook.asks[0]?.amount ?? 0) > EPS && (sellBook.bids[0]?.amount ?? 0) > EPS;
    if (hasDepth) {
      // Compute the (negative) net at top-of-book so the UI can show exactly how
      // far underwater the edge is after costs — "looked good gross, lost on net".
      const refSize = Math.min(buyBook.asks[0].amount, sellBook.bids[0].amount, cap);
      const refBuyNotional = bestAsk * refSize;
      const refSellNotional = bestBid * refSize;
      const refNet =
        refSellNotional * (1 - sellFees.taker) -
        refBuyNotional * (1 + buyFees.taker) -
        config.slippageBufferPct * refBuyNotional -
        config.latencyPenaltyPct * refBuyNotional;
      base.effectiveBuyPrice = bestAsk;
      base.effectiveSellPrice = bestBid;
      base.netProfit = refNet;
      base.netProfitPct = refBuyNotional > 0 ? refNet / (refBuyNotional * (1 + buyFees.taker)) : 0;
      return reject(base, 'negative_net');
    }
    return reject(base, 'no_liquidity');
  }

  // Fees on actual filled notional.
  const buyFeeQuote = sizing.buyNotional * buyFees.taker;
  const sellFeeQuote = sizing.sellNotional * sellFees.taker;
  const buyOutlay = sizing.buyNotional + buyFeeQuote;
  const sellProceeds = sizing.sellNotional - sellFeeQuote;

  // Optional withdrawal cost (only if the strategy moves BTC between venues).
  const withdrawalCostQuote = config.requiresWithdrawal
    ? buyFees.withdrawalBTC * sizing.effectiveSellPrice
    : 0;

  // Latency/slippage buffer: expected adverse move during execution, scaled to
  // the capital deployed. Conservative — protects against over-trading thin edges.
  const slippageCostQuote = config.slippageBufferPct * sizing.buyNotional;
  const latencyCostQuote = config.latencyPenaltyPct * sizing.buyNotional;

  const netProfit =
    sellProceeds - buyOutlay - withdrawalCostQuote - slippageCostQuote - latencyCostQuote;
  const netProfitPct = buyOutlay > 0 ? netProfit / buyOutlay : 0;

  // --- Latency-risk model (ghost-opportunity detection) ---
  // The edge we just measured is computed from books that already have some age.
  // By the time both legs actually fill, the slower leg's staleness PLUS our
  // execution latency is the window during which the market can move against us.
  // We convert the estimated adverse move into a quote-currency cost on the
  // traded notional, and require the edge to survive it. This is the difference
  // between "the spread looked real" and "the spread was already gone".
  const slowestLegAgeMs = now - Math.min(buyBook.timestamp, sellBook.timestamp);
  const exposureMs = slowestLegAgeMs + config.executionLatencyMs;
  const latencyRiskCost = (params.expectedAdverseMovePct ?? 0) * sizing.buyNotional;
  const latencyAdjustedNet = netProfit - latencyRiskCost;
  const latencyAdjustedPct = buyOutlay > 0 ? latencyAdjustedNet / buyOutlay : 0;

  const result: Opportunity = {
    ...base,
    amount: sizing.amount,
    effectiveBuyPrice: sizing.effectiveBuyPrice,
    effectiveSellPrice: sizing.effectiveSellPrice,
    netProfit,
    netProfitPct,
    slowestLegAgeMs,
    exposureMs,
    latencyRiskCost,
    latencyAdjustedNet,
    executable: false,
  };

  // Gate 1: the raw net (before latency risk) must clear our profit floor.
  if (netProfit < config.minNetProfitAbs || netProfitPct < config.minNetProfitPct) {
    return reject(result, netProfit <= 0 ? 'negative_net' : 'below_threshold');
  }

  // Gate 2: latency-risk. The edge cleared the profit floor on paper, but won't
  // survive the expected adverse move over the exposure window -> it's a ghost.
  if (latencyAdjustedNet < config.minNetProfitAbs || latencyAdjustedPct < config.minNetProfitPct) {
    return reject(result, 'latency_risk');
  }

  result.executable = true;
  return result;
}

function reject(opp: Opportunity, reason: RejectReason): Opportunity {
  opp.executable = false;
  opp.rejectReason = reason;
  return opp;
}
