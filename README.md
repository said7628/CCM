# BTC Arbitrage Bot

Real-time Bitcoin arbitrage detection with simulated execution. Monitors BTC/USDT
order books across multiple exchanges, finds cross-exchange price divergences,
sizes and executes them **net of fees, slippage and liquidity**, manages
per-exchange wallets with partial fills, and tracks P&L — all behind a clean,
swappable architecture.

## Quick start

```bash
npm install

# Deterministic SIMULATED feed (no network, great for a demo):
npm run cli                      # stepped
SOURCE=sim-stream npm run cli    # event-driven (same path as live WS)

# LIVE low-latency feed — Binance + Kraken over WebSocket:
SOURCE=live npm run cli

# LIVE via ccxt REST polling (fallback, higher latency):
SOURCE=live-rest npm run cli

# Test suite (65 assertions on the pure engine + book logic):
npm test
```

Useful env vars: `SOURCE`, `TICKS`, `INTERVAL_MS`, `KRAKEN_CHECKSUM=1`,
`MIN_NET_PROFIT_PCT`, `MAX_TRADE_SIZE_BTC`, `POLL_INTERVAL_MS`, `SLIPPAGE_BUFFER_PCT`.

## Architecture

The guiding decision is a hard separation between a **pure engine** and its
**consumers**. The engine has zero I/O and zero external dependencies, so it is
fully unit-testable and identical whether driven by the console, the web app, a
simulated feed, or live exchanges.

```
            ┌─────────────────────────────────────────────┐
            │                  ENGINE (pure)               │
 books ───► │  detector → profitability → executor         │ ───► TickResult
            │      ↑            ↑             ↑             │      (opps, trade,
            │   orderbook    config        wallet · risk    │       P&L, risk)
            └─────────────────────────────────────────────┘
                 ▲                                   │
   MarketDataSource (interface)              consumers: CLI · Web
   ├── SimulatedSource (deterministic)
   └── LiveSource (ccxt: Binance, Kraken)
```

### Modules

| File | Responsibility |
|------|----------------|
| `domain/types.ts` | Core data structures (OrderBook, Opportunity, Trade, Wallet…) |
| `domain/config.ts` | Exchange fees + trading/risk parameters (env-overridable) |
| `engine/orderbook.ts` | Walks the book for a real **VWAP** instead of trusting top-of-book |
| `engine/profitability.ts` | **Profit-maximizing position sizing** + honest net P&L |
| `engine/detector.ts` | Scans all exchange pairs both directions, **ranks by net profit** |
| `engine/executor.ts` | Simulated execution with **balance-clamped partial fills** |
| `engine/wallet.ts` | Per-exchange balances, trade application, mark-to-market P&L |
| `engine/risk.ts` | **Circuit breaker** on consecutive losses / drawdown + cooldown |
| `engine/engine.ts` | Orchestrates one full decision cycle per `tick()` |
| `exchanges/source.ts` | `MarketDataSource` interface + deterministic simulator |
| `exchanges/localbook.ts` | Incremental local order book + CRC32 (integrity) |
| `exchanges/binance-sync.ts` | Binance diff-stream sequence validation (resync on gap) |
| `exchanges/binance-ws.ts` · `kraken-ws.ts` | Live WebSocket clients |
| `exchanges/ws-source.ts` | Event-driven WebSocket data source (lowest latency) |
| `exchanges/live.ts` | ccxt REST polling source (fallback) |
| `cli/main.ts` | Console dashboard consuming the engine |

## Low latency (the design)

- **Event-driven, not clock-driven.** WebSocket clients push an update the
  instant a book changes and the engine evaluates immediately — no waiting for a
  poll interval. Measured data latency in event mode is sub-millisecond; the
  dashboard shows it live (`data latency`).
- **Incrementally-maintained local books.** We apply diffs to a local book
  (price→size maps) rather than re-fetching, so each update is O(changed levels).
- **Correctness under speed.** Binance diff events are sequence-validated
  (`U`/`u`) with automatic REST resync on any gap; Kraken offers a CRC32 checksum
  we can validate (opt-in) and resync on mismatch. Both are unit-tested.
- **Execution cooldown.** A standing edge fires once, not on every tick, so the
  bot doesn't over-trade a single divergence at WebSocket speed.

## Key design decisions

- **Honest profitability, not gross spreads.** A raw `ask < bid` edge is sized
  per-unit. We walk both books slice-by-slice and accumulate volume *only while
  the marginal slice clears fees*, which both maximizes profit and naturally
  handles thin liquidity. Net P&L includes per-exchange taker fees, an optional
  withdrawal cost, and a latency/slippage safety buffer.

- **Decision buffer vs realized P&L are separated.** The slippage buffer gates
  *which* opportunities we take (conservative); realized P&L reflects actual
  fills. So realized ≥ expected when the market doesn't move against us, and the
  buffer protects us when it does.

- **Balanced inventory model.** Capital is pre-funded on both venues, so a buy on
  A and a sell on B happen simultaneously without an on-chain transfer per trade.
  Each arb is BTC-neutral; profit accrues in USDT. When inventory skews, trades
  get balance-clamped (demonstrated as partial fills) — the production answer is
  periodic rebalancing (see Roadmap).

- **Prioritization.** Every tick ranks all opportunities and works the best edge
  first, rather than grabbing the first spread seen.

## Status & roadmap

Done: domain model, order-book VWAP, detection, net profitability + optimal
sizing, simulated execution + wallets + partial fills, risk/circuit breaker,
engine orchestrator, **event-driven WebSocket feed (Binance + Kraken) with
incremental local books, sequence validation and CRC32 integrity**, ccxt REST
fallback, console dashboard with live latency, 65 passing tests.

Next: web dashboard (live order books, opportunity feed, trade log, P&L chart) +
deploy; inventory rebalancing; triangular / statistical arbitrage strategies;
persistence.

## Disclaimer

This is a **simulation** for educational/competition purposes. It places no real
orders and is not financial advice.
