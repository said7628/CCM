/**
 * Triangular arbitrage — within a SINGLE exchange.
 *
 * Three pairs form a currency loop: BTC/USDT, ETH/USDT, ETH/BTC. If converting
 * around the loop returns more than you started with (after the three taker
 * fees), there's a profit — no second exchange, no transfers, captured instantly.
 *
 * Two directions:
 *   A) USDT → BTC → ETH → USDT   (buy BTC, buy ETH with BTC, sell ETH for USDT)
 *   B) USDT → ETH → BTC → USDT   (buy ETH, sell ETH for BTC, sell BTC for USDT)
 *
 * end/start = product of the three leg rates × (1 − fee)^3. >1 ⇒ profitable.
 *
 * Detection is pure and unit-tested with mock books; the engine layers a tiny
 * simulated executor + P&L on top.
 */
import type { OrderBook } from '../domain/types';

export const TRIANGLE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'ETH/BTC'] as const;

export interface TriLeg {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
}
export interface TriangularOpportunity {
  exchange: string;
  path: string; // e.g. "USDT→BTC→ETH→USDT"
  direction: 'A' | 'B';
  legs: TriLeg[];
  startUSDT: number;
  endUSDT: number;
  netProfit: number;
  netProfitPct: number; // (end-start)/start
  executable: boolean;
}

export interface TriangularTrade {
  id: string;
  timestamp: number;
  exchange: string;
  path: string;
  notional: number;
  netProfit: number;
}

function best(books: Record<string, OrderBook>, pair: string): { bid: number; ask: number; bidAmt: number; askAmt: number } | null {
  const b = books[pair];
  if (!b || !b.bids[0] || !b.asks[0]) return null;
  return { bid: b.bids[0].price, ask: b.asks[0].price, bidAmt: b.bids[0].amount, askAmt: b.asks[0].amount };
}

export interface TriParams {
  exchange: string;
  takerFee: number;
  notionalUSDT: number;
  minNetPct: number;
}

/**
 * Evaluate both loop directions at top-of-book and return the better one.
 * Returns null if the three pairs aren't all present.
 */
export function detectTriangular(
  books: Record<string, OrderBook>,
  params: TriParams,
): TriangularOpportunity | null {
  const btcusdt = best(books, 'BTC/USDT');
  const ethusdt = best(books, 'ETH/USDT');
  const ethbtc = best(books, 'ETH/BTC');
  if (!btcusdt || !ethusdt || !ethbtc) return null;

  const f = 1 - params.takerFee;
  const start = params.notionalUSDT;

  // Direction A: USDT→BTC (buy BTC/USDT) → ETH (buy ETH/BTC) → USDT (sell ETH/USDT)
  const endA = (start / btcusdt.ask) * f / ethbtc.ask * f * ethusdt.bid * f;
  // Direction B: USDT→ETH (buy ETH/USDT) → BTC (sell ETH/BTC) → USDT (sell BTC/USDT)
  const endB = (start / ethusdt.ask) * f * ethbtc.bid * f * btcusdt.bid * f;

  const a: TriangularOpportunity = {
    exchange: params.exchange,
    path: 'USDT→BTC→ETH→USDT',
    direction: 'A',
    legs: [
      { pair: 'BTC/USDT', side: 'buy', price: btcusdt.ask },
      { pair: 'ETH/BTC', side: 'buy', price: ethbtc.ask },
      { pair: 'ETH/USDT', side: 'sell', price: ethusdt.bid },
    ],
    startUSDT: start,
    endUSDT: endA,
    netProfit: endA - start,
    netProfitPct: (endA - start) / start,
    executable: false,
  };
  const b: TriangularOpportunity = {
    exchange: params.exchange,
    path: 'USDT→ETH→BTC→USDT',
    direction: 'B',
    legs: [
      { pair: 'ETH/USDT', side: 'buy', price: ethusdt.ask },
      { pair: 'ETH/BTC', side: 'sell', price: ethbtc.bid },
      { pair: 'BTC/USDT', side: 'sell', price: btcusdt.bid },
    ],
    startUSDT: start,
    endUSDT: endB,
    netProfit: endB - start,
    netProfitPct: (endB - start) / start,
    executable: false,
  };

  const better = a.netProfit >= b.netProfit ? a : b;
  better.executable = better.netProfitPct >= params.minNetPct && better.netProfit > 0;
  return better;
}

/** Simulated triangular engine: detects, executes (simplified top-of-book), tracks P&L. */
export class TriangularEngine {
  private balanceUSDT: number;
  private startBalance: number;
  private trades: TriangularTrade[] = [];
  private counter = 0;
  private lastExecAt = 0;
  private stats = { opportunitiesSeen: 0, trades: 0, realizedPnl: 0, bestNetPct: 0 };
  private lastOpp: TriangularOpportunity | null = null;

  constructor(
    private params: TriParams & { cooldownMs: number; startBalance: number },
  ) {
    this.balanceUSDT = params.startBalance;
    this.startBalance = params.startBalance;
  }

  tick(books: Record<string, OrderBook>): void {
    const opp = detectTriangular(books, this.params);
    this.lastOpp = opp;
    if (!opp) return;
    if (opp.executable) {
      this.stats.opportunitiesSeen += 1;
      if (opp.netProfitPct > this.stats.bestNetPct) this.stats.bestNetPct = opp.netProfitPct;
      const now = Date.now();
      if (now - this.lastExecAt >= this.params.cooldownMs) {
        this.lastExecAt = now;
        this.balanceUSDT += opp.netProfit;
        this.stats.realizedPnl += opp.netProfit;
        this.stats.trades += 1;
        this.counter += 1;
        this.trades.push({
          id: `tri-${now.toString(36)}-${this.counter}`,
          timestamp: now,
          exchange: opp.exchange,
          path: opp.path,
          notional: opp.startUSDT,
          netProfit: opp.netProfit,
        });
        if (this.trades.length > 200) this.trades.shift();
      }
    }
  }

  getState(): {
    enabled: true;
    exchange: string;
    opportunity: TriangularOpportunity | null;
    stats: typeof TriangularEngine.prototype.stats;
    balanceUSDT: number;
    startBalance: number;
    trades: TriangularTrade[];
  } {
    return {
      enabled: true,
      exchange: this.params.exchange,
      opportunity: this.lastOpp,
      stats: { ...this.stats },
      balanceUSDT: this.balanceUSDT,
      startBalance: this.startBalance,
      trades: this.trades.slice(-12).reverse(),
    };
  }
}
