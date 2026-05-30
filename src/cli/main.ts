/**
 * CLI entrypoint — the console-first product surface.
 *
 * Wires a MarketDataSource into the ArbitrageEngine and renders a live
 * dashboard. The engine, renderers and summary are identical across data
 * sources; only the source changes.
 *
 *   SOURCE=sim         deterministic stepped simulator (default, no network)
 *   SOURCE=sim-stream  simulator pushing updates on a timer (event-driven path)
 *   SOURCE=live        Binance + Kraken over WebSocket (lowest latency)  [needs ws]
 *   SOURCE=live-rest   Binance + Kraken via ccxt REST polling            [needs ccxt]
 *
 * Env knobs: TICKS, INTERVAL_MS, plus the trading/risk overrides in config.ts.
 */
import { loadConfig, EXCHANGE_FEES, buildBalances } from '../domain/config';
import { WalletManager } from '../engine/wallet';
import { ArbitrageEngine, type TickResult } from '../engine/engine';
import { SimulatedSource, type MarketDataSource } from '../exchanges/source';
import { toQuote } from '../engine/orderbook';
import type { OrderBook } from '../domain/types';

type Stats = ReturnType<ArbitrageEngine['getStats']>;

const usd = (n: number): string =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number): string => (n * 100).toFixed(3) + '%';
const btc = (n: number): string => n.toFixed(4) + ' BTC';

function renderDashboard(state: TickResult, books: OrderBook[], stats: Stats, avgLat: number): string {
  const lines: string[] = [];
  lines.push('╔════════════════════════════════════════════════════════════════╗');
  lines.push('║   BTC ARBITRAGE BOT  ·  live engine                              ║');
  lines.push('╚════════════════════════════════════════════════════════════════╝');

  lines.push('\n  MARKET');
  for (const b of books) {
    const q = toQuote(b);
    if (!q) continue;
    lines.push(`    ${b.exchange.padEnd(10)} bid ${usd(q.bid).padStart(12)}  ask ${usd(q.ask).padStart(12)}`);
  }

  lines.push('\n  BEST OPPORTUNITY');
  if (state.best) {
    const o = state.best;
    lines.push(`    buy ${o.buyExchange} @ ${usd(o.effectiveBuyPrice)}  →  sell ${o.sellExchange} @ ${usd(o.effectiveSellPrice)}`);
    lines.push(`    size ${btc(o.amount)}   net ${usd(o.netProfit)}  (${pct(o.netProfitPct)})`);
  } else {
    lines.push('    — none above threshold —');
  }

  lines.push('\n  EXECUTION');
  if (state.executed) {
    const t = state.executed;
    lines.push(`    ${t.partial ? '◐ PARTIAL' : '● FILLED '}  ${btc(t.buy.amount)}   P&L ${usd(t.netProfit)}`);
  } else if (state.haltedByRisk) {
    lines.push(`    ⛔ halted by risk (${state.risk.tripReason})`);
  } else {
    lines.push('    idle');
  }

  lines.push('\n  PORTFOLIO');
  lines.push(`    realized P&L   ${usd(stats.realizedPnl)}`);
  lines.push(`    trades         ${stats.tradesExecuted} (${stats.partialTrades} partial)`);
  lines.push(`    value @ mark   ${usd(state.snapshot.totalValueQuote)}   (${btc(state.snapshot.totalBase)} + ${usd(state.snapshot.totalQuote)})`);
  const brk = state.risk.breakerActive ? `TRIPPED (${state.risk.tripReason})` : 'OK';
  lines.push(`    risk breaker   ${brk}   drawdown ${usd(state.risk.drawdown)}`);
  lines.push(`    data latency   ${state.bookAgeMs}ms  (avg ${avgLat.toFixed(1)}ms)`);

  return lines.join('\n');
}

function logLine(tick: number, state: TickResult, stats: Stats): string {
  const best = state.best
    ? `buy ${state.best.buyExchange}@${state.best.effectiveBuyPrice.toFixed(0)} sell ${state.best.sellExchange}@${state.best.effectiveSellPrice.toFixed(0)} net ${usd(state.best.netProfit)} (${pct(state.best.netProfitPct)}) x${state.best.amount.toFixed(3)}`
    : 'no opp';
  const exec = state.executed
    ? `EXEC ${state.executed.partial ? '(partial) ' : ''}${usd(state.executed.netProfit)}`
    : state.haltedByRisk
      ? `HALT(${state.risk.tripReason})`
      : '—';
  return `[t${String(tick).padStart(3)}] mark=${state.snapshot.markPrice.toFixed(2)} lat=${state.bookAgeMs}ms | ${best} | ${exec} | PnL=${usd(stats.realizedPnl)} trades=${stats.tradesExecuted} brk=${state.risk.breakerActive ? 'ON' : 'off'}`;
}

function printSummary(engine: ArbitrageEngine, wallets: WalletManager, lastState: TickResult | null): void {
  const stats = engine.getStats();
  console.log('\n──────────────── SUMMARY ────────────────');
  console.log(`  ticks run         ${stats.ticks}`);
  console.log(`  opportunities     ${stats.opportunitiesSeen}`);
  console.log(`  trades executed   ${stats.tradesExecuted} (${stats.partialTrades} partial)`);
  console.log(`  realized P&L      ${usd(stats.realizedPnl)}`);
  console.log(`  best single trade ${usd(stats.bestTradePnl)}`);
  console.log(`  avg data latency  ${engine.avgLatencyMs().toFixed(2)}ms`);
  const finalMark = lastState?.snapshot.markPrice ?? 0;
  console.log(`  final value       ${usd(wallets.snapshot(finalMark).totalValueQuote)}`);
  console.log('──────────────────────────────────────────');
}

async function buildSource(mode: string, trading: ReturnType<typeof loadConfig>['trading'], intervalMs: number): Promise<MarketDataSource> {
  switch (mode) {
    case 'live': {
      // WebSocket-ONLY: all venues stream over sockets; none are REST-polled.
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
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol, streamIntervalMs: intervalMs || 150 });
    default:
      return new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol });
  }
}

async function main(): Promise<void> {
  const { trading, risk } = loadConfig();
  const mode = process.env.SOURCE ?? 'sim';
  const eventDriven = mode === 'live' || mode === 'sim-stream';
  const totalTicks = process.env.TICKS ? Number(process.env.TICKS) : mode === 'live' ? Infinity : 60;
  const intervalMs = Number(process.env.INTERVAL_MS ?? (eventDriven ? 50 : 150));
  const isTTY = Boolean(process.stdout.isTTY);

  const wallets = new WalletManager(buildBalances(trading.exchanges));
  const engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });
  const source = await buildSource(mode, trading, intervalMs);
  await source.start();

  let lastState: TickResult | null = null;
  const render = (state: TickResult, books: OrderBook[], tickNo: number, log: boolean): void => {
    const stats = engine.getStats();
    if (isTTY) {
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(renderDashboard(state, books, stats, engine.avgLatencyMs()) + '\n');
    } else if (log) {
      console.log(logLine(tickNo, state, stats));
    }
  };

  process.on('SIGINT', () => {
    void source.stop().then(() => {
      printSummary(engine, wallets, lastState);
      process.exit(0);
    });
  });

  console.log(`Starting BTC arbitrage bot — ${trading.symbol} on ${trading.exchanges.join(', ')}`);
  console.log(`Mode: ${mode.toUpperCase()} | ${totalTicks === Infinity ? '∞' : totalTicks} ticks${eventDriven ? ' (event-driven)' : ` @ ${intervalMs}ms`}\n`);

  if (eventDriven && source.onUpdate) {
    // Low-latency path: react the instant a book changes.
    await new Promise<void>((resolve) => {
      let ticks = 0;
      let lastLogAt = 0;
      source.onUpdate!(() => {
        const books = source.getBooks();
        if (books.length < 2) return; // arbitrage needs ≥2 venues; trade whatever is live
        ticks += 1;
        const state = engine.tick(books);
        lastState = state;
        const now = Date.now();
        const log = Boolean(state.executed) || now - lastLogAt > 500;
        if (log) lastLogAt = now;
        render(state, books, ticks, log);
        if (ticks >= totalTicks) resolve();
      });
    });
  } else {
    // Stepped path: simulator advances each loop; REST source uses a stale guard.
    let lastSig = '';
    for (let i = 1; i <= totalTicks; i++) {
      let books: OrderBook[];
      if (source.advance) {
        source.advance();
        books = source.getBooks();
      } else {
        books = source.getBooks();
        const sig = books.map((b) => `${b.exchange}:${b.timestamp}`).join('|');
        if (sig === lastSig || books.length === 0) {
          if (intervalMs > 0) await sleep(intervalMs);
          continue;
        }
        lastSig = sig;
      }
      const state = engine.tick(books);
      lastState = state;
      render(state, books, i, true);
      if (intervalMs > 0) await sleep(intervalMs);
    }
  }

  await source.stop();
  printSummary(engine, wallets, lastState);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
