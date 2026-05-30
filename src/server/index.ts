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
import { TriangularEngine } from '../exchanges/triangular';
import type { TriFeed } from '../exchanges/tri-source';
import type { OrderBook, Opportunity } from '../domain/types';
import { loadState, saveState, flushState } from './persistence';
import { loadPrefs, savePrefs, type EnginePrefs } from './prefs';
import { recommend, decideAutoSwitch, type StrategyStat } from '../engine/strategies';

const PORT = Number(process.env.PORT ?? 8080);
const PNL_HISTORY_MAX = 180;

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

async function main(): Promise<void> {
  const { trading, risk } = loadConfig();
  const mode = process.env.SOURCE ?? 'sim';
  const eventDriven = mode === 'live' || mode === 'sim-stream';
  const tickIntervalMs = Number(process.env.INTERVAL_MS ?? 250);

  const wallets = new WalletManager(buildBalances(trading.exchanges));
  const engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });

  // Restore engine preferences (active exchanges, risk appetite) from disk so the
  // user's choices survive restarts and are shared across browsers/devices.
  const prefs: EnginePrefs = loadPrefs();
  engine.setActiveExchanges(prefs.activeExchanges);
  engine.setRiskAppetite(prefs.riskAppetite);

  // --- Strategy advisor state ---
  // 'cross' = cross-exchange (always available). 'triangular' only when enabled.
  // 'auto' lets the advisor pick; we track the *effective* strategy separately.
  let strategyMode = prefs.strategy || 'cross'; // 'cross' | 'triangular' | 'auto'
  let effectiveStrategy = strategyMode === 'auto' ? 'cross' : strategyMode;
  let lastStrategySwitchAt = 0;
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


  const source = await buildSource(mode, trading, eventDriven ? Math.min(tickIntervalMs, 120) : tickIntervalMs);
  await source.start();

  // Optional triangular arbitrage (within one exchange), enabled with TRIANGULAR=1.
  let triEngine: TriangularEngine | null = null;
  let triFeed: TriFeed | null = null;
  if (process.env.TRIANGULAR === '1') {
    const triExchange = process.env.TRI_EXCHANGE ?? 'binance';
    const triFee = Number(process.env.TRI_TAKER ?? EXCHANGE_FEES[triExchange]?.taker ?? 0.001);
    const triNotional = Number(process.env.TRI_NOTIONAL ?? 10_000);
    triEngine = new TriangularEngine({
      exchange: triExchange, takerFee: triFee, notionalUSDT: triNotional,
      minNetPct: trading.minNetProfitPct, cooldownMs: 1000, startBalance: triNotional * 10,
    });
    if (mode === 'live') {
      const { CcxtTriFeed } = await import('../exchanges/tri-source');
      triFeed = new CcxtTriFeed(triExchange, trading.pollIntervalMs, trading.orderBookDepth);
    } else {
      const { SimTriFeed } = await import('../exchanges/tri-source');
      triFeed = new SimTriFeed(triExchange, 200);
    }
    await triFeed.start();
    setInterval(() => { if (triFeed && triEngine) triEngine.tick(triFeed.getBooks()); }, mode === 'live' ? 250 : 200);
    console.log(`[info] triangular arbitrage enabled on ${triExchange} (fee ${(triFee * 100).toFixed(3)}%)`);
  }

  const pnlHistory: { t: number; pnl: number; value: number }[] = [];
  // Server-side per-exchange mid-price history. Lives here (not just in the
  // browser) so the comparison chart's 15M/1H windows survive page reloads and
  // server restarts, and so every reconnecting client sees the same history.
  const priceSeries: Record<string, { t: number; mid: number }[]> = {};
  const PRICE_SERIES_MAX = 3700; // ~1h at ~1 sample/sec per exchange
  let latest: object | null = null;

  // Restore P&L curve, cumulative stats and the price series from disk so the
  // dashboard (and reconnecting clients) survive a server restart during a demo.
  const restored = loadState();
  if (restored && restored.pnlHistory.length) {
    pnlHistory.push(...restored.pnlHistory.slice(-PNL_HISTORY_MAX));
    console.log(`[persist] restored ${pnlHistory.length} P&L points from disk`);
  }
  if (restored && restored.stats) {
    engine.restoreStats(restored.stats as Partial<ReturnType<typeof engine.getStats>>);
    console.log('[persist] restored cumulative stats from disk');
  }
  if (restored && restored.priceSeries) {
    for (const [ex, arr] of Object.entries(restored.priceSeries)) {
      if (Array.isArray(arr)) priceSeries[ex] = arr.slice(-PRICE_SERIES_MAX);
    }
    const n = Object.values(priceSeries).reduce((a, b) => a + b.length, 0);
    if (n) console.log(`[persist] restored ${n} price samples across ${Object.keys(priceSeries).length} exchanges`);
  }

  const onTick = (state: TickResult, books: OrderBook[]): void => {
    const stats = engine.getStats();
    const trades = engine.getTrades().slice(-14).reverse();

    // Append each venue's current mid to the server-side price history (used by
    // the comparison chart's 15M/1H windows). Throttled to ~1 sample/sec/venue
    // so an hour of data stays bounded.
    const nowMs = state.timestamp;
    for (const b of books) {
      const bid = b.bids[0]?.price;
      const ask = b.asks[0]?.price;
      const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : (ask ?? bid);
      if (mid === undefined || !Number.isFinite(mid)) continue;
      const arr = (priceSeries[b.exchange] = priceSeries[b.exchange] || []);
      const last = arr[arr.length - 1];
      if (!last || nowMs - last.t >= 1000) {
        arr.push({ t: nowMs, mid });
        if (arr.length > PRICE_SERIES_MAX) arr.shift();
      }
    }

    latest = {
      ts: state.timestamp,
      mode,
      symbol: trading.symbol,
      exchanges: trading.exchanges,
      activeExchanges: engine.getActiveExchanges(),
      riskAppetite: engine.getRiskAppetite(),
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
      triangular: triEngine ? triEngine.getState() : { enabled: false },
      strategy: {
        mode: strategyMode,
        effective: effectiveStrategy,
        available: triEngine ? ['cross', 'triangular'] : ['cross'],
        recommendation: recommend(strategyStats()),
        events: strategyEvents.slice(-8).reverse(),
      },
    };
  };

  // Drive the engine.
  if (eventDriven && source.onUpdate) {
    source.onUpdate(() => {
      const books = source.getBooks();
      if (books.length < 2) return; // arbitrage needs ≥2 venues; trade whatever is live
      onTick(engine.tick(books), books);
    });
  } else {
    let lastSig = '';
    setInterval(() => {
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
      onTick(engine.tick(books), books);
    }, tickIntervalMs);
  }

  // Auto-switch: in 'auto' mode the advisor may change the active strategy when
  // another is clearly outperforming (with cooldown + margin to avoid flapping).
  // Each switch is recorded as an event the dashboard shows as an alert.
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

  // Sample P&L history on a steady clock (decoupled from tick rate).
  setInterval(() => {
    const s = engine.getStats();
    const mark = (latest as { markPrice?: number } | null)?.markPrice ?? 0;
    pnlHistory.push({ t: Date.now(), pnl: s.realizedPnl, value: wallets.snapshot(mark).totalValueQuote });
    if (pnlHistory.length > PNL_HISTORY_MAX) pnlHistory.shift();
    // Debounced, throttled disk write — keeps persistence off the hot path.
    saveState({
      savedAt: Date.now(),
      pnlHistory,
      priceSeries,
      trades: engine.getTrades().slice(-50),
      stats: s,
    });
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
        const allowed = triEngine ? ['cross', 'triangular', 'auto'] : ['cross', 'auto'];
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        paused: engine.isPaused(),
        activeExchanges: engine.getActiveExchanges(),
        riskAppetite: engine.getRiskAppetite(),
        strategy: strategyMode,
      }));
    } else if (url === '/prices') {
      // Per-exchange mid-price history for the comparison chart. Fetched once on
      // boot so the 15M/1H windows are populated immediately (and survive
      // reloads), instead of starting empty and filling only going forward.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(priceSeries));
    } else if (url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(latest ?? {}));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`Arbitrage dashboard on http://localhost:${PORT}  (mode: ${mode})`);
  });

  process.on('SIGINT', () => {
    flushState({ savedAt: Date.now(), pnlHistory, priceSeries, trades: engine.getTrades().slice(-50), stats: engine.getStats() });
    void source.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
