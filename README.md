# BTC Arbitrage Bot

Real-time Bitcoin arbitrage detection with simulated execution. Monitors BTC/USDT
order books across multiple exchanges, finds cross-exchange price divergences,
sizes and executes them **net of fees, slippage and liquidity**, manages
per-exchange wallets with partial fills, and tracks P&L — all behind a clean,
swappable architecture.

## Quick start

```bash
npm install

# Run the bot on a deterministic SIMULATED feed (no network, great for a demo):
npm run cli

# Run against LIVE Binance + Kraken order books (needs internet):
SOURCE=live npm run cli

# Run the test suite (51 assertions on the pure engine logic):
npm test
```

Useful env vars: `TICKS`, `INTERVAL_MS`, `SOURCE=live|sim`, `MIN_NET_PROFIT_PCT`,
`MAX_TRADE_SIZE_BTC`, `POLL_INTERVAL_MS`, `SLIPPAGE_BUFFER_PCT`.

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
| `exchanges/live.ts` | Live ccxt connector (REST polling; WS upgrade path documented) |
| `cli/main.ts` | Console dashboard consuming the engine |

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
engine orchestrator, simulated feed, live ccxt connector (REST), console
dashboard, 51 passing tests.

Next: WebSocket streaming for lower latency; web dashboard (live order books,
opportunity feed, trade log, P&L chart); inventory rebalancing; triangular /
statistical arbitrage strategies; persistence.

## Disclaimer

This is a **simulation** for educational/competition purposes. It places no real
orders and is not financial advice.
