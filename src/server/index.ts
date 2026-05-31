/**
 * Web server — single process that runs the arbitrage engine and serves a live
 * dashboard. Server→browser updates use Server-Sent Events (SSE): plain HTTP, no
 * extra dependency, perfect for a one-way live feed. The browser opens
 * EventSource('/stream') and receives a JSON state snapshot on every change.
 *
 *   PORT=8080 SOURCE=live npm run server     # live Binance + Kraken
 *   npm run server                           # simulated feed (no network)
 *
 * Just another consumer of the same engine — no business logic here.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadConfig, EXCHANGE_FEES, buildBalances } from '../domain/config';
import { WalletManager } from '../engine/wallet';
import { ArbitrageEngine, type TickResult } from '../engine/engine';
import { SimulatedSource, type MarketDataSource } from '../exchanges/source';
import { TriangularEngine, DEFAULT_TRI_COINS, DEFAULT_TRI_COINS_ACTIVE } from '../exchanges/triangular';
import type { TriFeed } from '../exchanges/tri-source';
import type { OrderBook, Opportunity } from '../domain/types';
import { loadState, saveState, flushState, type PersistedState, type PersistedMode, type PersistedStrategy } from './persistence';
import { loadPrefs, savePrefs, type EnginePrefs } from './prefs';
import { recommend, type StrategyStat } from '../engine/strategies';

const PORT = Number(process.env.PORT ?? 8080);
const PNL_HISTORY_MAX = 180;
const TRIANGULAR_SUPPORTED_EXCHANGES = ['binance', 'kraken', 'coinbase'] as const;
const TRIANGULAR_SUPPORTED_SET = new Set<string>(TRIANGULAR_SUPPORTED_EXCHANGES);
const TRI_UNSUPPORTED_MESSAGE = 'No disponible para Triangular';
const TRI_NO_PAIRS_MESSAGE = 'Sin pares suficientes para Triangular';


interface BacktestMetrics {
  status: 'empty' | 'ready';
  message?: string;
  equity: { t: number; equity: number; pnl: number }[];
  pnlFinal: number;
  peakEquity: number;
  maxDrawdown: number;
  trades: number;
  winRate: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

function tradePnl(t: unknown): number {
  const n = Number((t as { netProfit?: unknown })?.netProfit);
  return Number.isFinite(n) ? n : 0;
}

function tradeTs(t: unknown): number {
  const n = Number((t as { timestamp?: unknown; ts?: unknown })?.timestamp ?? (t as { ts?: unknown })?.ts);
  return Number.isFinite(n) ? n : Date.now();
}

function buildBacktestMetrics(tradesRaw: unknown[], pnlRaw: { t: number; pnl: number; value?: number }[] = []): BacktestMetrics {
  const trades = tradesRaw
    .map((t) => ({ t: tradeTs(t), pnl: tradePnl(t) }))
    .filter((t) => Number.isFinite(t.t) && Number.isFinite(t.pnl))
    .sort((a, b) => a.t - b.t);
  if (trades.length < 2) {
    const equityFromPnl = pnlRaw
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.pnl))
      .map((p) => ({ t: p.t, equity: p.pnl, pnl: p.pnl }));
    return {
      status: 'empty',
      message: 'Sin operaciones suficientes para backtesting. Ejecuta al menos dos operaciones persistidas de esta estrategia y modo (LIVE o SIM) para reconstruir una curva y métricas estadísticamente útiles.',
      equity: equityFromPnl,
      pnlFinal: equityFromPnl.at(-1)?.pnl ?? 0,
      peakEquity: equityFromPnl.reduce((m, p) => Math.max(m, p.equity), 0),
      maxDrawdown: 0,
      trades: trades.length,
      winRate: 0,
      avgPnl: 0,
      bestTrade: 0,
      worstTrade: 0,
    };
  }

  let pnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equity = trades.map((t) => {
    pnl += t.pnl;
    if (pnl > peak) peak = pnl;
    maxDrawdown = Math.max(maxDrawdown, peak - pnl);
    return { t: t.t, equity: pnl, pnl };
  });
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((x) => x > 0).length;
  return {
    status: 'ready',
    equity,
    pnlFinal: pnl,
    peakEquity: peak,
    maxDrawdown,
    trades: trades.length,
    winRate: wins / trades.length,
    avgPnl: pnl / trades.length,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
  };
}

function buildBacktestingState(persisted: PersistedState, mode: PersistedMode): Record<PersistedStrategy, BacktestMetrics> {
  return {
    cross: buildBacktestMetrics(persisted.buckets[mode].cross.trades, persisted.buckets[mode].cross.pnlHistory),
    triangular: buildBacktestMetrics(persisted.buckets[mode].triangular.trades, persisted.buckets[mode].triangular.pnlHistory),
  };
}

function isTriangularSupportedExchange(exchange: string | null | undefined): boolean {
  return !!exchange && TRIANGULAR_SUPPORTED_SET.has(exchange.toLowerCase());
}

function exchangeLabel(exchange: string): string {
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

function triQuoteCurrency(exchange: string): 'USDT' | 'USD' {
  return exchange === 'coinbase' ? 'USD' : 'USDT';
}

function firstSupportedTriExchange(configured: string[], preferred?: string | null): string {
  const normalized = preferred?.toLowerCase();
  if (normalized && isTriangularSupportedExchange(normalized)) return normalized;
  return configured.find((ex) => isTriangularSupportedExchange(ex)) ?? 'binance';
}

async function buildSource(
  mode: string,
  trading: ReturnType<typeof loadConfig>['trading'],
  intervalMs: number,
): Promise<MarketDataSource> {
  switch (mode) {
    case 'live': {
      // WebSocket-ONLY: every venue with a native WS connector streams over a
      // socket; nothing is REST-polled. Any exchange without a WS connector is
      // skipped (with a warning) rather than silently falling back to polling,
      // so the whole feed is genuinely low-latency / push-based.
      const { wsSupported, WebSocketSource } = await import('../exchanges/ws-source');
      const ws = trading.exchanges.filter((e) => wsSupported(e));
      const unsupported = trading.exchanges.filter((e) => !wsSupported(e));
      if (unsupported.length) {
        console.warn(`[warn] no WebSocket connector for: ${unsupported.join(', ')} — skipped (WS-only mode)`);
      }
      if (!ws.length) throw new Error('live mode: no exchanges with a WebSocket connector configured');
      console.log(`[info] live (WebSocket-only): ${ws.join(', ')}`);
      return new WebSocketSource(ws, trading.symbol, trading.orderBookDepth);
    }
    case 'live-rest': {
      const { LiveSource } = await import('../exchanges/live');
      return new LiveSource(trading.exchanges, trading.symbol, trading.orderBookDepth, trading.pollIntervalMs);
    }
    case 'sim-stream':
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol, streamIntervalMs: intervalMs, ...simTuning() });
    default:
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol, ...simTuning() });
  }
}

/** Optional env overrides for the simulator's divergence behaviour. Anything
 *  omitted falls back to the source's built-in (already lively) defaults. */
function simTuning(): { divergenceChance?: number; edgeMinPct?: number; edgeMaxPct?: number; volatility?: number } {
  const numOpt = (key: string): number | undefined => {
    const v = process.env[key];
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const out: { divergenceChance?: number; edgeMinPct?: number; edgeMaxPct?: number; volatility?: number } = {};
  const dc = numOpt('SIM_DIVERGENCE_CHANCE'); if (dc !== undefined) out.divergenceChance = dc;
  const lo = numOpt('SIM_EDGE_MIN_PCT'); if (lo !== undefined) out.edgeMinPct = lo;
  const hi = numOpt('SIM_EDGE_MAX_PCT'); if (hi !== undefined) out.edgeMaxPct = hi;
  const vol = numOpt('SIM_VOLATILITY'); if (vol !== undefined) out.volatility = vol;
  return out;
}

function bookView(b: OrderBook, depth = 9): object {
  const slice = (levels: { price: number; amount: number }[]): { price: number; amount: number }[] =>
    levels.slice(0, depth).map((l) => ({ price: l.price, amount: l.amount }));
  return {
    exchange: b.exchange,
    bestBid: b.bids[0]?.price ?? 0,
    bestAsk: b.asks[0]?.price ?? 0,
    bids: slice(b.bids),
    asks: slice(b.asks),
  };
}

function oppView(o: Opportunity): object {
  return {
    buyExchange: o.buyExchange,
    sellExchange: o.sellExchange,
    buyPrice: o.effectiveBuyPrice || o.buyPrice,
    sellPrice: o.effectiveSellPrice || o.sellPrice,
    amount: o.amount,
    netProfit: o.netProfit,
    netProfitPct: o.netProfitPct,
    grossSpreadPct: o.grossSpreadPct,
    executable: o.executable,
    rejectReason: o.rejectReason ?? null,
    slowestLegAgeMs: o.slowestLegAgeMs ?? null,
    exposureMs: o.exposureMs ?? null,
    latencyRiskCost: o.latencyRiskCost ?? null,
    latencyAdjustedNet: o.latencyAdjustedNet ?? null,
  };
}

async function main(): Promise<void> {
  const { trading, risk } = loadConfig();
  let dataMode: 'live' | 'sim' = ((process.env.SOURCE ?? '').startsWith('live') ? 'live' : 'sim');
  const tickIntervalMs = Number(process.env.INTERVAL_MS ?? 150);

  let wallets = new WalletManager(buildBalances(trading.exchanges));
  let engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });

  // Restore engine preferences (active exchanges, risk appetite) from disk so the
  // user's choices survive restarts and are shared across browsers/devices.
  const prefs: EnginePrefs = loadPrefs();
  // Explicit SOURCE env wins on boot; otherwise use persisted UI preference.
  dataMode = process.env.SOURCE ? dataMode : (prefs.dataMode ?? dataMode);
  function applyPrefsToEngine(): void {
    engine.setActiveExchanges(prefs.activeExchanges);
    engine.setRiskAppetite(prefs.riskAppetite);
  }
  applyPrefsToEngine();

  // --- Strategy advisor state ---
  // Only two manual modes are exposed: Cross-Exchange and Triangular.
  // Older persisted 'auto' values are normalized back to Cross-Exchange.
  let strategyMode = prefs.strategy === 'triangular' ? 'triangular' : 'cross';
  let effectiveStrategy = strategyMode;
  const strategyEvents: { ts: number; from: string; to: string; reason: string }[] = [];

  const strategyStats = (): StrategyStat[] => {
    const s = engine.getStats();
    const out: StrategyStat[] = [{
      id: 'cross', label: 'Cross-Exchange', realizedPnl: s.realizedPnl,
      trades: s.tradesExecuted, opportunitiesSeen: s.opportunitiesSeen, bestNetPct: 0,
    }];
    if (triEngine) {
      const t = triEngine.getState();
      out.push({
        id: 'triangular', label: 'Triangular', realizedPnl: t.stats.realizedPnl,
        trades: t.stats.trades, opportunitiesSeen: t.stats.opportunitiesSeen, bestNetPct: t.stats.bestNetPct,
      });
    }
    return out;
  };


  let source: MarketDataSource | null = null;

  // Triangular arbitrage (within ONE exchange). Always instantiated so the
  // dashboard can drive it; it only consumes CPU on its own small feed and
  // never touches the cross-exchange engine's books or wallets. The legacy
  // TRIANGULAR=1 / TRI_* env vars still seed the defaults for headless runs.
  let triEngine: TriangularEngine | null = null;
  let triFeed: TriFeed | null = null;

  // Resolve the triangular venue: persisted pref → env → first connected venue.
  const defaultTriExchange = firstSupportedTriExchange(trading.exchanges, prefs.triExchange ?? process.env.TRI_EXCHANGE);
  let triExchange = defaultTriExchange;
  // Active candidate coins: persisted pref → env list → built-in default set.
  const envCoins = process.env.TRI_COINS?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  let triCoins: string[] = (prefs.triCoins && prefs.triCoins.length)
    ? prefs.triCoins.slice()
    : (envCoins && envCoins.length ? envCoins : [...DEFAULT_TRI_COINS_ACTIVE]);
  // BTC/USDT are mandatory anchors, never candidate "third-leg" coins.
  triCoins = triCoins.filter((c) => c !== 'BTC' && c !== 'USDT' && c !== 'USD');
  if (!triCoins.length) triCoins = [...DEFAULT_TRI_COINS_ACTIVE];

  const triNotional = Number(process.env.TRI_NOTIONAL ?? 10_000);

  const persistedState = loadState();
  const pnlHistory: { t: number; pnl: number; value: number }[] = [];

  function restorePnlForMode(): void {
    pnlHistory.length = 0;
    const bucket = persistedState.buckets[dataMode].cross;
    if (bucket.pnlHistory.length) {
      pnlHistory.push(...bucket.pnlHistory.slice(-PNL_HISTORY_MAX));
      console.log(`[persist] restored ${pnlHistory.length} ${dataMode.toUpperCase()} Cross P&L points from disk`);
    }
  }

  function persistRuntimeState(): void {
    const mode = dataMode as PersistedMode;
    persistedState.savedAt = Date.now();
    persistedState.buckets[mode].cross = {
      pnlHistory: pnlHistory.slice(-PNL_HISTORY_MAX),
      trades: engine.getTrades().slice(-500),
      stats: engine.getStats(),
    };
    if (triEngine) {
      const triState = triEngine.getState();
      const triTrades = triEngine.getTrades();
      let triPnl = 0;
      const triPnlHistory = triTrades
        .slice(-PNL_HISTORY_MAX)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((t) => { triPnl += t.netProfit; return { t: t.timestamp, pnl: triPnl, value: triState.startBalance + triPnl }; });
      persistedState.buckets[mode].triangular = {
        pnlHistory: triPnlHistory,
        trades: triTrades.slice(-500),
        stats: triState.stats,
      };
    }
    persistedState.pnlHistory = pnlHistory.slice(-PNL_HISTORY_MAX);
    persistedState.trades = engine.getTrades().slice(-500);
    persistedState.stats = engine.getStats();
    saveState(persistedState);
  }
  let latest: object | null = null;
  let switchingSource = false;
  let triSync = { rebuilding: false, startedAt: Date.now(), exchange: triExchange };

  function initialTriStatuses(): Record<string, string> {
    const { pairsForCoins } = require('../exchanges/tri-source') as typeof import('../exchanges/tri-source');
    const statuses: Record<string, string> = {};
    for (const pair of pairsForCoins(triCoins, triQuoteCurrency(triExchange))) statuses[pair] = 'Cargando';
    return statuses;
  }

  function resetRuntimeStats(): void {
    wallets = new WalletManager(buildBalances(trading.exchanges));
    engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });
    applyPrefsToEngine();
    pnlHistory.length = 0;
    latest = null;
    restorePnlForMode();
  }

  async function startMarketSource(): Promise<void> {
    if (source) { try { await source.stop(); } catch { /* ignore */ } }
    source = await buildSource(dataMode, trading, Math.min(tickIntervalMs, dataMode === 'live' ? 120 : tickIntervalMs));
    await source.start();
    console.log(`[info] data source active: ${dataMode.toUpperCase()}`);
  }

  function triTakerFor(ex: string): number {
    return Number(process.env.TRI_TAKER ?? EXCHANGE_FEES[ex]?.taker ?? 0.001);
  }

  // (Re)build the triangular engine + feed for the current venue. Called on boot
  // and whenever the user picks a different triangular exchange. Coin changes are
  // applied in place (no rebuild) so LIVE polling adjusts pairs without a stall.
  async function rebuildTriFeed(): Promise<void> {
    triSync = { rebuilding: true, startedAt: Date.now(), exchange: triExchange };
    if (triFeed) { try { await triFeed.stop(); } catch { /* ignore */ } triFeed = null; }
    const triFee = triTakerFor(triExchange);
    triEngine = new TriangularEngine({
      exchange: triExchange, takerFee: triFee, notionalUSDT: triNotional, quoteCurrency: triQuoteCurrency(triExchange),
      minNetPct: trading.minNetProfitPct, cooldownMs: 1000, startBalance: triNotional * 10,
      coins: triCoins,
    });
    // Immediately publish clean "Cargando" rows for the new exchange so stale
    // routes from the previous venue are never displayed as current.
    triEngine.tick({}, initialTriStatuses());
    try {
      if (dataMode === 'live') {
        const { NativeWsTriFeed } = await import('../exchanges/tri-source');
        triFeed = new NativeWsTriFeed(triExchange, triCoins, trading.orderBookDepth, triQuoteCurrency(triExchange));
      } else {
        const { SimTriFeed } = await import('../exchanges/tri-source');
        triFeed = new SimTriFeed(triExchange, triCoins, 200, triQuoteCurrency(triExchange));
      }
      await triFeed.start();
      console.log(`[info] triangular syncing on ${triExchange} (${dataMode.toUpperCase()}, fee ${(triFee * 100).toFixed(3)}%, coins ${triCoins.join(',')})`);
    } finally {
      triSync.rebuilding = false;
    }
  }

  await startMarketSource();
  await rebuildTriFeed();
  // Drive the triangular engine off its own clock, independent of the cross feed.
  setInterval(() => {
    if (triFeed && triEngine) triEngine.tick(triFeed.getBooks(), triFeed.getPairStatuses?.());
  }, dataMode === 'live' ? 250 : 200);


  restorePnlForMode();

  function triangularUiState(): object {
    if (!triEngine) return { enabled: false };
    const state = triEngine.getState();
    const statuses = triFeed?.getPairStatuses?.() ?? initialTriStatuses();
    const requiredPairs = triFeed?.getRequiredPairs?.() ?? Object.keys(statuses);
    const readyPairs = requiredPairs.filter((p) => statuses[p] === 'Listo' || statuses[p] === 'OK').length;
    const waitingPairs = requiredPairs.filter((p) => /Cargando|WebSocket pendiente|Esperando WebSocket|Sin order book/.test(statuses[p] ?? ''));
    const unavailablePairs = requiredPairs.filter((p) => /Par no disponible/.test(statuses[p] ?? ''));
    const blockedPairs = requiredPairs.filter((p) => /Endpoint bloqueado|blocked|restricted|451/i.test(statuses[p] ?? ''));
    const expectedRoutes = triCoins.length;
    const readyRoutes = state.candidates.filter((c) => !['Cargando', 'Esperando WebSocket', 'WebSocket pendiente', 'Sin order book todavía', 'Datos incompletos'].includes(c.status)).length;
    const elapsedMs = Date.now() - triSync.startedAt;
    const loading = triSync.rebuilding || (readyPairs < requiredPairs.length && elapsedMs < Number(process.env.TRI_LOADING_GRACE_MS ?? 8000));
    const slow = !loading && waitingPairs.length > 0;
    const exchangeName = exchangeLabel(triExchange);
    const sample = triCoins.slice(0, 1)[0] ?? 'COIN';
    return {
      ...state,
      baseCoins: ['BTC', triQuoteCurrency(triExchange)],
      availableCoins: [...DEFAULT_TRI_COINS],
      activeCoins: triEngine.getCoins(),
      candidateExchanges: trading.exchanges,
      supportedExchanges: [...TRIANGULAR_SUPPORTED_EXCHANGES],
      exchangeOptions: trading.exchanges.map((exchange) => {
        const supported = isTriangularSupportedExchange(exchange);
        const selected = exchange === triExchange;
        const noPairs = selected && state.candidates.length > 0
          && state.candidates.every((c) => c.status === 'Par no disponible' || c.status === 'Sin pares suficientes' || c.status === 'Endpoint bloqueado');
        const available = supported && !noPairs;
        const reason = supported ? (noPairs ? TRI_NO_PAIRS_MESSAGE : null) : TRI_UNSUPPORTED_MESSAGE;
        return { exchange, supported, available, reason };
      }),
      pairStatuses: statuses,
      sync: {
        loading,
        slow,
        message: loading ? `Sincronizando order books de ${exchangeName}…` : (slow ? 'Algunos pares siguen esperando WebSocket' : `Order books sincronizados en ${exchangeName}`),
        detail: `Cargando pares BTC/${triQuoteCurrency(triExchange)}, ${sample}/${triQuoteCurrency(triExchange)} y ${sample}/BTC…`,
        readyPairs,
        totalPairs: requiredPairs.length,
        readyRoutes,
        totalRoutes: expectedRoutes,
        waitingWebSockets: waitingPairs.length,
        unavailablePairs: unavailablePairs.length,
        blockedPairs: blockedPairs.length,
        elapsedMs,
        requiredPairs,
      },
    };
  }

  const onTick = (state: TickResult, books: OrderBook[]): void => {
    const stats = engine.getStats();
    const trades = engine.getTrades().slice(-14).reverse();
    latest = {
      ts: state.timestamp,
      mode: dataMode,
      dataMode,
      symbol: trading.symbol,
      exchanges: trading.exchanges,
      activeExchanges: engine.getActiveExchanges(),
      riskAppetite: engine.getRiskAppetite(),
      riskEffective: engine.getEffectiveRiskSettings(),
      bookAgeMs: state.bookAgeMs,
      avgLatencyMs: engine.avgLatencyMs(),
      latency: state.latency,
      markPrice: state.snapshot.markPrice,
      books: books.map((b) => bookView(b)),
      opportunities: state.opportunities.slice(0, 30).map(oppView),
      trades: trades.map((t) => ({
        ts: t.timestamp,
        buyExchange: t.buy.exchange,
        sellExchange: t.sell.exchange,
        amount: t.buy.amount,
        fee: t.tradingFees,
        slippage: t.slippageCost + t.latencyPenalty,
        netProfit: t.netProfit,
        status: t.partial ? 'PARTIAL' : 'FILLED',
        partial: t.partial,
      })),
      stats,
      paused: engine.isPaused(),
      risk: state.risk,
      portfolio: {
        totalValueQuote: state.snapshot.totalValueQuote,
        totalBase: state.snapshot.totalBase,
        totalQuote: state.snapshot.totalQuote,
      },
      wallets: wallets.allWallets(),
      pnlHistory,
      triangular: triangularUiState(),
      backtesting: buildBacktestingState(persistedState, dataMode),
      strategy: {
        mode: strategyMode,
        effective: effectiveStrategy,
        // Triangular is always available now (the engine is always instantiated).
        available: ['cross', 'triangular'],
        recommendation: recommend(strategyStats()),
        events: strategyEvents.slice(-8).reverse(),
      },
    };
  };

  // Drive the engine from the currently selected source. The source object is
  // mutable so /control?cmd=data-mode can swap LIVE ⇄ SIM without restarting.
  let lastSig = '';
  setInterval(() => {
    if (!source || switchingSource) return;
    let books: OrderBook[];
    if (source.advance) {
      source.advance();
      books = source.getBooks();
    } else {
      books = source.getBooks();
      const sig = books.map((b) => `${b.exchange}:${b.timestamp}`).join('|');
      if (sig === lastSig || books.length === 0) return;
      lastSig = sig;
    }
    if (books.length < 2) return;
    onTick(engine.tick(books), books);
  }, tickIntervalMs);

  // Sample P&L history on a steady clock (decoupled from tick rate).
  setInterval(() => {
    const s = engine.getStats();
    const mark = (latest as { markPrice?: number } | null)?.markPrice ?? 0;
    pnlHistory.push({ t: Date.now(), pnl: s.realizedPnl, value: wallets.snapshot(mark).totalValueQuote });
    if (pnlHistory.length > PNL_HISTORY_MAX) pnlHistory.shift();
    // Debounced, throttled disk write — keeps persistence off the hot path.
    persistRuntimeState();
  }, 1000);

  // SSE clients.
  const clients = new Set<http.ServerResponse>();
  setInterval(() => {
    if (!latest) return;
    const frame = `data: ${JSON.stringify(latest)}\n\n`;
    for (const res of clients) res.write(frame);
  }, 100);

  const indexHtml = path.join(__dirname, 'public', 'index.html');

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      fs.readFile(indexHtml, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('dashboard not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
    } else if (url.endsWith('.png')) {
      // Serve static PNG assets (logo, mark) from the public dir.
      const file = path.join(__dirname, 'public', path.basename(url));
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); }
        else { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(data); }
      });
    } else if (url === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (url === '/control') {
      const q = (req.url ?? '').split('?')[1] ?? '';
      const params = new URLSearchParams(q);
      const cmd = params.get('cmd');
      if (cmd === 'pause') engine.setPaused(true);
      else if (cmd === 'resume') engine.setPaused(false);
      else if (cmd === 'toggle') engine.setPaused(!engine.isPaused());
      else if (cmd === 'exchanges') {
        const valRaw = params.get('value') ?? '';
        if (valRaw === '__none__') {
          engine.setActiveExchanges([]); // explicit: disable all -> engine sees no venues
        } else {
          const raw = valRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
          engine.setActiveExchanges(raw.length ? raw : null); // empty/all -> clear filter
        }
        prefs.activeExchanges = engine.getActiveExchanges();
        savePrefs(prefs);
      } else if (cmd === 'risk') {
        engine.setRiskAppetite(Number(params.get('value')));
        prefs.riskAppetite = engine.getRiskAppetite();
        savePrefs(prefs);
      } else if (cmd === 'strategy') {
        const v = (params.get('value') ?? '').toLowerCase();
        const allowed = ['cross', 'triangular']; // triangular always available
        if (allowed.includes(v)) {
          const from = effectiveStrategy;
          strategyMode = v;
          effectiveStrategy = v;
          if (from !== effectiveStrategy) {
            strategyEvents.push({ ts: Date.now(), from, to: effectiveStrategy, reason: 'Cambio manual del usuario.' });
          }
          prefs.strategy = strategyMode;
          savePrefs(prefs);
        }
      } else if (cmd === 'data-mode') {
        const v = (params.get('value') ?? '').toLowerCase();
        if ((v === 'live' || v === 'sim') && v !== dataMode) {
          switchingSource = true;
          dataMode = v as 'live' | 'sim';
          prefs.dataMode = dataMode;
          savePrefs(prefs);
          void (async () => {
            try {
              resetRuntimeStats();
              await startMarketSource();
              await rebuildTriFeed();
              lastSig = '';
            } catch (e) {
              console.error('[data-mode] switch failed:', (e as Error).message);
            } finally {
              switchingSource = false;
            }
          })();
        }
      } else if (cmd === 'tri-exchange') {
        // Triangular runs on exactly ONE supported venue. Switching rebuilds its feed.
        const v = (params.get('value') ?? '').trim().toLowerCase();
        if (v && isTriangularSupportedExchange(v) && v !== triExchange) {
          triExchange = v;
          prefs.triExchange = triExchange;
          savePrefs(prefs);
          // Rebuild the feed/engine for the new venue (async, fire-and-forget).
          void rebuildTriFeed().catch((e) => console.error('[triangular] rebuild failed:', (e as Error).message));
        }
      } else if (cmd === 'tri-coins') {
        // Comma-separated active candidate coins. BTC/USDT are always anchors.
        const valRaw = params.get('value') ?? '';
        const next = valRaw.split(',').map((s) => s.trim().toUpperCase())
          .filter((c) => c && c !== 'BTC' && c !== 'USDT' && c !== 'USD');
        triCoins = next.length ? next : [...DEFAULT_TRI_COINS_ACTIVE];
        prefs.triCoins = triCoins.slice();
        savePrefs(prefs);
        // Apply in place: engine + feed adjust which pairs they price (no reconnect).
        if (triEngine) triEngine.setCoins(triCoins);
        if (triFeed && triFeed.setCoins) triFeed.setCoins(triCoins);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        paused: engine.isPaused(),
        activeExchanges: engine.getActiveExchanges(),
        riskAppetite: engine.getRiskAppetite(),
        strategy: strategyMode,
        triExchange,
        triCoins,
        dataMode,
      }));
    } else if (url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(latest ?? {}));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`Arbitrage dashboard on http://localhost:${PORT}  (mode: ${dataMode})`);
  });

  process.on('SIGINT', () => {
    persistRuntimeState();
    flushState(persistedState);
    void (source?.stop() ?? Promise.resolve()).then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
