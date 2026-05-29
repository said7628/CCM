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

import { loadConfig, EXCHANGE_FEES, buildBalances } from '../domain/config';
import { WalletManager } from '../engine/wallet';
import { ArbitrageEngine, type TickResult } from '../engine/engine';
import { SimulatedSource, type MarketDataSource } from '../exchanges/source';
import { TriangularEngine } from '../exchanges/triangular';
import type { TriFeed } from '../exchanges/tri-source';
import type { OrderBook, Opportunity } from '../domain/types';

const PORT = Number(process.env.PORT ?? 8080);
const PNL_HISTORY_MAX = 180;

async function buildSource(
  mode: string,
  trading: ReturnType<typeof loadConfig>['trading'],
  intervalMs: number,
): Promise<MarketDataSource> {
  switch (mode) {
    case 'live': {
      const ws = trading.exchanges.filter((e) => e === 'binance' || e === 'kraken');
      const rest = trading.exchanges.filter((e) => e !== 'binance' && e !== 'kraken');
      const parts: MarketDataSource[] = [];
      if (ws.length) {
        const { WebSocketSource } = await import('../exchanges/ws-source');
        parts.push(new WebSocketSource(ws, trading.symbol, trading.orderBookDepth));
      }
      if (rest.length) {
        const { LiveSource } = await import('../exchanges/live');
        parts.push(new LiveSource(rest, trading.symbol, trading.orderBookDepth, trading.pollIntervalMs));
        console.log(`[info] live: WebSocket(${ws.join(',') || 'none'}) + REST(${rest.join(',')})`);
      }
      const { CompositeSource } = await import('../exchanges/composite');
      return new CompositeSource(parts);
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
  let streamSeq = 0;
  const clients = new Set<http.ServerResponse>();

  const broadcastLatest = (): void => {
    if (!latest) return;
    const frame = `data: ${JSON.stringify(latest)}\n\n`;
    for (const res of clients) res.write(frame);
  };

  const onTick = (state: TickResult, books: OrderBook[]): void => {
    const stats = engine.getStats();
    const trades = engine.getTrades().slice(-14).reverse();
    latest = {
      ts: state.timestamp,
      streamSeq: ++streamSeq,
      emittedAt: Date.now(),
      mode,
      symbol: trading.symbol,
      exchanges: trading.exchanges,
      bookAgeMs: state.bookAgeMs,
      avgLatencyMs: engine.avgLatencyMs(),
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
    broadcastLatest();
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
  }, 500);

  // SSE clients receive every real engine tick immediately. A lightweight
  // heartbeat keeps proxies from closing idle streams without replaying stale
  // market data as if it were a new tick.
  setInterval(() => {
    for (const res of clients) res.write(': heartbeat\n\n');
  }, 15_000);


  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    // CORS: the Next.js dashboard runs on a different origin in dev (:3000) and
    // may be served from another host in prod. Allow the SSE/JSON endpoints.
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === '/' || url === '/health') {
      // The UI is the Next.js app now; this server only provides the data API.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'btc-arbitrage-engine', endpoints: ['/stream', '/state', '/control'], live: latest !== null }));
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
    void source.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
