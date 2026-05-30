/**
 * Order-book utilities. Pure, dependency-free, and the foundation of honest
 * profitability: instead of pretending we can fill any size at the top-of-book
 * price, we "walk" the book level by level to get the real volume-weighted
 * average price (VWAP) and detect when liquidity runs out.
 */
import type { OrderBook, PriceLevel, FillResult, Quote } from '../domain/types';

const EPS = 1e-9;

/**
 * Walk a list of price levels to fill `targetAmount` of base currency.
 *
 * The caller passes levels already sorted in the direction they'll be consumed:
 *  - buying  -> pass `asks` (ascending price): we eat the cheapest first.
 *  - selling -> pass `bids` (descending price): we hit the highest first.
 *
 * Returns the realistic VWAP and whether the book had enough depth.
 */
export function walkBook(levels: PriceLevel[], targetAmount: number): FillResult {
  let remaining = targetAmount;
  let filled = 0;
  let notional = 0;
  let levelsConsumed = 0;

  for (const level of levels) {
    if (remaining <= EPS) break;
    const take = Math.min(remaining, level.amount);
    if (take <= 0) continue;
    notional += take * level.price;
    filled += take;
    remaining -= take;
    levelsConsumed += 1;
  }

  return {
    filledAmount: filled,
    avgPrice: filled > EPS ? notional / filled : 0,
    notional,
    fullyFilled: remaining <= EPS,
    levelsConsumed,
  };
}

/** Total base-currency liquidity available across all provided levels. */
export function totalLiquidity(levels: PriceLevel[]): number {
  let sum = 0;
  for (const l of levels) sum += l.amount;
  return sum;
}

/** Extract the cheap top-of-book summary from a full order book. */
export function toQuote(book: OrderBook): Quote | null {
  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  if (!bestBid || !bestAsk) return null;
  return {
    exchange: book.exchange,
    symbol: book.symbol,
    bid: bestBid.price,
    bidAmount: bestBid.amount,
    ask: bestAsk.price,
    askAmount: bestAsk.amount,
    timestamp: book.timestamp,
  };
}

/** Defensive check: are levels sorted as the engine expects? Used in tests/connectors. */
export function isWellOrdered(book: OrderBook): boolean {
  for (let i = 1; i < book.bids.length; i++) {
    if (book.bids[i].price > book.bids[i - 1].price + EPS) return false; // bids must be desc
  }
  for (let i = 1; i < book.asks.length; i++) {
    if (book.asks[i].price < book.asks[i - 1].price - EPS) return false; // asks must be asc
  }
  return true;
}
