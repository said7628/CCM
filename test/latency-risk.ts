/**
 * Tests for the latency-risk model (ghost-opportunity rejection).
 *
 * The behavior we pin down:
 *   1. A real edge with a low expected adverse move stays executable.
 *   2. The same edge, with a high expected adverse move (stale leg / volatile
 *      market), is rejected specifically as 'latency_risk' — not as a generic
 *      below_threshold/negative_net.
 *   3. The volatility estimator reacts to observed price moves and uses √time
 *      scaling for the expected move.
 *   4. The detector computes a larger exposure (and move) for a staler leg.
 */
import assert from 'assert';
import { evaluateOpportunity } from '../src/engine/profitability';
import { detectOpportunities } from '../src/engine/detector';
import { VolatilityEstimator } from '../src/engine/latency';
import type { OrderBook, ExchangeFees } from '../src/domain/types';
import type { TradingConfig } from '../src/domain/config';

const flatFee: ExchangeFees = { taker: 0.001, maker: 0.001, withdrawalBTC: 0, label: 'x' };

function cfg(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    symbol: 'BTC/USDT', exchanges: ['a', 'b'],
    minNetProfitPct: 0.0001, minNetProfitAbs: 1, maxTradeSizeBTC: 5,
    requiresWithdrawal: false, slippageBufferPct: 0, latencyPenaltyPct: 0,
    maxQuoteAgeMs: 60_000, executionLatencyMs: 150, volatilityPctPerSec: 0.0006,
    latencyRiskZ: 2.0, pollIntervalMs: 1000, orderBookDepth: 20, executionCooldownMs: 0,
    ...overrides,
  };
}

// A clean ~0.3% gross edge: buy at 70000, sell at 70200, deep liquidity.
function books(ageMs = 0): { buy: OrderBook; sell: OrderBook } {
  const t = Date.now() - ageMs;
  return {
    buy: { exchange: 'a', symbol: 'BTC/USDT', timestamp: t, bids: [[69990, 5]], asks: [[70000, 5], [70010, 5]] } as unknown as OrderBook,
    sell: { exchange: 'b', symbol: 'BTC/USDT', timestamp: t, bids: [[70200, 5], [70190, 5]], asks: [[70210, 5]] } as unknown as OrderBook,
  };
}
// normalize the [price,amount] tuples above into PriceLevel objects
function fix(b: OrderBook): OrderBook {
  const m = (lv: unknown) => (Array.isArray(lv) ? { price: lv[0], amount: lv[1] } : lv);
  return { ...b, bids: (b.bids as unknown[]).map(m) as OrderBook['bids'], asks: (b.asks as unknown[]).map(m) as OrderBook['asks'] };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}: ${(e as Error).message}`); process.exitCode = 1; }
}

console.log('Latency-risk model tests:');

check('low adverse move -> edge stays executable', () => {
  const { buy, sell } = books(0);
  const opp = evaluateOpportunity(fix(buy), fix(sell), { buyFees: flatFee, sellFees: flatFee, config: cfg(), expectedAdverseMovePct: 0.00001 });
  assert.ok(opp.executable, 'tiny adverse move should not kill a 0.3% edge');
  assert.ok((opp.latencyRiskCost ?? 0) >= 0);
  assert.ok((opp.latencyAdjustedNet ?? 0) <= opp.netProfit, 'adjusted net <= raw net');
});

check('high adverse move -> rejected as latency_risk (ghost)', () => {
  const { buy, sell } = books(0);
  // A 0.5% expected adverse move dwarfs a ~0.1% net edge -> ghost.
  const opp = evaluateOpportunity(fix(buy), fix(sell), { buyFees: flatFee, sellFees: flatFee, config: cfg(), expectedAdverseMovePct: 0.005 });
  assert.strictEqual(opp.executable, false);
  assert.strictEqual(opp.rejectReason, 'latency_risk', 'must be tagged as a latency ghost, not negative_net');
  assert.ok((opp.latencyRiskCost ?? 0) > opp.netProfit, 'risk cost should exceed the raw net');
});

check('no adverse move provided -> model inert, edge executable', () => {
  const { buy, sell } = books(0);
  const opp = evaluateOpportunity(fix(buy), fix(sell), { buyFees: flatFee, sellFees: flatFee, config: cfg() });
  assert.ok(opp.executable, 'without volatility input the model must not reject');
  assert.strictEqual(opp.latencyRiskCost, 0);
});

check('exposure window = slowest leg age + execution latency', () => {
  const { buy, sell } = books(300); // both legs 300ms old
  const opp = evaluateOpportunity(fix(buy), fix(sell), { buyFees: flatFee, sellFees: flatFee, config: cfg({ executionLatencyMs: 150 }), expectedAdverseMovePct: 0 });
  assert.ok((opp.slowestLegAgeMs ?? 0) >= 290 && (opp.slowestLegAgeMs ?? 0) <= 360, 'slowest leg ~300ms');
  assert.ok((opp.exposureMs ?? 0) >= (opp.slowestLegAgeMs ?? 0) + 140, 'exposure includes exec latency');
});

check('volatility estimator: reacts and scales with sqrt(time)', () => {
  const v = new VolatilityEstimator(0.0006, 0.3, 3);
  assert.strictEqual(v.isLive(), false);
  let t = 1_000_000;
  let p = 70000;
  for (let i = 0; i < 10; i++) { t += 1000; p *= 1 + (i % 2 ? 0.001 : -0.001); v.observe('a', p, t); }
  assert.ok(v.isLive(), 'should be live after enough samples');
  assert.ok(v.pctPerSec() > 0, 'measured a positive volatility');
  const m1 = v.expectedMovePct(1000, 1);
  const m4 = v.expectedMovePct(4000, 1);
  // 4x the time -> 2x the move (sqrt scaling), within rounding.
  assert.ok(Math.abs(m4 / m1 - 2) < 0.05, `sqrt scaling: ratio ${m4 / m1}`);
});

check('detector: staler leg yields larger latency cost', () => {
  const fresh = books(0);
  const stale = books(1500);
  const common = { fees: { a: flatFee, b: flatFee }, config: cfg(), volatilityPctPerSec: 0.001 };
  const oppFresh = detectOpportunities([fix(fresh.buy), fix(fresh.sell)], common).find((o) => o.buyExchange === 'a');
  const oppStale = detectOpportunities([fix(stale.buy), fix(stale.sell)], common).find((o) => o.buyExchange === 'a');
  assert.ok(oppFresh && oppStale);
  assert.ok((oppStale!.latencyRiskCost ?? 0) > (oppFresh!.latencyRiskCost ?? 0), 'stale leg => higher risk cost');
  assert.ok((oppStale!.exposureMs ?? 0) > (oppFresh!.exposureMs ?? 0), 'stale leg => longer exposure');
});

console.log(`\n${passed} latency-risk checks passed.`);
