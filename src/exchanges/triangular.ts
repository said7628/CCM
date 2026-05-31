/**
 * Triangular arbitrage — within a SINGLE exchange.
 *
 * Three pairs form a currency loop: BTC/USDT, COIN/USDT, COIN/BTC. If converting
 * around the loop returns more than you started with (after the three taker
 * fees), there's a profit — no second exchange, no transfers, captured instantly.
 *
 * Two directions (with the BTC/USDT anchor mandatory — this stays a BTC
 * arbitrage challenge):
 *   A) USDT → BTC → COIN → USDT   (buy BTC, buy COIN with BTC, sell COIN for USDT)
 *   B) USDT → COIN → BTC → USDT   (buy COIN, sell COIN for BTC, sell BTC for USDT)
 *
 * end/start = product of the three leg rates × (1 − fee)^3. >1 ⇒ profitable.
 *
 * The engine evaluates EVERY active candidate coin (ETH, SOL, XRP, …) against
 * the BTC/USDT base and keeps the best loop. BTC and USDT are always the base of
 * the loop; the activated coins are the "third leg" candidates. Detection is
 * pure and unit-tested with mock books; the engine layers a tiny simulated
 * executor + P&L on top.
 */
import type { OrderBook } from '../domain/types';

/** The legacy fixed triangle (kept for compatibility / the default mid coin). */
export const TRIANGLE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'ETH/BTC'] as const;

/** Mandatory base/anchor currencies for every triangular loop. Never toggled off. */
export const TRI_BASE_COINS = ['BTC', 'USDT'] as const;

/** Liquid candidate "third-leg" coins offered by default (excludes the base coins). */
export const DEFAULT_TRI_COINS = ['ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'LTC', 'USDC', 'EUR'] as const;

/** Sensible default ACTIVE candidate set (kept modest so LIVE polling stays light). */
export const DEFAULT_TRI_COINS_ACTIVE = ['ETH', 'SOL', 'XRP', 'BNB'] as const;

export interface TriLeg {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
}
export interface TriangularOpportunity {
  exchange: string;
  /** The candidate "third-leg" coin this loop triangulates (e.g. ETH, SOL). */
  coin: string;
  path: string; // e.g. "USDT→BTC→ETH→USDT"
  direction: 'A' | 'B';
  legs: TriLeg[];
  startUSDT: number;
  endUSDT: number;
  netProfit: number;
  netProfitPct: number; // (end-start)/start
  /** Estimated total taker fees paid across the three legs, in USDT. */
  feeCostUSDT: number;
  /** Taker fee fraction used for this loop (0.001 = 0.1%). */
  takerFee: number;
  executable: boolean;
}

export interface TriangularTrade {
  id: string;
  timestamp: number;
  exchange: string;
  coin: string;
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

/** The three pairs that make up the loop for a given candidate coin. */
export function pairsForCoin(coin: string): [string, string, string] {
  return ['BTC/USDT', `${coin}/USDT`, `${coin}/BTC`];
}

/**
 * Evaluate both loop directions for ONE candidate coin at top-of-book and
 * return the better one. Returns null if the three pairs aren't all present.
 * BTC and USDT are the mandatory anchors; `coin` is the third leg.
 */
export function evalCoinTriangle(
  books: Record<string, OrderBook>,
  coin: string,
  params: TriParams,
): TriangularOpportunity | null {
  const btcusdt = best(books, 'BTC/USDT');
  const coinusdt = best(books, `${coin}/USDT`);
  const coinbtc = best(books, `${coin}/BTC`);
  if (!btcusdt || !coinusdt || !coinbtc) return null;

  const f = 1 - params.takerFee;
  const start = params.notionalUSDT;
  const feeCostUSDT = start * (1 - f * f * f); // ≈ total taker fees across 3 legs

  // Direction A: USDT→BTC (buy BTC/USDT) → COIN (buy COIN/BTC) → USDT (sell COIN/USDT)
  const endA = (start / btcusdt.ask) * f / coinbtc.ask * f * coinusdt.bid * f;
  // Direction B: USDT→COIN (buy COIN/USDT) → BTC (sell COIN/BTC) → USDT (sell BTC/USDT)
  const endB = (start / coinusdt.ask) * f * coinbtc.bid * f * btcusdt.bid * f;

  const a: TriangularOpportunity = {
    exchange: params.exchange,
    coin,
    path: `USDT→BTC→${coin}→USDT`,
    direction: 'A',
    legs: [
      { pair: 'BTC/USDT', side: 'buy', price: btcusdt.ask },
      { pair: `${coin}/BTC`, side: 'buy', price: coinbtc.ask },
      { pair: `${coin}/USDT`, side: 'sell', price: coinusdt.bid },
    ],
    startUSDT: start,
    endUSDT: endA,
    netProfit: endA - start,
    netProfitPct: (endA - start) / start,
    feeCostUSDT,
    takerFee: params.takerFee,
    executable: false,
  };
  const b: TriangularOpportunity = {
    exchange: params.exchange,
    coin,
    path: `USDT→${coin}→BTC→USDT`,
    direction: 'B',
    legs: [
      { pair: `${coin}/USDT`, side: 'buy', price: coinusdt.ask },
      { pair: `${coin}/BTC`, side: 'sell', price: coinbtc.bid },
      { pair: 'BTC/USDT', side: 'sell', price: btcusdt.bid },
    ],
    startUSDT: start,
    endUSDT: endB,
    netProfit: endB - start,
    netProfitPct: (endB - start) / start,
    feeCostUSDT,
    takerFee: params.takerFee,
    executable: false,
  };

  const better = a.netProfit >= b.netProfit ? a : b;
  better.executable = better.netProfitPct >= params.minNetPct && better.netProfit > 0;
  return better;
}

/**
 * Backward-compatible single-triangle detector (BTC/USDT, ETH/USDT, ETH/BTC).
 * Kept so existing callers/tests are unaffected; delegates to evalCoinTriangle
 * with ETH as the third-leg coin.
 */
export function detectTriangular(
  books: Record<string, OrderBook>,
  params: TriParams,
): TriangularOpportunity | null {
  return evalCoinTriangle(books, 'ETH', params);
}

export interface TriangularMultiResult {
  /** The single best loop across all candidate coins (or null if none priceable). */
  best: TriangularOpportunity | null;
  /** Best loop PER candidate coin that has a full set of books, sorted by netProfit. */
  perCoin: TriangularOpportunity[];
}

/**
 * Evaluate every candidate coin and return the global best plus the per-coin
 * breakdown (used by the dashboard to show all candidate routes). Coins without
 * a complete set of books are skipped gracefully.
 */
export function detectTriangularMulti(
  books: Record<string, OrderBook>,
  params: TriParams,
  coins: readonly string[],
): TriangularMultiResult {
  const perCoin: TriangularOpportunity[] = [];
  for (const coin of coins) {
    if (coin === 'BTC' || coin === 'USDT') continue; // base coins are anchors, not candidates
    const opp = evalCoinTriangle(books, coin, params);
    if (opp) perCoin.push(opp);
  }
  perCoin.sort((x, y) => y.netProfit - x.netProfit);
  return { best: perCoin[0] ?? null, perCoin };
}

/** Lightweight per-coin candidate view for the dashboard. */
export interface TriCandidateView {
  coin: string;
  path: string;
  direction: 'A' | 'B';
  netProfit: number;
  netProfitPct: number;
  executable: boolean;
}

/** Simulated triangular engine: detects across active coins, executes, tracks P&L. */
export class TriangularEngine {
  private balanceUSDT: number;
  private startBalance: number;
  private trades: TriangularTrade[] = [];
  private counter = 0;
  private lastExecAt = 0;
  private stats = { opportunitiesSeen: 0, trades: 0, realizedPnl: 0, bestNetPct: 0 };
  private lastOpp: TriangularOpportunity | null = null;
  private lastPerCoin: TriangularOpportunity[] = [];
  /** Active candidate coins (third leg). BTC/USDT are always the implicit anchors. */
  private coins: string[];

  constructor(
    private params: TriParams & { cooldownMs: number; startBalance: number; coins?: readonly string[] },
  ) {
    this.balanceUSDT = params.startBalance;
    this.startBalance = params.startBalance;
    // Default to ETH so the legacy single-triangle behaviour is preserved when
    // no explicit coin list is supplied (keeps existing tests valid).
    this.coins = (params.coins && params.coins.length ? [...params.coins] : ['ETH'])
      .filter((c) => c !== 'BTC' && c !== 'USDT');
  }

  /** Replace the active candidate coin set (UI toggle). */
  setCoins(coins: readonly string[]): void {
    const next = [...coins].filter((c) => c && c !== 'BTC' && c !== 'USDT');
    this.coins = next.length ? next : ['ETH'];
  }
  getCoins(): string[] {
    return [...this.coins];
  }
  getExchange(): string {
    return this.params.exchange;
  }

  tick(books: Record<string, OrderBook>): void {
    const { best, perCoin } = detectTriangularMulti(books, this.params, this.coins);
    this.lastOpp = best;
    this.lastPerCoin = perCoin;
    if (!best) return;
    if (best.executable) {
      this.stats.opportunitiesSeen += 1;
      if (best.netProfitPct > this.stats.bestNetPct) this.stats.bestNetPct = best.netProfitPct;
      const now = Date.now();
      if (now - this.lastExecAt >= this.params.cooldownMs) {
        this.lastExecAt = now;
        this.balanceUSDT += best.netProfit;
        this.stats.realizedPnl += best.netProfit;
        this.stats.trades += 1;
        this.counter += 1;
        this.trades.push({
          id: `tri-${now.toString(36)}-${this.counter}`,
          timestamp: now,
          exchange: best.exchange,
          coin: best.coin,
          path: best.path,
          notional: best.startUSDT,
          netProfit: best.netProfit,
        });
        if (this.trades.length > 200) this.trades.shift();
      }
    }
  }

  getState(): {
    enabled: true;
    exchange: string;
    coins: string[];
    opportunity: TriangularOpportunity | null;
    candidates: TriCandidateView[];
    feeCostUSDT: number;
    takerFee: number;
    notionalUSDT: number;
    stats: { opportunitiesSeen: number; trades: number; realizedPnl: number; bestNetPct: number };
    balanceUSDT: number;
    startBalance: number;
    trades: TriangularTrade[];
  } {
    return {
      enabled: true,
      exchange: this.params.exchange,
      coins: [...this.coins],
      opportunity: this.lastOpp,
      candidates: this.lastPerCoin.map((o) => ({
        coin: o.coin, path: o.path, direction: o.direction,
        netProfit: o.netProfit, netProfitPct: o.netProfitPct, executable: o.executable,
      })),
      feeCostUSDT: this.lastOpp ? this.lastOpp.feeCostUSDT : 0,
      takerFee: this.params.takerFee,
      notionalUSDT: this.params.notionalUSDT,
      stats: { ...this.stats },
      balanceUSDT: this.balanceUSDT,
      startBalance: this.startBalance,
      trades: this.trades.slice(-12).reverse(),
    };
  }
}
