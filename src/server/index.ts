/**
 * Web server — single process that runs the arbitrage engine and serves a live
 * dashboard. Server→browser updates use Server-Sent Events (SSE): plain HTTP, no
 * extra dependency, perfect for a one-way live feed. The browser opens
 * EventSource('/stream') and receives a JSON state snapshot on every change.
 *
 * Data mode is a persisted server-side setting (live | sim). Both sources can
 * keep running so WebSockets stay connected while the dashboard switches the
 * single active data plane shown to users.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadConfig, EXCHANGE_FEES, buildBalances } from '../domain/config';
import { WalletManager } from '../engine/wallet';
import { ArbitrageEngine, type TickResult } from '../engine/engine';
import { SimulatedSource, type MarketDataSource } from '../exchanges/source';
import { TriangularEngine } from '../exchanges/triangular';
import type { TriFeed } from '../exchanges/tri-source';
import type { OrderBook, Opportunity } from '../domain/types';
import { loadState, saveState, flushState, type PersistedState } from './persistence';
import { loadPrefs, savePrefs, type DataMode, type EnginePrefs } from './prefs';
import { recommend, decideAutoSwitch, type StrategyStat } from '../engine/strategies';

const PORT = Number(process.env.PORT ?? 8080);
const PNL_HISTORY_MAX = 180;
const PRICE_SERIES_MAX = 3700; // ~1h at ~1 sample/sec per exchange
const DATA_MODE_LABEL: Record<DataMode, string> = { live: 'Modo Real', sim: 'Modo Simulación' };
const SOURCE_STATUS: Record<DataMode, string> = { live: 'real_market_data', sim: 'simulation_engine' };

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
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol, streamIntervalMs: intervalMs });
    default:
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol });
  }
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

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 4096) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function isDataMode(v: unknown): v is DataMode {
  return v === 'live' || v === 'sim';
}

interface Runtime {
  mode: DataMode;
  sourceName: 'live' | 'sim-stream';
  eventDriven: boolean;
  source: MarketDataSource | null;
  sourceError: string | null;
  wallets: WalletManager;
  engine: ArbitrageEngine;
  pnlHistory: { t: number; pnl: number; value: number }[];
  priceSeries: Record<string, { t: number; mid: number }[]>;
  latest: object | null;
  triEngine: TriangularEngine | null;
  triFeed: TriFeed | null;
  triTimer: NodeJS.Timeout | null;
}

async function main(): Promise<void> {
  const { trading, risk } = loadConfig();
  const tickIntervalMs = Number(process.env.INTERVAL_MS ?? 250);

  // Restore engine preferences (active exchanges, risk appetite, strategy and the
  // global data mode) from disk so choices survive restarts and are shared across
  // browsers/devices. dataMode defaults to live for safety.
  const prefs: EnginePrefs = loadPrefs();
  let dataMode: DataMode = prefs.dataMode;
  console.log(`[engine] using ${dataMode === 'live' ? 'live source' : 'simulation source'}`);

  const makeRuntime = async (mode: DataMode): Promise<Runtime> => {
    const sourceName: 'live' | 'sim-stream' = mode === 'live' ? 'live' : 'sim-stream';
    const eventDriven = true;
    const wallets = new WalletManager(buildBalances(trading.exchanges));
    const engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });
    engine.setActiveExchanges(prefs.activeExchanges);
    engine.setRiskAppetite(prefs.riskAppetite);

    const rt: Runtime = {
      mode,
      sourceName,
      eventDriven,
      source: null,
      sourceError: null,
      wallets,
      engine,
      pnlHistory: [],
      priceSeries: {},
      latest: null,
      triEngine: null,
      triFeed: null,
      triTimer: null,
    };

    try {
      rt.source = await buildSource(sourceName, trading, Math.min(tickIntervalMs, 120));
      rt.source.onUpdate?.(() => {
        if (!rt.source) return;
        const books = rt.source.getBooks();
        if (books.length < 2) return; // arbitrage needs ≥2 venues; trade whatever is live
        onTick(rt, rt.engine.tick(books), books);
      });
      await rt.source.start();
      console.log(`[engine] ${mode} data source started (${rt.source.name})`);
    } catch (err) {
      rt.sourceError = err instanceof Error ? err.message : String(err);
      console.error(`[engine] ${mode} source failed: ${rt.sourceError}`);
    }

    if (process.env.TRIANGULAR === '1') {
      try {
        const triExchange = process.env.TRI_EXCHANGE ?? 'binance';
        const triFee = Number(process.env.TRI_TAKER ?? EXCHANGE_FEES[triExchange]?.taker ?? 0.001);
        const triNotional = Number(process.env.TRI_NOTIONAL ?? 10_000);
        rt.triEngine = new TriangularEngine({
          exchange: triExchange, takerFee: triFee, notionalUSDT: triNotional,
          minNetPct: trading.minNetProfitPct, cooldownMs: 1000, startBalance: triNotional * 10,
        });
        if (mode === 'live') {
          const { CcxtTriFeed } = await import('../exchanges/tri-source');
          rt.triFeed = new CcxtTriFeed(triExchange, trading.pollIntervalMs, trading.orderBookDepth);
        } else {
          const { SimTriFeed } = await import('../exchanges/tri-source');
          rt.triFeed = new SimTriFeed(triExchange, 200);
        }
        await rt.triFeed.start();
        rt.triTimer = setInterval(() => { if (rt.triFeed && rt.triEngine) rt.triEngine.tick(rt.triFeed.getBooks()); }, mode === 'live' ? 250 : 200);
        console.log(`[info] triangular arbitrage enabled on ${triExchange} for ${mode} (fee ${(triFee * 100).toFixed(3)}%)`);
      } catch (err) {
        console.error(`[engine] ${mode} triangular feed failed: ${(err as Error).message}`);
      }
    }

    const restored = loadState(mode);
    restoreRuntime(rt, restored);
    return rt;
  };

  const runtimes: Record<DataMode, Runtime> = {
    live: await makeRuntime('live'),
    sim: await makeRuntime('sim'),
  };

  // --- Strategy advisor state ---
  let strategyMode = prefs.strategy || 'cross'; // 'cross' | 'triangular' | 'auto'
  let effectiveStrategy = strategyMode === 'auto' ? 'cross' : strategyMode;
  let lastStrategySwitchAt = 0;
  const strategyEvents: { ts: number; from: string; to: string; reason: string }[] = [];

  const activeRuntime = (): Runtime => runtimes[dataMode];
  const strategyStats = (): StrategyStat[] => {
    const rt = activeRuntime();
    const s = rt.engine.getStats();
    const out: StrategyStat[] = [{
      id: 'cross', label: 'Cross-Exchange', realizedPnl: s.realizedPnl,
      trades: s.tradesExecuted, opportunitiesSeen: s.opportunitiesSeen, bestNetPct: 0,
    }];
    if (rt.triEngine) {
      const t = rt.triEngine.getState();
      out.push({
        id: 'triangular', label: 'Triangular', realizedPnl: t.stats.realizedPnl,
        trades: t.stats.trades, opportunitiesSeen: t.stats.opportunitiesSeen, bestNetPct: t.stats.bestNetPct,
      });
    }
    return out;
  };

  const onTick = (rt: Runtime, state: TickResult, books: OrderBook[]): void => {
    const stats = rt.engine.getStats();
    const trades = rt.engine.getTrades().slice(-14).reverse();

    const nowMs = state.timestamp;
    for (const b of books) {
      const bid = b.bids[0]?.price;
      const ask = b.asks[0]?.price;
      const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : (ask ?? bid);
      if (mid === undefined || !Number.isFinite(mid)) continue;
      const arr = (rt.priceSeries[b.exchange] = rt.priceSeries[b.exchange] || []);
      const last = arr[arr.length - 1];
      if (!last || nowMs - last.t >= 1000) {
        arr.push({ t: nowMs, mid });
        if (arr.length > PRICE_SERIES_MAX) arr.shift();
      }
    }

    rt.latest = {
      ts: state.timestamp,
      mode: rt.sourceName,
      dataMode: rt.mode,
      dataModeLabel: DATA_MODE_LABEL[rt.mode],
      isSimulation: rt.mode === 'sim',
      sourceStatus: SOURCE_STATUS[rt.mode],
      sourceError: rt.sourceError,
      symbol: trading.symbol,
      exchanges: trading.exchanges,
      activeExchanges: rt.engine.getActiveExchanges(),
      riskAppetite: rt.engine.getRiskAppetite(),
      bookAgeMs: state.bookAgeMs,
      avgLatencyMs: rt.engine.avgLatencyMs(),
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
      paused: rt.engine.isPaused(),
      risk: state.risk,
      portfolio: {
        totalValueQuote: state.snapshot.totalValueQuote,
        totalBase: state.snapshot.totalBase,
        totalQuote: state.snapshot.totalQuote,
      },
      wallets: rt.wallets.allWallets(),
      pnlHistory: rt.pnlHistory,
      triangular: rt.triEngine ? rt.triEngine.getState() : { enabled: false },
      strategy: {
        mode: strategyMode,
        effective: effectiveStrategy,
        available: rt.triEngine ? ['cross', 'triangular'] : ['cross'],
        recommendation: recommend(strategyStats()),
        events: strategyEvents.slice(-8).reverse(),
      },
    };
  };

  function restoreRuntime(rt: Runtime, restored: PersistedState | null): void {
    if (restored && restored.pnlHistory.length) {
      rt.pnlHistory.push(...restored.pnlHistory.slice(-PNL_HISTORY_MAX));
      console.log(`[persist] restored ${rt.mode} ${rt.pnlHistory.length} P&L points from disk`);
    }
    if (restored && restored.stats) {
      rt.engine.restoreStats(restored.stats as Partial<ReturnType<typeof rt.engine.getStats>>);
      console.log(`[persist] restored ${rt.mode} cumulative stats from disk`);
    }
    if (restored && restored.priceSeries) {
      for (const [ex, arr] of Object.entries(restored.priceSeries)) {
        if (Array.isArray(arr)) rt.priceSeries[ex] = arr.slice(-PRICE_SERIES_MAX);
      }
      const n = Object.values(rt.priceSeries).reduce((a, b) => a + b.length, 0);
      if (n) console.log(`[persist] restored ${rt.mode} ${n} price samples across ${Object.keys(rt.priceSeries).length} exchanges`);
    }
  }

  // Non event-driven fallback for any source without onUpdate.
  for (const rt of Object.values(runtimes)) {
    if (rt.source && (!rt.eventDriven || !rt.source.onUpdate)) {
      let lastSig = '';
      setInterval(() => {
        if (!rt.source) return;
        let books: OrderBook[];
        if (rt.source.advance) {
          rt.source.advance();
          books = rt.source.getBooks();
        } else {
          books = rt.source.getBooks();
          const sig = books.map((b) => `${b.exchange}:${b.timestamp}`).join('|');
          if (sig === lastSig || books.length === 0) return;
          lastSig = sig;
        }
        if (books.length >= 2) onTick(rt, rt.engine.tick(books), books);
      }, tickIntervalMs);
    }
  }

  setInterval(() => {
    if (strategyMode !== 'auto') return;
    const now = Date.now();
    const decision = decideAutoSwitch(strategyStats(), effectiveStrategy, lastStrategySwitchAt, now);
    if (decision.switchTo && decision.switchTo !== effectiveStrategy) {
      const from = effectiveStrategy;
      effectiveStrategy = decision.switchTo;
      lastStrategySwitchAt = now;
      strategyEvents.push({ ts: now, from, to: effectiveStrategy, reason: decision.reason });
      if (strategyEvents.length > 50) strategyEvents.shift();
      console.log(`[strategy] auto-switch ${from} -> ${effectiveStrategy}: ${decision.reason}`);
    }
  }, 2000);

  // Sample P&L history per mode on a steady clock. Separate persistence prevents
  // live and simulated metrics from mixing across mode changes or restarts.
  setInterval(() => {
    for (const rt of Object.values(runtimes)) {
      const s = rt.engine.getStats();
      const mark = (rt.latest as { markPrice?: number } | null)?.markPrice ?? 0;
      rt.pnlHistory.push({ t: Date.now(), pnl: s.realizedPnl, value: rt.wallets.snapshot(mark).totalValueQuote });
      if (rt.pnlHistory.length > PNL_HISTORY_MAX) rt.pnlHistory.shift();
      saveState({
        savedAt: Date.now(),
        pnlHistory: rt.pnlHistory,
        priceSeries: rt.priceSeries,
        trades: rt.engine.getTrades().slice(-50),
        stats: s,
      }, rt.mode);
    }
  }, 1000);

  const stateForRuntime = (rt: Runtime): object => rt.latest ?? {
    ts: Date.now(),
    mode: rt.sourceName,
    dataMode: rt.mode,
    dataModeLabel: DATA_MODE_LABEL[rt.mode],
    isSimulation: rt.mode === 'sim',
    sourceStatus: SOURCE_STATUS[rt.mode],
    sourceError: rt.sourceError,
    symbol: trading.symbol,
    exchanges: trading.exchanges,
    activeExchanges: rt.engine.getActiveExchanges(),
    riskAppetite: rt.engine.getRiskAppetite(),
    bookAgeMs: 0,
    avgLatencyMs: rt.engine.avgLatencyMs(),
    latency: { volatilityPctPerSec: 0, volatilityLive: false, ghostsRejected: 0, executionLatencyMs: trading.executionLatencyMs },
    markPrice: 0,
    books: [],
    opportunities: [],
    trades: [],
    stats: rt.engine.getStats(),
    paused: rt.engine.isPaused(),
    risk: { breakerActive: false },
    portfolio: rt.wallets.snapshot(0),
    wallets: rt.wallets.allWallets(),
    pnlHistory: rt.pnlHistory,
    triangular: rt.triEngine ? rt.triEngine.getState() : { enabled: false },
    strategy: {
      mode: strategyMode,
      effective: effectiveStrategy,
      available: rt.triEngine ? ['cross', 'triangular'] : ['cross'],
      recommendation: recommend(strategyStats()),
      events: strategyEvents.slice(-8).reverse(),
    },
  };

  const clients = new Set<http.ServerResponse>();
  setInterval(() => {
    const frame = `data: ${JSON.stringify(stateForRuntime(activeRuntime()))}\n\n`;
    for (const res of clients) res.write(frame);
  }, 100);

  const sendJson = (res: http.ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const settingsPayload = (): object => ({
    dataMode,
    dataModeLabel: DATA_MODE_LABEL[dataMode],
    isSimulation: dataMode === 'sim',
    sourceStatus: SOURCE_STATUS[dataMode],
  });
  const setDataMode = (next: DataMode): void => {
    if (next === dataMode) return;
    dataMode = next;
    prefs.dataMode = next;
    savePrefs(prefs, true);
    console.log(`[settings] dataMode changed to ${next}`);
    console.log(`[engine] using ${next === 'live' ? 'live source' : 'simulation source'}`);
  };

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
      res.write(`data: ${JSON.stringify(stateForRuntime(activeRuntime()))}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (url === '/api/settings' && req.method === 'GET') {
      sendJson(res, 200, settingsPayload());
    } else if (url === '/api/settings/data-mode' && req.method === 'POST') {
      void readJsonBody(req).then((body) => {
        const next = (body as { dataMode?: unknown }).dataMode;
        if (!isDataMode(next)) {
          sendJson(res, 400, { error: 'dataMode must be "live" or "sim"' });
          return;
        }
        setDataMode(next);
        sendJson(res, 200, settingsPayload());
      }).catch((err) => sendJson(res, 400, { error: (err as Error).message || 'invalid json' }));
    } else if (url === '/control') {
      const q = (req.url ?? '').split('?')[1] ?? '';
      const params = new URLSearchParams(q);
      const cmd = params.get('cmd');
      const rt = activeRuntime();
      if (cmd === 'pause') rt.engine.setPaused(true);
      else if (cmd === 'resume') rt.engine.setPaused(false);
      else if (cmd === 'toggle') rt.engine.setPaused(!rt.engine.isPaused());
      else if (cmd === 'exchanges') {
        const valRaw = params.get('value') ?? '';
        if (valRaw === '__none__') {
          for (const r of Object.values(runtimes)) r.engine.setActiveExchanges([]);
        } else {
          const raw = valRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
          for (const r of Object.values(runtimes)) r.engine.setActiveExchanges(raw.length ? raw : null);
        }
        prefs.activeExchanges = rt.engine.getActiveExchanges();
        savePrefs(prefs);
      } else if (cmd === 'risk') {
        const v = Number(params.get('value'));
        for (const r of Object.values(runtimes)) r.engine.setRiskAppetite(v);
        prefs.riskAppetite = rt.engine.getRiskAppetite();
        savePrefs(prefs);
      } else if (cmd === 'strategy') {
        const v = (params.get('value') ?? '').toLowerCase();
        const allowed = rt.triEngine ? ['cross', 'triangular', 'auto'] : ['cross', 'auto'];
        if (allowed.includes(v)) {
          const from = effectiveStrategy;
          strategyMode = v;
          effectiveStrategy = v === 'auto' ? effectiveStrategy : v;
          if (v !== 'auto' && from !== effectiveStrategy) {
            lastStrategySwitchAt = Date.now();
            strategyEvents.push({ ts: Date.now(), from, to: effectiveStrategy, reason: 'Cambio manual del usuario.' });
          }
          prefs.strategy = strategyMode;
          savePrefs(prefs);
        }
      }
      sendJson(res, 200, {
        paused: rt.engine.isPaused(),
        activeExchanges: rt.engine.getActiveExchanges(),
        riskAppetite: rt.engine.getRiskAppetite(),
        strategy: strategyMode,
        ...settingsPayload(),
      });
    } else if (url === '/prices') {
      sendJson(res, 200, activeRuntime().priceSeries);
    } else if (url === '/state') {
      sendJson(res, 200, stateForRuntime(activeRuntime()));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`Arbitrage dashboard on http://localhost:${PORT}  (dataMode: ${dataMode})`);
  });

  const flushAll = (): void => {
    for (const rt of Object.values(runtimes)) {
      flushState({ savedAt: Date.now(), pnlHistory: rt.pnlHistory, priceSeries: rt.priceSeries, trades: rt.engine.getTrades().slice(-50), stats: rt.engine.getStats() }, rt.mode);
    }
  };

  process.on('SIGINT', () => {
    flushAll();
    void Promise.all(Object.values(runtimes).map((rt) => rt.source?.stop() ?? Promise.resolve()).concat(Object.values(runtimes).map((rt) => rt.triFeed?.stop() ?? Promise.resolve()))).then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
