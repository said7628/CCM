/**
 * Engine test suite (no framework needed — pure assertions).
 * Run with:  npm test   (alias for: tsx test/run.ts)
 *
 * These tests pin down the math with mock order books, including the exact
 * worked example from the challenge brief, so we KNOW the engine is correct
 * before it ever touches a live exchange.
 */
import type { OrderBook, PriceLevel, ExchangeFees } from '../src/domain/types';
import type { TradingConfig } from '../src/domain/config';
import { walkBook, isWellOrdered, toQuote } from '../src/engine/orderbook';
import { evaluateOpportunity } from '../src/engine/profitability';
import { detectOpportunities } from '../src/engine/detector';
import { executeOpportunity } from '../src/engine/executor';
import { WalletManager } from '../src/engine/wallet';
import { RiskManager } from '../src/engine/risk';
import { ArbitrageEngine } from '../src/engine/engine';
import { LocalOrderBook, crc32 } from '../src/exchanges/localbook';
import { BinanceBookSyncer } from '../src/exchanges/binance-sync';
import { detectTriangular, TriangularEngine } from '../src/exchanges/triangular';

// ---- tiny test harness ----
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 ${name}  ${detail}`);
  }
}
function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

// ---- fixtures ----
function book(exchange: string, bids: number[][], asks: number[][]): OrderBook {
  const toLevels = (rows: number[][]): PriceLevel[] =>
    rows.map(([price, amount]) => ({ price, amount }));
  return {
    exchange,
    symbol: 'BTC/USDT',
    bids: toLevels(bids),
    asks: toLevels(asks),
    timestamp: Date.now(),
  };
}

const flatFee: ExchangeFees = { label: 'X', taker: 0.001, maker: 0.001, withdrawalBTC: 0 };

function cfg(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    symbol: 'BTC/USDT',
    exchanges: ['a', 'b'],
    minNetProfitPct: 0,
    minNetProfitAbs: 0,
    maxTradeSizeBTC: 1,
    requiresWithdrawal: false,
    slippageBufferPct: 0,
    latencyPenaltyPct: 0,
    maxQuoteAgeMs: 60_000,
    pollIntervalMs: 1000,
    orderBookDepth: 20,
    executionCooldownMs: 0,
    ...overrides,
  };
}

console.log('\n=== 1. walkBook / VWAP ===');
{
  // Fill 1.5 BTC across two ask levels: 1.0@100 + 0.5@110 -> VWAP 103.333...
  const r = walkBook([{ price: 100, amount: 1 }, { price: 110, amount: 1 }], 1.5);
  check('fills requested amount', approx(r.filledAmount, 1.5), `got ${r.filledAmount}`);
  check('VWAP across levels', approx(r.avgPrice, (100 * 1 + 110 * 0.5) / 1.5), `got ${r.avgPrice}`);
  check('notional correct', approx(r.notional, 155), `got ${r.notional}`);
  check('reports fully filled', r.fullyFilled);
  check('consumed 2 levels', r.levelsConsumed === 2);

  // Not enough depth: want 5, only 2 available.
  const r2 = walkBook([{ price: 100, amount: 1 }, { price: 110, amount: 1 }], 5);
  check('partial fill when illiquid', approx(r2.filledAmount, 2) && !r2.fullyFilled, `got ${r2.filledAmount}`);
}

console.log('\n=== 2. ordering guards ===');
{
  check('valid book passes', isWellOrdered(book('a', [[100, 1], [99, 1]], [[101, 1], [102, 1]])));
  check('bad bids fail', !isWellOrdered(book('a', [[99, 1], [100, 1]], [[101, 1]])));
  const q = toQuote(book('a', [[100, 2]], [[101, 3]]))!;
  check('quote top-of-book', q.bid === 100 && q.ask === 101 && q.bidAmount === 2 && q.askAmount === 3);
}

console.log('\n=== 3. CHALLENGE worked example ($109.75 / BTC) ===');
{
  // Buy 1 BTC @ 70,000 (fee 0.1%), sell 1 BTC @ 70,250 (fee 0.1%).
  const buy = book('kraken', [[69900, 5]], [[70000, 1]]);
  const sell = book('binance', [[70250, 1]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 1 }),
  });
  check('sizes exactly 1 BTC', approx(opp.amount, 1), `got ${opp.amount}`);
  check('net profit == 109.75', approx(opp.netProfit, 109.75, 1e-4), `got ${opp.netProfit}`);
  check('marked executable', opp.executable);
  check('gross spread 250', approx(opp.grossSpread, 250));
}

console.log('\n=== 4. optimal sizing stops when marginal slice turns unprofitable ===');
{
  // Buy book: 0.4 BTC cheap @70000, then deeper @70300 (unprofitable vs the bid).
  // Sell book: 1.0 BTC @70250.
  const buy = book('a', [[69000, 5]], [[70000, 0.4], [70300, 5]]);
  const sell = book('b', [[70250, 1.0], [70100, 5]], [[70500, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 5 }),
  });
  // At 70300 buy vs 70250 sell, marginal is already negative -> stop at 0.4.
  check('stops at profitable depth (0.4 BTC)', approx(opp.amount, 0.4), `got ${opp.amount}`);
  check('still net positive', opp.netProfit > 0, `got ${opp.netProfit}`);
}

console.log('\n=== 5. thin liquidity -> partial size ===');
{
  const buy = book('a', [[69000, 5]], [[70000, 0.05]]); // only 0.05 BTC offered cheap
  const sell = book('b', [[70250, 10]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 1 }),
  });
  check('caps size to available 0.05 BTC', approx(opp.amount, 0.05), `got ${opp.amount}`);
}

console.log('\n=== 6. fee-eaten spread is rejected ===');
{
  // Gross +0.05% but fees 0.1%+0.1% wipe it out -> negative net.
  const buy = book('a', [[69000, 5]], [[70000, 1]]);
  const sell = book('b', [[70035, 1]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ minNetProfitAbs: 1 }),
  });
  check('not executable', !opp.executable, `net ${opp.netProfit}`);
  check('reason negative/below threshold', opp.rejectReason === 'negative_net' || opp.rejectReason === 'below_threshold', `reason ${opp.rejectReason}`);
}

console.log('\n=== 7. stale data guard ===');
{
  const buy = book('a', [[69000, 5]], [[70000, 1]]);
  const sell = book('b', [[70250, 1]], [[70400, 5]]);
  buy.timestamp = Date.now() - 10_000; // 10s old
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxQuoteAgeMs: 2000 }),
  });
  check('rejected as stale', !opp.executable && opp.rejectReason === 'stale_data', `reason ${opp.rejectReason}`);
}

console.log('\n=== 8. detector picks correct direction & ranks ===');
{
  // Binance ask 70000 / bid 69990 ; Kraken ask 70300 / bid 70250.
  // Profitable: buy Binance (70000) -> sell Kraken (70250). Reverse is a loss.
  const binance = book('binance', [[69990, 5]], [[70000, 2]]);
  const kraken = book('kraken', [[70250, 2]], [[70300, 5]]);
  const fees = { binance: flatFee, kraken: flatFee };
  const opps = detectOpportunities([binance, kraken], { fees, config: cfg({ maxTradeSizeBTC: 2 }) });
  const top = opps[0];
  check('best opp is buy-binance/sell-kraken', top.buyExchange === 'binance' && top.sellExchange === 'kraken', `${top.buyExchange}->${top.sellExchange}`);
  check('best opp executable & profitable', top.executable && top.netProfit > 0, `net ${top.netProfit}`);
  // The reverse direction (buy kraken 70300 / sell binance 69990) has no gross edge,
  // so the detector's pre-filter drops it; only the profitable direction remains.
  check('reverse (losing) direction filtered out', opps.length === 1, `count ${opps.length}`);
}

console.log('\n=== 9. executor: full fill updates wallets & P&L ===');
{
  const buy = book('kraken', [[69900, 5]], [[70000, 1]]);
  const sell = book('binance', [[70250, 1]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 1 }),
  });
  const wm = new WalletManager({ kraken: { base: 1, quote: 100_000 }, binance: { base: 1, quote: 100_000 } });
  const beforeBase = wm.totalBase();
  const trade = executeOpportunity(opp, buy, sell, {
    fees: { kraken: flatFee, binance: flatFee },
    config: cfg({ maxTradeSizeBTC: 1 }),
    buyWallet: wm.getWallet('kraken')!,
    sellWallet: wm.getWallet('binance')!,
  })!;
  check('trade produced', !!trade);
  check('both legs fully filled', trade.buy.fullyFilled && trade.sell.fullyFilled);
  check('not partial', !trade.partial);
  check('trade net profit == 109.75', approx(trade.netProfit, 109.75, 1e-4), `got ${trade.netProfit}`);
  wm.applyTrade(trade);
  check('total BTC preserved (currency-neutral)', approx(wm.totalBase(), beforeBase), `${wm.totalBase()} vs ${beforeBase}`);
  check('realized P&L accrued', approx(wm.getRealizedPnl(), 109.75, 1e-4), `got ${wm.getRealizedPnl()}`);
  check('buy wallet gained 1 BTC', approx(wm.getWallet('kraken')!.base, 2), `got ${wm.getWallet('kraken')!.base}`);
  check('sell wallet lost 1 BTC', approx(wm.getWallet('binance')!.base, 0), `got ${wm.getWallet('binance')!.base}`);
}

console.log('\n=== 10. executor: clamped by USDT budget -> partial ===');
{
  const buy = book('a', [[69900, 5]], [[70000, 1]]);   // opp wants ~1 BTC
  const sell = book('b', [[70250, 5]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 1 }),
  });
  // Only ~$35,000 USDT on buy exchange -> can afford ~0.5 BTC.
  const trade = executeOpportunity(opp, buy, sell, {
    fees: { a: flatFee, b: flatFee },
    config: cfg({ maxTradeSizeBTC: 1 }),
    buyWallet: { exchange: 'a', base: 0, quote: 35_000 },
    sellWallet: { exchange: 'b', base: 5, quote: 0 },
  })!;
  check('flagged partial', trade.partial);
  check('size clamped to ~0.5 BTC', trade.buy.amount > 0.49 && trade.buy.amount < 0.51, `got ${trade.buy.amount}`);
  check('legs balanced (buy==sell amount)', approx(trade.buy.amount, trade.sell.amount), `${trade.buy.amount} vs ${trade.sell.amount}`);
  check('still net positive', trade.netProfit > 0, `got ${trade.netProfit}`);
}

console.log('\n=== 11. executor: clamped by BTC inventory -> partial ===');
{
  const buy = book('a', [[69900, 5]], [[70000, 5]]);
  const sell = book('b', [[70250, 5]], [[70400, 5]]);
  const opp = evaluateOpportunity(buy, sell, {
    buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 2 }),
  });
  // Sell exchange only holds 0.3 BTC.
  const trade = executeOpportunity(opp, buy, sell, {
    fees: { a: flatFee, b: flatFee },
    config: cfg({ maxTradeSizeBTC: 2 }),
    buyWallet: { exchange: 'a', base: 0, quote: 1_000_000 },
    sellWallet: { exchange: 'b', base: 0.3, quote: 0 },
  })!;
  check('size clamped to 0.3 BTC', approx(trade.sell.amount, 0.3, 1e-6), `got ${trade.sell.amount}`);
  check('flagged partial', trade.partial);
}

console.log('\n=== 12. multiple trades accumulate P&L, base preserved ===');
{
  const wm = new WalletManager({ a: { base: 5, quote: 500_000 }, b: { base: 5, quote: 500_000 } });
  const baseStart = wm.totalBase();
  const fees = { a: flatFee, b: flatFee };
  let executedTrades = 0;
  for (let k = 0; k < 3; k++) {
    const buy = book('a', [[69900, 5]], [[70000, 0.5]]);
    const sell = book('b', [[70250, 0.5]], [[70400, 5]]);
    const opp = evaluateOpportunity(buy, sell, {
      buyFees: flatFee, sellFees: flatFee, config: cfg({ maxTradeSizeBTC: 0.5 }),
    });
    const t = executeOpportunity(opp, buy, sell, {
      fees, config: cfg({ maxTradeSizeBTC: 0.5 }),
      buyWallet: wm.getWallet('a')!, sellWallet: wm.getWallet('b')!,
    });
    if (t) { wm.applyTrade(t); executedTrades++; }
  }
  check('executed 3 trades', executedTrades === 3, `got ${executedTrades}`);
  check('cumulative P&L > 0', wm.getRealizedPnl() > 0, `got ${wm.getRealizedPnl()}`);
  check('total BTC preserved across trades', approx(wm.totalBase(), baseStart), `${wm.totalBase()} vs ${baseStart}`);
  const snap = wm.snapshot(70000);
  check('snapshot value = quote + base*mark', approx(snap.totalValueQuote, wm.totalQuote() + wm.totalBase() * 70000));
}

console.log('\n=== 13. risk: trips on consecutive losses, resets after cooldown ===');
{
  const rc = { maxConsecutiveLosses: 3, maxDrawdownAbs: 1e9, circuitBreakerCooldownMs: 1000, maxInventorySkewBTC: 5 };
  const rm = new RiskManager(rc, 100_000);
  const T0 = 1_000_000;
  const loss = (): import('../src/domain/types').Trade => ({
    id: 'x', opportunityId: 'o', timestamp: T0, symbol: 'BTC/USDT',
    buy: { exchange: 'a', side: 'buy', amount: 1, price: 70000, notional: 70000, fee: 70, fullyFilled: true },
    sell: { exchange: 'b', side: 'sell', amount: 1, price: 69990, notional: 69990, fee: 70, fullyFilled: true },
    grossProfit: -10, tradingFees: 140, slippageCost: 0, latencyPenalty: 0, withdrawalCost: 0,
    netProfit: -10, partial: false,
  });
  rm.onTrade(loss(), 99_990, T0);
  rm.onTrade(loss(), 99_980, T0);
  check('not tripped after 2 losses', rm.canTrade(T0));
  rm.onTrade(loss(), 99_970, T0);
  check('tripped after 3rd loss', !rm.canTrade(T0));
  check('still halted within cooldown', !rm.canTrade(T0 + 500));
  check('resumes after cooldown', rm.canTrade(T0 + 1500));
}

console.log('\n=== 14. risk: trips on drawdown ===');
{
  const rc = { maxConsecutiveLosses: 99, maxDrawdownAbs: 200, circuitBreakerCooldownMs: 1000, maxInventorySkewBTC: 5 };
  const rm = new RiskManager(rc, 100_000);
  const T0 = 2_000_000;
  const t = (pnl: number): import('../src/domain/types').Trade => ({
    id: 'x', opportunityId: 'o', timestamp: T0, symbol: 'BTC/USDT',
    buy: { exchange: 'a', side: 'buy', amount: 1, price: 70000, notional: 70000, fee: 70, fullyFilled: true },
    sell: { exchange: 'b', side: 'sell', amount: 1, price: 70300, notional: 70300, fee: 70, fullyFilled: true },
    grossProfit: pnl, tradingFees: 140, slippageCost: 0, latencyPenalty: 0, withdrawalCost: 0,
    netProfit: pnl, partial: false,
  });
  rm.onTrade(t(50), 100_050, T0);        // new peak
  rm.onTrade(t(-100), 99_950, T0);       // drawdown 100, under limit
  check('not tripped under drawdown limit', rm.canTrade(T0));
  rm.onTrade(t(-150), 99_800, T0);       // drawdown 250 > 200 -> trip
  check('tripped over drawdown limit', !rm.canTrade(T0));
}

console.log('\n=== 15. engine: end-to-end tick executes & accrues, idle when flat ===');
{
  const fees = { binance: flatFee, kraken: flatFee };
  const rc = { maxConsecutiveLosses: 99, maxDrawdownAbs: 1e9, circuitBreakerCooldownMs: 1000, maxInventorySkewBTC: 99 };
  const wm = new WalletManager({ binance: { base: 5, quote: 500_000 }, kraken: { base: 5, quote: 500_000 } });
  const engine = new ArbitrageEngine(wm, { fees, trading: cfg({ maxTradeSizeBTC: 1 }), risk: rc });

  const binance = book('binance', [[69990, 5]], [[70000, 2]]);
  const kraken = book('kraken', [[70250, 2]], [[70300, 5]]);
  const r = engine.tick([binance, kraken]);
  check('executed a trade', r.executed !== null, `executed ${r.executed}`);
  check('trade was profitable', (r.executed?.netProfit ?? 0) > 0, `net ${r.executed?.netProfit}`);
  check('realized P&L positive', engine.getStats().realizedPnl > 0, `pnl ${engine.getStats().realizedPnl}`);
  check('snapshot has a mark price', r.snapshot.markPrice > 0, `mark ${r.snapshot.markPrice}`);

  const flat1 = book('binance', [[69990, 5]], [[70010, 5]]);
  const flat2 = book('kraken', [[69990, 5]], [[70010, 5]]);
  const r2 = engine.tick([flat1, flat2]);
  check('idle when no opportunity', r2.executed === null && r2.best === null);
}

console.log('\n=== 16. local order book + CRC32 ===');
{
  check('crc32 known vector', crc32('123456789') === 3421780262, `got ${crc32('123456789')}`);

  const lob = new LocalOrderBook('binance', 'BTC/USDT', 3);
  lob.setSnapshot(
    [[100, 1], [99, 2], [98, 3], [97, 4]],
    [[101, 1], [102, 2], [103, 3], [104, 4]],
    10,
  );
  check('book ready after snapshot', lob.ready);
  const ob = lob.toOrderBook(123);
  check('bids sorted desc & depth-capped', ob.bids.map((l) => l.price).join(',') === '100,99,98', ob.bids.map((l) => l.price).join(','));
  check('asks sorted asc & depth-capped', ob.asks.map((l) => l.price).join(',') === '101,102,103', ob.asks.map((l) => l.price).join(','));
  lob.upsert('bid', 100, 0); // remove top bid
  check('removal promotes next bid', lob.sortedBids()[0].price === 99);
  lob.upsert('ask', 101, 5); // resize a level
  check('upsert resizes level', lob.sortedAsks()[0].amount === 5);
}

console.log('\n=== 17. Binance diff-stream sequencing ===');
{
  // Events arrive before the snapshot -> buffered, then reconciled.
  const lob = new LocalOrderBook('binance', 'BTC/USDT', 50);
  const s = new BinanceBookSyncer(lob);
  check('pre-snapshot event buffered', s.applyEvent({ U: 11, u: 12, b: [[100, 1]], a: [[101, 1]] }) === 'buffered');
  s.applyEvent({ U: 13, u: 14, b: [[99, 2]], a: [] });
  const r = s.applySnapshot([[100, 5], [99, 5]], [[101, 5]], 10);
  check('snapshot reconciles buffer', r === 'applied', `got ${r}`);
  check('lastUpdateId advanced to 14', lob.lastUpdateId === 14, `got ${lob.lastUpdateId}`);
  check('buffered deltas applied (bid 100 -> 1)', lob.sortedBids().find((l) => l.price === 100)?.amount === 1);

  // Gap detection -> resync.
  const lob2 = new LocalOrderBook('binance', 'BTC/USDT', 50);
  const s2 = new BinanceBookSyncer(lob2);
  lob2.setSnapshot([[100, 1]], [[101, 1]], 10);
  check('continuous event applied', s2.applyEvent({ U: 11, u: 12, b: [], a: [] }) === 'applied');
  check('gap triggers resync', s2.applyEvent({ U: 14, u: 15, b: [], a: [] }) === 'resync_needed');
  check('stale event ignored', s2.applyEvent({ U: 5, u: 8, b: [], a: [] }) === 'ignored');

  // Snapshot that can't reconcile a gapped buffer -> resync.
  const lob3 = new LocalOrderBook('binance', 'BTC/USDT', 50);
  const s3 = new BinanceBookSyncer(lob3);
  s3.applyEvent({ U: 18, u: 20, b: [[100, 1]], a: [] }); // buffered
  check('unreconcilable buffer -> resync', s3.applySnapshot([[100, 1]], [[101, 1]], 10) === 'resync_needed');
}

console.log('\n=== 18. executor cost breakdown adds up ===');
{
  const buy = book('a', [[69900, 5]], [[70000, 1]]);
  const sell = book('b', [[70250, 1]], [[70400, 5]]);
  const c = cfg({ maxTradeSizeBTC: 1, slippageBufferPct: 0.0002, latencyPenaltyPct: 0.0001 });
  const opp = evaluateOpportunity(buy, sell, { buyFees: flatFee, sellFees: flatFee, config: c });
  const trade = executeOpportunity(opp, buy, sell, {
    fees: { a: flatFee, b: flatFee }, config: c,
    buyWallet: { exchange: 'a', base: 0, quote: 1_000_000 },
    sellWallet: { exchange: 'b', base: 5, quote: 0 },
  })!;
  check('gross profit == 250', approx(trade.grossProfit, 250, 1e-6), `got ${trade.grossProfit}`);
  check('trading fees == 140.25', approx(trade.tradingFees, 140.25, 1e-6), `got ${trade.tradingFees}`);
  check('slippage == 14.00', approx(trade.slippageCost, 14, 1e-6), `got ${trade.slippageCost}`);
  check('latency penalty == 7.00', approx(trade.latencyPenalty, 7, 1e-6), `got ${trade.latencyPenalty}`);
  const recomputed = trade.grossProfit - trade.tradingFees - trade.slippageCost - trade.latencyPenalty - trade.withdrawalCost;
  check('net == gross − fees − slippage − latency − withdrawal', approx(trade.netProfit, recomputed, 1e-9), `${trade.netProfit} vs ${recomputed}`);
  check('net == 88.75', approx(trade.netProfit, 88.75, 1e-6), `got ${trade.netProfit}`);
}

console.log('\n=== 19. triangular arbitrage ===');
{
  // ETH is cheap in BTC terms (0.0495 vs fair ~0.05) -> direction A profits.
  const tri = {
    'BTC/USDT': book('binance', [[69990, 5]], [[70000, 5]]),
    'ETH/USDT': book('binance', [[3499, 50]], [[3500, 50]]),
    'ETH/BTC': book('binance', [[0.0494, 50]], [[0.0495, 50]]),
  };
  const p = { exchange: 'binance', takerFee: 0.001, notionalUSDT: 10_000, minNetPct: 0.0005 };
  const opp = detectTriangular(tri, p)!;
  check('detects a triangular opportunity', !!opp);
  check('picks the profitable direction A', opp.direction === 'A', `got ${opp.direction}`);
  check('executable', opp.executable, `net% ${opp.netProfitPct}`);
  check('net profit positive & sane (~$60-80)', opp.netProfit > 50 && opp.netProfit < 90, `got ${opp.netProfit}`);
  check('three legs', opp.legs.length === 3);

  // Fair cross-rate -> no profitable loop.
  const eff = {
    'BTC/USDT': book('binance', [[69990, 5]], [[70000, 5]]),
    'ETH/USDT': book('binance', [[3499, 50]], [[3500, 50]]),
    'ETH/BTC': book('binance', [[0.04999, 50]], [[0.05001, 50]]),
  };
  const o2 = detectTriangular(eff, p)!;
  check('efficient book -> not executable', !o2.executable, `net% ${o2.netProfitPct}`);

  // Engine executes and accrues P&L.
  const eng = new TriangularEngine({ ...p, cooldownMs: 0, startBalance: 100_000 });
  eng.tick(tri);
  const st = eng.getState();
  check('engine executed 1 triangular trade', st.stats.trades === 1, `got ${st.stats.trades}`);
  check('USDT balance grew', st.balanceUSDT > 100_000, `got ${st.balanceUSDT}`);
  check('missing pair -> null', detectTriangular({ 'BTC/USDT': tri['BTC/USDT'] }, p) === null);
}

console.log(`\n==================  ${passed} passed, ${failed} failed  ==================\n`);
if (failed > 0) process.exit(1);
