/**
 * Strategy advisor — scores the available arbitrage strategies on recent
 * performance, recommends the best one, and (in auto mode) decides when to
 * switch, emitting an event the UI surfaces as an alert.
 *
 * Why this matters: cross-exchange and triangular arbitrage shine in different
 * regimes. Cross-exchange needs price dislocation between venues; triangular
 * needs a single venue's three pairs to drift out of parity. A real desk runs
 * whichever is paying right now. This advisor makes that call explicit and, if
 * the user opts in, automatic — with a cooldown and a margin threshold so it
 * doesn't flip-flop on noise.
 *
 * Pure and deterministic given its inputs; the scoring is unit-tested.
 */

export interface StrategyStat {
  id: string;
  label: string;
  /** Realized P&L attributed to this strategy this session (quote ccy). */
  realizedPnl: number;
  /** Trades executed by this strategy. */
  trades: number;
  /** Opportunities this strategy has seen (proxy for how "live" the regime is). */
  opportunitiesSeen: number;
  /** Best net % edge this strategy has seen (regime quality signal). */
  bestNetPct: number;
}

export interface StrategyScore extends StrategyStat {
  /** Composite score: realized P&L per trade, nudged by regime quality. */
  score: number;
  /** Avg P&L per executed trade (0 if none yet). */
  pnlPerTrade: number;
}

export interface Recommendation {
  /** Best strategy id by score, or null when there isn't enough signal. */
  bestId: string | null;
  scores: StrategyScore[];
  /** Human-readable rationale for the UI. */
  reason: string;
}

/** Score each strategy. Higher is better. */
export function scoreStrategies(stats: StrategyStat[]): StrategyScore[] {
  return stats
    .map((s) => {
      const pnlPerTrade = s.trades > 0 ? s.realizedPnl / s.trades : 0;
      // Composite: realized efficiency (P&L per trade) is the backbone; we add a
      // small regime-quality term (best edge seen) so a strategy that is clearly
      // finding fat edges but hasn't traded yet isn't scored as dead zero.
      const regimeTerm = s.bestNetPct * 1000; // bestNetPct is a fraction (e.g. 0.002)
      const score = pnlPerTrade + regimeTerm + s.realizedPnl * 0.0001;
      return { ...s, pnlPerTrade, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Recommend the best strategy, with a readable reason. */
export function recommend(stats: StrategyStat[]): Recommendation {
  const scores = scoreStrategies(stats);
  if (!scores.length) return { bestId: null, scores, reason: 'Sin estrategias disponibles.' };

  const top = scores[0];
  const anySignal = scores.some((s) => s.trades > 0 || s.opportunitiesSeen > 0);
  if (!anySignal) {
    return { bestId: top.id, scores, reason: 'Aún sin señal; mostrando estrategia por defecto.' };
  }
  if (top.trades > 0) {
    return {
      bestId: top.id,
      scores,
      reason: `${top.label} rinde ${top.pnlPerTrade >= 0 ? '+' : ''}${top.pnlPerTrade.toFixed(2)} por trade en ${top.trades} operación(es).`,
    };
  }
  return {
    bestId: top.id,
    scores,
    reason: `${top.label} muestra el mejor margen disponible (${(top.bestNetPct * 100).toFixed(3)}%).`,
  };
}

export interface AutoSwitchDecision {
  switchTo: string | null;
  reason: string;
}

/**
 * Decide whether auto mode should switch strategies right now.
 *
 * Guards against flip-flopping:
 *  - cooldown: don't switch more often than `cooldownMs`.
 *  - margin: the candidate must beat the current strategy's score by a clear
 *    relative margin (default 25%), and the candidate must have real signal.
 */
export function decideAutoSwitch(
  stats: StrategyStat[],
  currentId: string,
  lastSwitchAt: number,
  now: number,
  opts: { cooldownMs?: number; marginPct?: number } = {},
): AutoSwitchDecision {
  const cooldownMs = opts.cooldownMs ?? 20_000;
  const marginPct = opts.marginPct ?? 0.25;
  const scores = scoreStrategies(stats);
  if (scores.length < 2) return { switchTo: null, reason: '' };
  if (now - lastSwitchAt < cooldownMs) return { switchTo: null, reason: '' };

  const best = scores[0];
  if (best.id === currentId) return { switchTo: null, reason: '' };

  const current = scores.find((s) => s.id === currentId);
  const currentScore = current?.score ?? 0;
  // candidate must have traded or be seeing live opportunities, and clearly win
  const hasSignal = best.trades > 0 || best.opportunitiesSeen > 5;
  const clearlyBetter = best.score > 0 && best.score > currentScore * (1 + marginPct) + 1e-9;
  if (hasSignal && clearlyBetter) {
    return {
      switchTo: best.id,
      reason: `${best.label} supera a ${current?.label ?? currentId} (${best.pnlPerTrade.toFixed(2)} vs ${(current?.pnlPerTrade ?? 0).toFixed(2)} por trade).`,
    };
  }
  return { switchTo: null, reason: '' };
}
