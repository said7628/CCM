/**
 * Wallet / balance management.
 *
 * Each exchange holds its own base (BTC) and quote (USDT) balance — this models
 * the "pre-funded inventory" approach real arbitrage desks use: capital sits on
 * both venues so a buy on A and a sell on B can happen simultaneously without
 * waiting for an on-chain transfer on every trade.
 *
 * Applying an arbitrage trade is currency-neutral in BTC (you buy X on A and
 * sell the same X on B), so total BTC is preserved and the net profit accrues
 * in USDT. Over time inventory skews (A gains BTC / loses USDT, B the reverse) —
 * which is exactly the imbalance the risk layer rebalances later.
 */
import type { Wallet, Trade, PortfolioSnapshot } from '../domain/types';

const EPS = 1e-9;

export class WalletManager {
  private wallets = new Map<string, Wallet>();
  private realizedPnl = 0;
  private tradeCount = 0;

  constructor(initial: Record<string, { base: number; quote: number }>) {
    for (const [exchange, b] of Object.entries(initial)) {
      this.wallets.set(exchange, { exchange, base: b.base, quote: b.quote });
    }
  }

  /** Read-only copy of one wallet (null if the exchange isn't funded). */
  getWallet(exchange: string): Wallet | null {
    const w = this.wallets.get(exchange);
    return w ? { ...w } : null;
  }

  /** Read-only copies of all wallets. */
  allWallets(): Wallet[] {
    return [...this.wallets.values()].map((w) => ({ ...w }));
  }

  /** Cumulative realized net profit (quote currency) from all applied trades. */
  getRealizedPnl(): number {
    return this.realizedPnl;
  }

  getTradeCount(): number {
    return this.tradeCount;
  }

  /**
   * Apply an executed trade to the wallets. Mutates internal balances and
   * accrues realized P&L. Throws if balances would go negative — that signals
   * the executor failed to clamp size correctly (a bug we want surfaced loudly).
   */
  applyTrade(trade: Trade): void {
    const buyW = this.wallets.get(trade.buy.exchange);
    const sellW = this.wallets.get(trade.sell.exchange);
    if (!buyW) throw new Error(`No wallet for buy exchange ${trade.buy.exchange}`);
    if (!sellW) throw new Error(`No wallet for sell exchange ${trade.sell.exchange}`);

    const quoteOut = trade.buy.notional + trade.buy.fee; // spent buying BTC
    const quoteIn = trade.sell.notional - trade.sell.fee; // received selling BTC

    if (buyW.quote - quoteOut < -EPS) {
      throw new Error(
        `Insufficient quote on ${buyW.exchange}: have ${buyW.quote}, need ${quoteOut}`,
      );
    }
    if (sellW.base - trade.sell.amount < -EPS) {
      throw new Error(
        `Insufficient base on ${sellW.exchange}: have ${sellW.base}, need ${trade.sell.amount}`,
      );
    }

    buyW.quote -= quoteOut;
    buyW.base += trade.buy.amount;
    sellW.base -= trade.sell.amount;
    sellW.quote += quoteIn;

    this.realizedPnl += trade.netProfit;
    this.tradeCount += 1;
  }

  /** Total BTC held across all venues. */
  totalBase(): number {
    let s = 0;
    for (const w of this.wallets.values()) s += w.base;
    return s;
  }

  /** Total USDT held across all venues. */
  totalQuote(): number {
    let s = 0;
    for (const w of this.wallets.values()) s += w.quote;
    return s;
  }

  /** Mark-to-market portfolio snapshot at a given BTC price. */
  snapshot(markPrice: number): PortfolioSnapshot {
    const totalBase = this.totalBase();
    const totalQuote = this.totalQuote();
    return {
      timestamp: Date.now(),
      totalBase,
      totalQuote,
      markPrice,
      totalValueQuote: totalQuote + totalBase * markPrice,
    };
  }
}
