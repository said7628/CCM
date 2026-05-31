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

  // Triangular arbitrage (within ONE exchange). Always instantiated so the
  // dashboard can drive it; it only consumes CPU on its own small feed and
  // never touches the cross-exchange engine's books or wallets. The legacy
  // TRIANGULAR=1 / TRI_* env vars still seed the defaults for headless runs.
  let triEngine: TriangularEngine | null = null;
  let triFeed: TriFeed | null = null;

  // Resolve the triangular venue: persisted pref → env → first connected venue.
  const defaultTriExchange = prefs.triExchange
    ?? process.env.TRI_EXCHANGE
    ?? trading.exchanges[0]
    ?? 'binance';
  let triExchange = defaultTriExchange;
  // Active candidate coins: persisted pref → env list → built-in default set.
  const envCoins = process.env.TRI_COINS?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  let triCoins: string[] = (prefs.triCoins && prefs.triCoins.length)
    ? prefs.triCoins.slice()
    : (envCoins && envCoins.length ? envCoins : [...DEFAULT_TRI_COINS_ACTIVE]);
  // BTC/USDT are mandatory anchors, never candidate "third-leg" coins.
  triCoins = triCoins.filter((c) => c !== 'BTC' && c !== 'USDT');
  if (!triCoins.length) triCoins = [...DEFAULT_TRI_COINS_ACTIVE];

  const triNotional = Number(process.env.TRI_NOTIONAL ?? 10_000);

  function triTakerFor(ex: string): number {
    return Number(process.env.TRI_TAKER ?? EXCHANGE_FEES[ex]?.taker ?? 0.001);
  }

  // (Re)build the triangular engine + feed for the current venue. Called on boot
  // and whenever the user picks a different triangular exchange. Coin changes are
  // applied in place (no rebuild) so LIVE polling adjusts pairs without a stall.
  async function rebuildTriFeed(): Promise<void> {
    if (triFeed) { try { await triFeed.stop(); } catch { /* ignore */ } triFeed = null; }
    const triFee = triTakerFor(triExchange);
    triEngine = new TriangularEngine({
      exchange: triExchange, takerFee: triFee, notionalUSDT: triNotional,
      minNetPct: trading.minNetProfitPct, cooldownMs: 1000, startBalance: triNotional * 10,
      coins: triCoins,
    });
    if (mode === 'live' || mode === 'live-rest') {
      const { CcxtTriFeed } = await import('../exchanges/tri-source');
      triFeed = new CcxtTriFeed(triExchange, triCoins, trading.pollIntervalMs, trading.orderBookDepth);
    } else {
      const { SimTriFeed } = await import('../exchanges/tri-source');
      triFeed = new SimTriFeed(triExchange, triCoins, 200);
    }
    await triFeed.start();
    console.log(`[info] triangular ready on ${triExchange} (fee ${(triFee * 100).toFixed(3)}%, coins ${triCoins.join(',')})`);
  }

  await rebuildTriFeed();
  // Drive the triangular engine off its own clock, independent of the cross feed.
  setInterval(() => { if (triFeed && triEngine) triEngine.tick(triFeed.getBooks()); }, mode === 'live' ? 250 : 200);

  const pnlHistory: { t: number; pnl: number; value: number }[] = [];
  let latest: object | null = null;

  // Restore P&L curve from disk so the dashboard chart / backtesting view (and
  // reconnecting clients) survive a server restart during a demo.
  const restored = loadState();
  if (restored && restored.pnlHistory.length) {
    pnlHistory.push(...restored.pnlHistory.slice(-PNL_HISTORY_MAX));
    console.log(`[persist] restored ${pnlHistory.length} P&L points from disk`);
  }

  const onTick = (state: TickResult, books: OrderBook[]): void => {
    const stats = engine.getStats();
    const trades = engine.getTrades().slice(-14).reverse();
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
      triangular: triEngine
        ? {
            ...triEngine.getState(),
            // Config the dashboard needs to render the Triangular wallet panel:
            baseCoins: ['BTC', 'USDT'],
            availableCoins: [...DEFAULT_TRI_COINS],
            activeCoins: triEngine.getCoins(),
            // Venues the user may pick as the single triangular exchange.
            candidateExchanges: trading.exchanges,
          }
        : { enabled: false },
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
        const allowed = ['cross', 'triangular', 'auto']; // triangular always available
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
      } else if (cmd === 'tri-exchange') {
        // Triangular runs on exactly ONE venue. Switching rebuilds its feed.
        const v = (params.get('value') ?? '').trim().toLowerCase();
        if (v && v !== triExchange) {
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
          .filter((c) => c && c !== 'BTC' && c !== 'USDT');
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
    console.log(`Arbitrage dashboard on http://localhost:${PORT}  (mode: ${mode})`);
  });

  process.on('SIGINT', () => {
    flushState({ savedAt: Date.now(), pnlHistory, trades: engine.getTrades().slice(-50), stats: engine.getStats() });
    void source.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
