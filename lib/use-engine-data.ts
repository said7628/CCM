"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useEngineData — connects to the backend SSE stream (/stream) and maps the
 * engine's live payload into the exact data shapes the dashboard components
 * already expect (the same shapes lib/mock-data.ts defined). This is the single
 * bridge between the real engine and the UI: no component needs to change.
 *
 * The SSE endpoint is served by src/server/index.ts. In development the Next.js
 * app runs on :3000 and the engine server on :8080, so we point at
 * NEXT_PUBLIC_ENGINE_URL (defaults to same-origin /stream for production behind
 * one reverse proxy).
 */

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const STATUS_LABEL: Record<string, string> = {
  negative_net: "Fees exceeded spread",
  below_threshold: "Below threshold",
  no_liquidity: "No liquidity",
  stale_data: "Stale data",
  insufficient_balance: "Insufficient balance",
  circuit_breaker: "Risk halt",
};

const EX_COLOR: Record<string, string> = {
  Binance: "#F0B90B",
  Coinbase: "#0052FF",
  Kraken: "#5741D9",
  Bybit: "#F7A600",
  OKX: "#111827",
};

export interface EngineData {
  connected: boolean;
  kpis: ReturnType<typeof emptyKpis>;
  exchangePrices: Array<{ exchange: string; price: number; spread: number; bid: number; ask: number; status: string }>;
  priceData: Array<{ time: string; binance: number; coinbase: number; kraken: number; okx: number }>;
  opportunities: Array<{ id: number; buyExchange: string; sellExchange: string; spread: number; volume: number; profit: number; status: string }>;
  operations: Array<{ id: number; time: string; buyExchange: string; sellExchange: string; pair: string; volume: number; fee: number; slippage: number; pnl: number; status: string }>;
  balances: Array<{ name: string; value: number; percent: number; color: string }>;
  riskMetrics: ReturnType<typeof emptyRisk>;
  costBreakdown: { grossProfit: number; tradingFees: number; slippage: number; latencyPenalty: number; netProfit: number };
  systemHealth: { uptime: number; connectivity: string; marketFeeds: string; execution: string; database: string; lastCheck: number };
  triangular: { enabled: boolean; exchange?: string; path?: string; netPct?: number; loops?: number; pnl?: number; bestPct?: number; executable?: boolean };
  paused: boolean;
}

function emptyKpis() {
  return {
    exchangesConnected: 0,
    opportunitiesDetected: 0,
    operationsExecuted: 0,
    pnl: 0,
    pnlPercent: 0,
    portfolioValue: 0,
    trades: 0,
    bestTrade: 0,
    riskStatus: "Bajo",
    capitalAllocated: 0,
    capitalUsage: 0,
  };
}
function emptyRisk() {
  return {
    averageLatency: 0,
    currentLatency: 0,
    slippage: 0,
    circuitBreaker: "Armado",
    rejectedOpportunities: 0,
    netExposure: 0,
    marginUsage: 0,
    riskStatus: "Bajo",
  };
}

function initialData(): EngineData {
  return {
    connected: false,
    kpis: emptyKpis(),
    exchangePrices: [],
    priceData: [],
    opportunities: [],
    operations: [],
    balances: [],
    riskMetrics: emptyRisk(),
    costBreakdown: { grossProfit: 0, tradingFees: 0, slippage: 0, latencyPenalty: 0, netProfit: 0 },
    systemHealth: { uptime: 100, connectivity: "Óptima", marketFeeds: "Óptimos", execution: "Óptima", database: "Óptima", lastCheck: 0 },
    triangular: { enabled: false },
    paused: false,
  };
}

export function useEngineData(): EngineData {
  const [data, setData] = useState<EngineData>(initialData);
  const priceSeriesRef = useRef<Array<{ time: string; binance: number; coinbase: number; kraken: number; okx: number }>>([]);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_ENGINE_URL ?? "";
    const es = new EventSource(`${base}/stream`);

    es.onopen = () => setData((d) => ({ ...d, connected: true }));
    es.onerror = () => setData((d) => ({ ...d, connected: false }));

    es.onmessage = (e) => {
      let s: Record<string, any>;
      try {
        s = JSON.parse(e.data);
      } catch {
        return;
      }

      const books: Array<any> = s.books ?? [];
      const stats = s.stats ?? {};
      const riskState = s.risk ?? {};
      const wallets: Array<any> = s.wallets ?? [];
      const markPrice: number = s.markPrice ?? 0;

      // --- Exchange prices (bid/ask/spread per venue) ---
      const exchangePrices = books.map((b) => {
        const bid = b.bestBid ?? 0;
        const ask = b.bestAsk ?? 0;
        const mid = bid && ask ? (bid + ask) / 2 : ask || bid;
        const spreadPct = mid ? ((ask - bid) / mid) * 100 : 0;
        return {
          exchange: cap(b.exchange),
          price: mid,
          spread: Number(spreadPct.toFixed(2)),
          bid,
          ask,
          status: "Live",
        };
      });

      // --- Comparative price chart (rolling window of per-exchange mids) ---
      const point: { time: string; binance: number; coinbase: number; kraken: number; okx: number } = {
        time: new Date(s.ts ?? Date.now()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        binance: 0, coinbase: 0, kraken: 0, okx: 0,
      };
      for (const b of books) {
        const mid = b.bestBid && b.bestAsk ? (b.bestBid + b.bestAsk) / 2 : b.bestAsk || b.bestBid;
        if (b.exchange in point) (point as Record<string, number | string>)[b.exchange] = Math.round(mid * 100) / 100;
      }
      // Carry forward the previous value for venues absent this tick so lines stay continuous.
      const prevPoint = priceSeriesRef.current[priceSeriesRef.current.length - 1];
      if (prevPoint) {
        for (const k of ["binance", "coinbase", "kraken", "okx"] as const) {
          if (point[k] === 0 && typeof prevPoint[k] === "number") point[k] = prevPoint[k];
        }
      }
      const series = [...priceSeriesRef.current, point].slice(-40);
      priceSeriesRef.current = series;

      // --- Opportunities (volume + profit in USD, readable status) ---
      const opportunities = (s.opportunities ?? []).map((o: any, i: number) => ({
        id: i + 1,
        buyExchange: cap(o.buyExchange),
        sellExchange: cap(o.sellExchange),
        spread: Number((o.grossSpreadPct * 100).toFixed(3)),
        volume: Math.round((o.amount ?? 0) * (o.buyPrice ?? markPrice)),
        profit: Number((o.netProfit ?? 0).toFixed(2)),
        status: o.executable ? "Executable" : STATUS_LABEL[o.rejectReason] ?? "Rejected",
      }));

      // --- Recent operations (execution log table) ---
      const operations = (s.trades ?? []).map((t: any, i: number) => ({
        id: i + 1,
        time: new Date(t.ts).toLocaleTimeString("en-GB"),
        buyExchange: cap(t.buyExchange),
        sellExchange: cap(t.sellExchange),
        pair: s.symbol ?? "BTC/USDT",
        volume: Math.round((t.amount ?? 0) * markPrice),
        fee: Number((t.fee ?? 0).toFixed(2)),
        slippage: Number((((t.slippage ?? 0) / Math.max(1, (t.amount ?? 0) * markPrice)) * 100).toFixed(3)),
        pnl: Number((t.netProfit ?? 0).toFixed(2)),
        status: t.status ?? (t.partial ? "PARTIAL" : "FILLED"),
      }));

      // --- Wallet balances (value + % share) ---
      const walletValues = wallets.map((w) => ({ name: cap(w.exchange), value: w.quote + w.base * markPrice }));
      const totalVal = walletValues.reduce((a, w) => a + w.value, 0) || 1;
      const balances = walletValues.map((w) => ({
        name: w.name,
        value: Number(w.value.toFixed(2)),
        percent: Math.round((w.value / totalVal) * 100),
        color: EX_COLOR[w.name] ?? "#64748b",
      }));

      // --- KPIs ---
      const portfolioValue = s.portfolio?.totalValueQuote ?? totalVal;
      const startValue = 700_000; // initial paper capital baseline for % P&L
      const kpis = {
        exchangesConnected: books.length,
        opportunitiesDetected: stats.opportunitiesSeen ?? 0,
        operationsExecuted: stats.tradesExecuted ?? 0,
        pnl: Number((stats.realizedPnl ?? 0).toFixed(2)),
        pnlPercent: Number((((stats.realizedPnl ?? 0) / startValue) * 100).toFixed(3)),
        portfolioValue: Number(portfolioValue.toFixed(2)),
        trades: stats.tradesExecuted ?? 0,
        bestTrade: Number((stats.bestTradePnl ?? 0).toFixed(2)),
        riskStatus: riskState.breakerActive ? "Alto" : "Bajo",
        capitalAllocated: Number(portfolioValue.toFixed(2)),
        capitalUsage: 0,
      };

      // --- Risk metrics ---
      const riskMetrics = {
        averageLatency: Number((s.avgLatencyMs ?? 0).toFixed(1)),
        currentLatency: Number((s.bookAgeMs ?? 0).toFixed(1)),
        slippage: Number(((stats.slippageCost ?? 0) / Math.max(1, stats.grossProfit ?? 1) * 100).toFixed(3)),
        circuitBreaker: riskState.breakerActive ? "Disparado" : "Armado",
        rejectedOpportunities: Math.max(0, (stats.opportunitiesSeen ?? 0) - (stats.tradesExecuted ?? 0)),
        netExposure: Number(Math.abs((s.portfolio?.totalBase ?? 0) * markPrice - portfolioValue / 2).toFixed(2)),
        marginUsage: Number((riskState.drawdown ?? 0).toFixed(2)),
        riskStatus: riskState.breakerActive ? "Alto" : "Bajo",
      };

      const cb = {
        grossProfit: Number((stats.grossProfit ?? 0).toFixed(2)),
        tradingFees: Number((stats.tradingFees ?? 0).toFixed(2)),
        slippage: Number((stats.slippageCost ?? 0).toFixed(2)),
        latencyPenalty: Number((stats.latencyPenalty ?? 0).toFixed(2)),
        netProfit: Number((stats.realizedPnl ?? 0).toFixed(2)),
      };

      const tri = s.triangular ?? { enabled: false };
      const triangular = tri.enabled
        ? {
            enabled: true,
            exchange: cap(tri.exchange ?? ""),
            path: tri.opportunity?.path,
            netPct: tri.opportunity?.netProfitPct,
            executable: tri.opportunity?.executable,
            loops: tri.stats?.trades ?? 0,
            pnl: tri.stats?.realizedPnl ?? 0,
            bestPct: tri.stats?.bestNetPct ?? 0,
          }
        : { enabled: false };

      const systemHealth = {
        uptime: 100,
        connectivity: books.length >= 2 ? "Óptima" : "Degradada",
        marketFeeds: books.length >= 2 ? "Óptimos" : "Parciales",
        execution: riskState.breakerActive ? "Pausada" : "Óptima",
        database: "Óptima",
        lastCheck: Math.round((s.bookAgeMs ?? 0)),
      };

      setData({
        connected: true,
        kpis,
        exchangePrices,
        priceData: series,
        opportunities,
        operations,
        balances,
        riskMetrics,
        costBreakdown: cb,
        systemHealth,
        triangular,
        paused: Boolean(s.paused),
      });
    };

    return () => es.close();
  }, []);

  return data;
}
