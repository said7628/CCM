/**
 * Tests for the strategy advisor (scoring, recommendation, auto-switch guards).
 */
import assert from 'assert';
import { scoreStrategies, recommend, decideAutoSwitch, type StrategyStat } from '../src/engine/strategies';

let passed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}: ${(e as Error).message}`); process.exitCode = 1; }
}

const cross = (o: Partial<StrategyStat> = {}): StrategyStat => ({ id: 'cross', label: 'Cross-Exchange', realizedPnl: 0, trades: 0, opportunitiesSeen: 0, bestNetPct: 0, ...o });
const tri = (o: Partial<StrategyStat> = {}): StrategyStat => ({ id: 'triangular', label: 'Triangular', realizedPnl: 0, trades: 0, opportunitiesSeen: 0, bestNetPct: 0, ...o });

console.log('Strategy advisor tests:');

check('higher P&L per trade scores higher', () => {
  const scores = scoreStrategies([cross({ realizedPnl: 100, trades: 10 }), tri({ realizedPnl: 100, trades: 2 })]);
  assert.strictEqual(scores[0].id, 'triangular', 'triangular has better P&L/trade');
  assert.ok(scores[0].pnlPerTrade > scores[1].pnlPerTrade);
});

check('recommend explains a traded leader', () => {
  const r = recommend([cross({ realizedPnl: 50, trades: 5 }), tri({ realizedPnl: 0, trades: 0 })]);
  assert.strictEqual(r.bestId, 'cross');
  assert.ok(/por trade/.test(r.reason));
});

check('recommend falls back to best margin when no trades', () => {
  const r = recommend([cross({ opportunitiesSeen: 3, bestNetPct: 0.001 }), tri({ opportunitiesSeen: 3, bestNetPct: 0.004 })]);
  assert.strictEqual(r.bestId, 'triangular', 'triangular shows the fatter edge');
  assert.ok(/margen/.test(r.reason));
});

check('no signal -> default, gentle reason', () => {
  const r = recommend([cross(), tri()]);
  assert.strictEqual(r.bestId, 'cross');
  assert.ok(/señal|defecto/i.test(r.reason));
});

check('auto-switch respects cooldown', () => {
  const stats = [cross({ realizedPnl: 0, trades: 1 }), tri({ realizedPnl: 500, trades: 2 })];
  const now = 100_000;
  const d = decideAutoSwitch(stats, 'cross', now - 5_000, now, { cooldownMs: 20_000 });
  assert.strictEqual(d.switchTo, null, 'inside cooldown -> no switch');
});

check('auto-switch fires when clearly better past cooldown', () => {
  const stats = [cross({ realizedPnl: 1, trades: 1 }), tri({ realizedPnl: 500, trades: 3 })];
  const now = 100_000;
  const d = decideAutoSwitch(stats, 'cross', now - 60_000, now, { cooldownMs: 20_000, marginPct: 0.25 });
  assert.strictEqual(d.switchTo, 'triangular');
  assert.ok(d.reason.length > 0);
});

check('auto-switch does NOT fire on marginal/no-signal difference', () => {
  const stats = [cross({ realizedPnl: 10, trades: 1 }), tri({ realizedPnl: 11, trades: 0, opportunitiesSeen: 1 })];
  const now = 100_000;
  const d = decideAutoSwitch(stats, 'cross', 0, now, { cooldownMs: 1000, marginPct: 0.25 });
  assert.strictEqual(d.switchTo, null, 'candidate has no real signal / not clearly better');
});

check('auto-switch no-op when already on best', () => {
  const stats = [cross({ realizedPnl: 500, trades: 3 }), tri({ realizedPnl: 1, trades: 1 })];
  const d = decideAutoSwitch(stats, 'cross', 0, 100_000, { cooldownMs: 1000 });
  assert.strictEqual(d.switchTo, null);
});

console.log(`\n${passed} strategy advisor checks passed.`);
