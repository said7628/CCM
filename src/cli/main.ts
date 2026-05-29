/**
 * CLI entrypoint — the console-first product surface.
 *
 * Wires a MarketDataSource into the ArbitrageEngine and renders a live
 * dashboard. Today it runs against the SimulatedSource (no network); switching
 * to live Binance/Kraken is a single line once the connectors (Phase 1) land:
 *
 *     const source = new LiveSource(trading.exchanges, trading.symbol);
 *
 * Env knobs: TICKS (default 60), INTERVAL_MS (default 150).
 */
import { loadConfig, EXCHANGE_FEES, INITIAL_BALANCES } from '../domain/config';
import { WalletManager } from '../engine/wallet';
import { ArbitrageEngine, type TickResult } from '../engine/engine';
import { SimulatedSource, type MarketDataSource } from '../exchanges/source';
import { toQuote } from '../engine/orderbook';
import type { OrderBook } from '../domain/types';

const usd = (n: number): string =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number): string => (n * 100).toFixed(3) + '%';
const btc = (n: number): string => n.toFixed(4) + ' BTC';

function renderDashboard(state: TickResult, books: OrderBook[], stats: ReturnType<ArbitrageEngine['getStats']>): string {
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

  return lines.join('\n');
}

function logLine(tick: number, state: TickResult, stats: ReturnType<ArbitrageEngine['getStats']>): string {
  const best = state.best
    ? `buy ${state.best.buyExchange}@${state.best.effectiveBuyPrice.toFixed(0)} sell ${state.best.sellExchange}@${state.best.effectiveSellPrice.toFixed(0)} net ${usd(state.best.netProfit)} (${pct(state.best.netProfitPct)}) x${state.best.amount.toFixed(3)}`
    : 'no opp';
  const exec = state.executed
    ? `EXEC ${state.executed.partial ? '(partial) ' : ''}${usd(state.executed.netProfit)}`
    : state.haltedByRisk
      ? `HALT(${state.risk.tripReason})`
      : '—';
  return `[t${String(tick).padStart(3)}] mark=${state.snapshot.markPrice.toFixed(2)} | ${best} | ${exec} | PnL=${usd(stats.realizedPnl)} trades=${stats.tradesExecuted} brk=${state.risk.breakerActive ? 'ON' : 'off'}`;
}

async function main(): Promise<void> {
  const { trading, risk } = loadConfig();
  const useLive = process.env.SOURCE === 'live';
  const totalTicks = process.env.TICKS ? Number(process.env.TICKS) : useLive ? Infinity : 60;
  const intervalMs = Number(process.env.INTERVAL_MS ?? 150);
  const isTTY = Boolean(process.stdout.isTTY);

  const wallets = new WalletManager(INITIAL_BALANCES);
  const engine = new ArbitrageEngine(wallets, { fees: EXCHANGE_FEES, trading, risk });
  let source: MarketDataSource;
  if (useLive) {
    // Lazy-load so the simulated path never requires ccxt to be installed.
    const { LiveSource } = await import('../exchanges/live');
    source = new LiveSource(trading.exchanges, trading.symbol, trading.orderBookDepth, trading.pollIntervalMs);
  } else {
    source = new SimulatedSource({ exchanges: trading.exchanges, symbol: trading.symbol });
  }
  await source.start();

  // Graceful shutdown for live mode.
  process.on('SIGINT', () => {
    void source.stop().then(() => process.exit(0));
  });

  console.log(`Starting BTC arbitrage bot — ${trading.symbol} on ${trading.exchanges.join(', ')}`);
  console.log(`Mode: ${useLive ? 'LIVE' : 'SIMULATED'} feed | ${totalTicks === Infinity ? '∞' : totalTicks} ticks @ ${intervalMs}ms\n`);

  let lastState: TickResult | null = null;
  let lastSig = '';
  for (let i = 1; i <= totalTicks; i++) {
    let books: OrderBook[];
    if (source.advance) {
      // Synthetic source: step it forward every iteration.
      source.advance();
      books = source.getBooks();
    } else {
      // Live source: only act when the book snapshot actually changed, so we
      // never execute twice against the same stale data.
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
    const stats = engine.getStats();

    if (isTTY) {
      process.stdout.write('\x1b[2J\x1b[H'); // clear screen + home
      process.stdout.write(renderDashboard(state, books, stats) + '\n');
    } else {
      console.log(logLine(i, state, stats));
    }
    if (intervalMs > 0) await sleep(intervalMs);
  }

  await source.stop();

  const stats = engine.getStats();
  console.log('\n──────────────── SUMMARY ────────────────');
  console.log(`  ticks run         ${stats.ticks}`);
  console.log(`  opportunities     ${stats.opportunitiesSeen}`);
  console.log(`  trades executed   ${stats.tradesExecuted} (${stats.partialTrades} partial)`);
  console.log(`  realized P&L      ${usd(stats.realizedPnl)}`);
  console.log(`  best single trade ${usd(stats.bestTradePnl)}`);
  const finalMark = lastState?.snapshot.markPrice ?? 0;
  console.log(`  final value       ${usd(wallets.snapshot(finalMark).totalValueQuote)}`);
  console.log('──────────────────────────────────────────');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
