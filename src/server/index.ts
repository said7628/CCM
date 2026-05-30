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
      bookAgeMs: state.bookAgeMs,
      avgLatencyMs: engine.avgLatencyMs(),
      latency: state.latency,
      markPrice: state.snapshot.markPrice,
      books: books.map((b) => bookView(b)),
      opportunities: state.opportunities.slice(0, 6).map(oppView),
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
      const cmd = new URLSearchParams(q).get('cmd');
      if (cmd === 'pause') engine.setPaused(true);
      else if (cmd === 'resume') engine.setPaused(false);
      else if (cmd === 'toggle') engine.setPaused(!engine.isPaused());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused: engine.isPaused() }));
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
