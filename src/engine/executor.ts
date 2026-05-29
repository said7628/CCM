/**
 * Simulated execution.
 *
 * Turns a detected Opportunity into a concrete Trade by actually walking the
 * order books to realistic fills, then clamping the size by what the wallets
 * can fund:
 *   - buy leg  is limited by the USDT budget on the buy exchange,
 *   - sell leg is limited by the BTC inventory on the sell exchange.
 *
 * The two legs are always executed at a common size (you can't sell BTC you
 * didn't buy in the same arb), so when liquidity or balances fall short we
 * execute a smaller, balanced partial fill rather than an unbalanced position.
 *
 * This is a PURE function (balances passed in, Trade returned) so it is fully
 * unit-testable. The caller applies the resulting Trade to the WalletManager.
 *
 * Note: realized P&L here reflects the observed book at decision time. Modeling
 * the market moving against us mid-execution (adverse latency slippage) is a
 * Phase-5 risk concern layered on top — kept separate so this stays exact.
 */
import type {
  Opportunity,
  OrderBook,
  ExchangeFees,
  Wallet,
  Trade,
  TradeLeg,
} from '../domain/types';
import type { TradingConfig } from '../domain/config';
import { walkBook } from './orderbook';
import type { PriceLevel } from '../domain/types';

const EPS = 1e-9;

export interface ExecutionContext {
  fees: Record<string, ExchangeFees>;
  config: TradingConfig;
  buyWallet: Wallet;
  sellWallet: Wallet;
}

/** Max BTC buyable from `asks` given a USDT budget (fee-inclusive) and a hard cap. */
function maxBuyableWithBudget(
  asks: PriceLevel[],
  quoteBudget: number,
  takerFee: number,
  maxAmount: number,
): number {
  // Budget must also cover the taker fee charged on notional.
  const notionalBudget = quoteBudget / (1 + takerFee);
  let amount = 0;
  let spent = 0;
  for (const level of asks) {
    if (amount >= maxAmount - EPS) break;
    const byBudget = (notionalBudget - spent) / level.price;
    const take = Math.min(level.amount, maxAmount - amount, byBudget);
    if (take <= EPS) break;
    amount += take;
    spent += take * level.price;
    if (take < level.amount - EPS) break; // limited by budget or cap -> stop
  }
  return amount;
}

let tradeCounter = 0;
function nextTradeId(): string {
  tradeCounter += 1;
  return `trade-${Date.now().toString(36)}-${tradeCounter}`;
}

/**
 * Execute an opportunity against the books and wallet balances.
 * Returns the resulting Trade, or null if nothing executable remains
 * (e.g. balances exhausted).
 */
export function executeOpportunity(
  opp: Opportunity,
  buyBook: OrderBook,
  sellBook: OrderBook,
  ctx: ExecutionContext,
): Trade | null {
  if (!opp.executable || opp.amount <= EPS) return null;

  const buyFees = ctx.fees[opp.buyExchange];
  const sellFees = ctx.fees[opp.sellExchange];
  if (!buyFees || !sellFees) return null;

  // Clamp the intended size by liquidity (already baked into opp.amount) and
  // by what the wallets can actually fund.
  const affordableByQuote = maxBuyableWithBudget(
    buyBook.asks,
    ctx.buyWallet.quote,
    buyFees.taker,
    opp.amount,
  );
  const affordableByBase = Math.min(opp.amount, ctx.sellWallet.base);
  let size = Math.min(opp.amount, affordableByQuote, affordableByBase);
  if (size <= EPS) return null;

  // Walk both books at the common size; balance the legs to the smaller fill.
  let buyFill = walkBook(buyBook.asks, size);
  let sellFill = walkBook(sellBook.bids, size);
  const executed = Math.min(buyFill.filledAmount, sellFill.filledAmount);
  if (executed <= EPS) return null;
  if (executed < size - EPS) {
    size = executed;
    buyFill = walkBook(buyBook.asks, size);
    sellFill = walkBook(sellBook.bids, size);
  }

  const buyFeeQuote = buyFill.notional * buyFees.taker;
  const sellFeeQuote = sellFill.notional * sellFees.taker;

  // Full, auditable cost breakdown (all in quote currency).
  const grossProfit = sellFill.notional - buyFill.notional;
  const tradingFees = buyFeeQuote + sellFeeQuote;
  const slippageCost = ctx.config.slippageBufferPct * buyFill.notional;
  const latencyPenalty = ctx.config.latencyPenaltyPct * buyFill.notional;
  const withdrawalCost = ctx.config.requiresWithdrawal
    ? buyFees.withdrawalBTC * sellFill.avgPrice
    : 0;

  const netProfit = grossProfit - tradingFees - slippageCost - latencyPenalty - withdrawalCost;

  const buyLeg: TradeLeg = {
    exchange: opp.buyExchange,
    side: 'buy',
    amount: buyFill.filledAmount,
    price: buyFill.avgPrice,
    notional: buyFill.notional,
    fee: buyFeeQuote,
    fullyFilled: buyFill.fullyFilled,
  };
  const sellLeg: TradeLeg = {
    exchange: opp.sellExchange,
    side: 'sell',
    amount: sellFill.filledAmount,
    price: sellFill.avgPrice,
    notional: sellFill.notional,
    fee: sellFeeQuote,
    fullyFilled: sellFill.fullyFilled,
  };

  return {
    id: nextTradeId(),
    opportunityId: opp.id,
    timestamp: Date.now(),
    symbol: opp.symbol,
    buy: buyLeg,
    sell: sellLeg,
    grossProfit,
    tradingFees,
    slippageCost,
    latencyPenalty,
    withdrawalCost,
    netProfit,
    partial: executed < opp.amount - EPS,
  };
}
