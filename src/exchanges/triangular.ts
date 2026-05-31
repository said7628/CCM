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
export const DEFAULT_TRI_COINS_ACTIVE = DEFAULT_TRI_COINS;

export interface TriLeg {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  fullyFilled?: boolean;
  levelsConsumed?: number;
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
  status?: TriStatus;
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

export type TriStatus =
  | 'Cargando'
  | 'Listo'
  | 'Ejecutable'
  | 'En espera'
  | 'Sin pares suficientes'
  | 'Sin profundidad suficiente'
  | 'Endpoint bloqueado'
  | 'Par no disponible'
  | 'Sin order book todavía'
  | 'WebSocket pendiente'
  | 'Sin liquidez';

interface ConversionResult {
  out: number;
  feePaidInput: number;
  fullyFilled: boolean;
  avgPrice: number;
  levelsConsumed: number;
}

function buyBaseWithQuote(book: OrderBook, quoteIn: number, fee: number): ConversionResult {
  let quoteLeft = quoteIn;
  let baseGross = 0;
  let spent = 0;
  let levelsConsumed = 0;
  for (const level of book.asks) {
    if (quoteLeft <= 1e-9) break;
    const takeBase = Math.min(level.amount, quoteLeft / level.price);
    if (takeBase <= 0) continue;
    const quote = takeBase * level.price;
    baseGross += takeBase;
    spent += quote;
    quoteLeft -= quote;
    levelsConsumed += 1;
  }
  return {
    out: baseGross * (1 - fee),
    feePaidInput: spent * fee,
    fullyFilled: quoteLeft <= Math.max(1e-9, quoteIn * 1e-9),
    avgPrice: baseGross > 0 ? spent / baseGross : 0,
    levelsConsumed,
  };
}

function sellBaseForQuote(book: OrderBook, baseIn: number, fee: number): ConversionResult {
  let baseLeft = baseIn;
  let quoteGross = 0;
  let sold = 0;
  let levelsConsumed = 0;
  for (const level of book.bids) {
    if (baseLeft <= 1e-12) break;
    const takeBase = Math.min(level.amount, baseLeft);
    if (takeBase <= 0) continue;
    quoteGross += takeBase * level.price;
    sold += takeBase;
    baseLeft -= takeBase;
    levelsConsumed += 1;
  }
  return {
    out: quoteGross * (1 - fee),
    feePaidInput: quoteGross * fee,
    fullyFilled: baseLeft <= Math.max(1e-12, baseIn * 1e-9),
    avgPrice: sold > 0 ? quoteGross / sold : 0,
    levelsConsumed,
  };
}

function feeToUSDT(pair: string, feePaidInput: number, books: Record<string, OrderBook>): number {
  if (pair.endsWith('/USDT')) return feePaidInput;
  if (pair.endsWith('/BTC')) return feePaidInput * (best(books, 'BTC/USDT')?.bid ?? 0);
  return feePaidInput;
}

function candidateStatus(o: TriangularOpportunity): TriStatus {
  if (!o.legs.every((l) => l.fullyFilled !== false)) return 'Sin liquidez';
  return o.executable ? 'Ejecutable' : 'Listo';
}


/** The three pairs that make up the loop for a given candidate coin. */
export function pairsForCoin(coin: string): [string, string, string] {
  return ['BTC/USDT', `${coin}/USDT`, `${coin}/BTC`];
}

function requiredPairsFor(coin: string): string[] {
  return pairsForCoin(coin);
}

function evalDirectionA(
  books: Record<string, OrderBook>, coin: string, params: TriParams,
): TriangularOpportunity | null {
  const btcusdt = books['BTC/USDT'];
  const coinbtc = books[`${coin}/BTC`];
  const coinusdt = books[`${coin}/USDT`];
  if (!btcusdt || !coinbtc || !coinusdt) return null;
  const start = params.notionalUSDT;
  const leg1 = buyBaseWithQuote(btcusdt, start, params.takerFee);
  const leg2 = buyBaseWithQuote(coinbtc, leg1.out, params.takerFee);
  const leg3 = sellBaseForQuote(coinusdt, leg2.out, params.takerFee);
  const feeCostUSDT = leg1.feePaidInput + feeToUSDT(`${coin}/BTC`, leg2.feePaidInput, books) + leg3.feePaidInput;
  const endUSDT = leg3.out;
  const fullyFilled = leg1.fullyFilled && leg2.fullyFilled && leg3.fullyFilled;
  const opp: TriangularOpportunity = {
    exchange: params.exchange,
    coin,
    path: `USDT→BTC→${coin}→USDT`,
    direction: 'A',
    legs: [
      { pair: 'BTC/USDT', side: 'buy', price: leg1.avgPrice || best(books, 'BTC/USDT')?.ask || 0, fullyFilled: leg1.fullyFilled, levelsConsumed: leg1.levelsConsumed },
      { pair: `${coin}/BTC`, side: 'buy', price: leg2.avgPrice || best(books, `${coin}/BTC`)?.ask || 0, fullyFilled: leg2.fullyFilled, levelsConsumed: leg2.levelsConsumed },
      { pair: `${coin}/USDT`, side: 'sell', price: leg3.avgPrice || best(books, `${coin}/USDT`)?.bid || 0, fullyFilled: leg3.fullyFilled, levelsConsumed: leg3.levelsConsumed },
    ],
    startUSDT: start,
    endUSDT,
    netProfit: endUSDT - start,
    netProfitPct: (endUSDT - start) / start,
    feeCostUSDT,
    takerFee: params.takerFee,
    executable: false,
    status: 'En espera',
  };
  opp.executable = fullyFilled && opp.netProfitPct >= params.minNetPct && opp.netProfit > 0;
  opp.status = candidateStatus(opp);
  return opp;
}

function evalDirectionB(
  books: Record<string, OrderBook>, coin: string, params: TriParams,
): TriangularOpportunity | null {
  const btcusdt = books['BTC/USDT'];
  const coinbtc = books[`${coin}/BTC`];
  const coinusdt = books[`${coin}/USDT`];
  if (!btcusdt || !coinbtc || !coinusdt) return null;
  const start = params.notionalUSDT;
  const leg1 = buyBaseWithQuote(coinusdt, start, params.takerFee);
  const leg2 = sellBaseForQuote(coinbtc, leg1.out, params.takerFee);
  const leg3 = sellBaseForQuote(btcusdt, leg2.out, params.takerFee);
  const feeCostUSDT = leg1.feePaidInput + feeToUSDT('BTC/USDT', leg2.feePaidInput, books) + leg3.feePaidInput;
  const endUSDT = leg3.out;
  const fullyFilled = leg1.fullyFilled && leg2.fullyFilled && leg3.fullyFilled;
  const opp: TriangularOpportunity = {
    exchange: params.exchange,
    coin,
    path: `USDT→${coin}→BTC→USDT`,
    direction: 'B',
    legs: [
      { pair: `${coin}/USDT`, side: 'buy', price: leg1.avgPrice || best(books, `${coin}/USDT`)?.ask || 0, fullyFilled: leg1.fullyFilled, levelsConsumed: leg1.levelsConsumed },
      { pair: `${coin}/BTC`, side: 'sell', price: leg2.avgPrice || best(books, `${coin}/BTC`)?.bid || 0, fullyFilled: leg2.fullyFilled, levelsConsumed: leg2.levelsConsumed },
      { pair: 'BTC/USDT', side: 'sell', price: leg3.avgPrice || best(books, 'BTC/USDT')?.bid || 0, fullyFilled: leg3.fullyFilled, levelsConsumed: leg3.levelsConsumed },
    ],
    startUSDT: start,
    endUSDT,
    netProfit: endUSDT - start,
    netProfitPct: (endUSDT - start) / start,
    feeCostUSDT,
    takerFee: params.takerFee,
    executable: false,
    status: 'En espera',
  };
  opp.executable = fullyFilled && opp.netProfitPct >= params.minNetPct && opp.netProfit > 0;
  opp.status = candidateStatus(opp);
  return opp;
}

/** Evaluate one candidate coin using the real order-book depth for all 3 legs. */
export function evalCoinTriangle(
  books: Record<string, OrderBook>,
  coin: string,
  params: TriParams,
): TriangularOpportunity | null {
  const a = evalDirectionA(books, coin, params);
  const b = evalDirectionB(books, coin, params);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a.netProfit >= b.netProfit ? a : b;
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
  /** Candidate rows for every active coin, including clear missing-pair states. */
  candidates: TriCandidateView[];
}


function statusFromPairStatuses(missingPairs: string[], pairStatuses?: Record<string, string>): { status: TriStatus; reasons: string[] } {
  const reasons = missingPairs.map((pair) => `${pair}: ${pairStatuses?.[pair] ?? 'Sin order book todavía'}`);
  const text = reasons.join(' | ').toLowerCase();
  if (text.includes('endpoint bloqueado') || text.includes('451') || text.includes('restricted') || text.includes('blocked')) {
    return { status: 'Endpoint bloqueado', reasons };
  }
  if (text.includes('par no disponible') || text.includes('symbol') || text.includes('market')) {
    return { status: 'Par no disponible', reasons };
  }
  if (text.includes('cargando')) return { status: 'Cargando', reasons };
  if (text.includes('websocket pendiente') || text.includes('esperando websocket')) return { status: 'WebSocket pendiente', reasons };
  if (text.includes('sin liquidez')) return { status: 'Sin liquidez', reasons };
  if (text.includes('sin order book')) return { status: 'Sin order book todavía', reasons };
  return { status: 'Sin pares suficientes', reasons };
}

/**
 * Evaluate every candidate coin and return the global best plus the per-coin
 * breakdown (used by the dashboard to show all candidate routes). Coins without
 * a complete set of books are shown with an explicit status instead of being
 * silently skipped.
 */
export function detectTriangularMulti(
  books: Record<string, OrderBook>,
  params: TriParams,
  coins: readonly string[],
  pairStatuses?: Record<string, string>,
): TriangularMultiResult {
  const perCoin: TriangularOpportunity[] = [];
  const candidates: TriCandidateView[] = [];
  for (const coin of coins) {
    if (coin === 'BTC' || coin === 'USDT') continue; // base coins are anchors, not candidates
    const missingPairs = requiredPairsFor(coin).filter((pair) => !books[pair] || !books[pair].bids[0] || !books[pair].asks[0]);
    if (missingPairs.length) {
      const { status, reasons } = statusFromPairStatuses(missingPairs, pairStatuses);
      candidates.push({
        coin,
        path: `USDT→BTC→${coin}→USDT`,
        direction: 'A',
        netProfit: 0,
        netProfitPct: 0,
        feeCostUSDT: 0,
        executable: false,
        status,
        missingPairs,
        reasons,
      });
      continue;
    }
    const opp = evalCoinTriangle(books, coin, params);
    if (opp) {
      perCoin.push(opp);
      candidates.push({
        coin: opp.coin,
        path: opp.path,
        direction: opp.direction,
        netProfit: opp.netProfit,
        netProfitPct: opp.netProfitPct,
        feeCostUSDT: opp.feeCostUSDT,
        executable: opp.executable,
        status: opp.status ?? candidateStatus(opp),
      });
    }
  }
  perCoin.sort((x, y) => y.netProfit - x.netProfit);
  candidates.sort((x, y) => {
    if (x.status !== y.status) {
      const low = new Set<TriStatus>(['Sin pares suficientes', 'Endpoint bloqueado', 'Par no disponible', 'Sin order book todavía', 'WebSocket pendiente', 'Cargando', 'Sin liquidez']);
      if (low.has(x.status)) return 1;
      if (low.has(y.status)) return -1;
    }
    return y.netProfit - x.netProfit;
  });
  return { best: perCoin[0] ?? null, perCoin, candidates };
}

/** Lightweight per-coin candidate view for the dashboard. */
export interface TriCandidateView {
  coin: string;
  path: string;
  direction: 'A' | 'B';
  netProfit: number;
  netProfitPct: number;
  feeCostUSDT: number;
  executable: boolean;
  status: TriStatus;
  missingPairs?: string[];
  reasons?: string[];
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
  private lastPerCoin: TriCandidateView[] = [];
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

  tick(books: Record<string, OrderBook>, pairStatuses?: Record<string, string>): void {
    const { best, candidates } = detectTriangularMulti(books, this.params, this.coins, pairStatuses);
    this.lastOpp = best;
    this.lastPerCoin = candidates;
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
        netProfit: o.netProfit, netProfitPct: o.netProfitPct, feeCostUSDT: o.feeCostUSDT,
        executable: o.executable, status: o.status, missingPairs: o.missingPairs, reasons: o.reasons,
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
