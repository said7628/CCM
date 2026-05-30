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

# LIVE low-latency feed — ALL venues over native WebSocket (no REST polling):
SOURCE=live npm run cli
# pick which venues to stream (all have a native WS connector):
EXCHANGES=binance,kraken,okx,coinbase,bitfinex,kucoin,gate,bitstamp,gemini SOURCE=live npm run cli

# LIVE via ccxt REST polling (legacy fallback, higher latency):
SOURCE=live-rest npm run cli

# Test suite (engine + book logic + WebSocket connector parsing):
npm test
```

### Web dashboard

```bash
npm run server                       # dashboard on http://localhost:8080 (simulated)
SOURCE=live npm run server           # dashboard driven by live WebSocket feeds
EXCHANGES=binance,kraken,okx,coinbase,bitfinex,kucoin,gate,bitstamp,gemini SOURCE=live npm run server
PORT=80 SOURCE=live npm run server   # bind a public port on the server
```

The dashboard streams live state over Server-Sent Events (no extra dependency):
order books with depth bars, per-exchange wallet balances, a cumulative cost
breakdown (gross → fees → slippage → latency → net), the ranked opportunity feed
(rejections show gross vs net so you can see why they were skipped), a full
execution log table (time, buy, sell, volume, fee, slippage, net, status), a
cumulative P&L chart, live data-latency, and a pause/resume control. Open the URL
in a browser.

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
| `exchanges/binance-ws.ts` · `kraken-ws.ts` · `okx-ws.ts` · `coinbase-ws.ts` · `bitfinex-ws.ts` · `kucoin-ws.ts` · `gate-ws.ts` · `bitstamp-ws.ts` · `gemini-ws.ts` | Native WebSocket clients (9 venues) |
| `exchanges/ws-source.ts` | Event-driven WebSocket data source — WS-only, lowest latency |
| `exchanges/live.ts` | ccxt REST polling source (legacy fallback only) |
| `cli/main.ts` | Console dashboard consuming the engine |
| `server/index.ts` | HTTP + SSE server: runs the engine, streams state to the browser |
| `server/public/index.html` | Live web dashboard (terminal aesthetic) |

## Low latency (the design)

- **Event-driven, not clock-driven.** WebSocket clients push an update the
  instant a book changes and the engine evaluates immediately — no waiting for a
  poll interval. Measured data latency in event mode is sub-millisecond; the
  dashboard shows it live (`data latency`).
- **All venues over native WebSocket — no REST polling.** Nine exchanges
  (Binance, Kraken, OKX, Coinbase, Bitfinex, KuCoin, Gate.io, Bitstamp, Gemini)
  each have a dedicated WS connector. `SOURCE=live` is WebSocket-only; a venue
  without a connector is skipped (with a warning) rather than silently falling
  back to slow polling, so the whole feed is genuinely push-based.
- **Incrementally-maintained local books.** We apply diffs to a local book
  (price→size maps) rather than re-fetching, so each update is O(changed levels).
- **Correctness under speed.** Binance diff events are sequence-validated
  (`U`/`u`) with automatic REST resync on any gap; Kraken offers a CRC32 checksum
  we can validate (opt-in) and resync on mismatch. Both are unit-tested. The
  snapshot-style channels (OKX `books5`, Gate `spot.order_book`, KuCoin
  `level2Depth5`, Bitstamp) carry the full top-of-book each push, so there is no
  delta sequencing to desync.
- **Latency-risk filter (ghost-opportunity rejection).** An edge is only real if
  it survives the *exposure window* — the slower leg's book age plus our
  estimated execution latency. We measure BTC volatility live (an EWMA of
  per-second returns) and reject edges whose expected adverse move over that
  window (√time scaling) would eat the net profit. These show up as
  `latency_risk` in the scanner; the Risk view counts how many ghosts were
  filtered. Tunable via `EXECUTION_LATENCY_MS`, `VOLATILITY_PCT_PER_SEC`,
  `LATENCY_RISK_Z`.
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
engine orchestrator, **event-driven WebSocket feed across 9 venues (Binance,
Kraken, OKX, Coinbase, Bitfinex, KuCoin, Gate.io, Bitstamp, Gemini) with
incremental local books, sequence validation and CRC32 integrity**, **dynamic
latency-risk filter with a live volatility estimator (ghost-opportunity
rejection)**, ccxt REST fallback, console dashboard, **live web dashboard over
SSE with cross-session persistence**, 93 passing tests (engine + connectors +
latency-risk).

Next: inventory rebalancing; triangular / statistical arbitrage strategies;
per-venue kill-switch on stale feeds; opportunity time-to-live analytics.

## Deploy (single process)

The whole system is one Node process — ideal for a small VPS:

```bash
npm install
PORT=8080 SOURCE=live npm run server
```

Keep it alive with pm2 or systemd and expose port 8080 (open the firewall, or put
nginx/Caddy in front for TLS + a domain). Example:

```bash
npm i -g pm2
PORT=8080 SOURCE=live pm2 start "npm run server" --name arb && pm2 save
```

## Disclaimer

This is a **simulation** for educational/competition purposes. It places no real
orders and is not financial advice.
