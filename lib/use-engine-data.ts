"use client";

import { useEffect, useRef, useState } from "react";
import { getExchangeVisualConfig, normalizeExchangeName } from "@/lib/exchange-visuals";

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

const STATUS_LABEL: Record<string, string> = {
  negative_net: "Fees exceeded spread",
  below_threshold: "Below threshold",
  no_liquidity: "No liquidity",
  stale_data: "Stale data",
  insufficient_balance: "Insufficient balance",
  circuit_breaker: "Risk halt",
};

const chartExchangeKey = (exchange?: string): keyof PricePoint | null => {
  const normalized = normalizeExchangeName(exchange).toLowerCase();
  if (["binance", "coinbase", "kraken", "okx"].includes(normalized)) {
    return normalized as keyof PricePoint;
  }
  return null;
};

const safeNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export interface PricePoint { time: string; binance: number | null; coinbase: number | null; kraken: number | null; okx: number | null }

export interface EngineData {
  connected: boolean;
  kpis: ReturnType<typeof emptyKpis>;
  exchangePrices: Array<{ exchange: string; price: number; spread: number; bid: number; ask: number; status: string }>;
  priceData: PricePoint[];
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
  const priceSeriesRef = useRef<PricePoint[]>([]);

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
      const markPrice = safeNumber(s.markPrice);

      // --- Exchange prices (bid/ask/spread per venue) ---
      const exchangePrices = books.map((b) => {
        const bid = safeNumber(b.bestBid);
        const ask = safeNumber(b.bestAsk);
        const mid = bid && ask ? (bid + ask) / 2 : ask || bid;
        const spreadPct = mid ? ((ask - bid) / mid) * 100 : 0;
        return {
          exchange: normalizeExchangeName(b.exchange),
          price: mid,
          spread: Number(spreadPct.toFixed(2)),
          bid,
          ask,
          status: "Live",
        };
      });

      // --- Comparative price chart (rolling window of per-exchange mids) ---
      const point: PricePoint = {
        time: new Date(s.ts ?? Date.now()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        binance: null, coinbase: null, kraken: null, okx: null,
      };
      for (const b of books) {
        const bid = safeNumber(b.bestBid);
        const ask = safeNumber(b.bestAsk);
        const mid = bid && ask ? (bid + ask) / 2 : ask || bid;
        const key = chartExchangeKey(b.exchange);
        if (key && key !== "time") point[key] = Math.round(mid * 100) / 100;
      }
      // Carry forward the previous value for venues absent this tick so lines stay continuous.
      const prevPoint = priceSeriesRef.current[priceSeriesRef.current.length - 1];
      if (prevPoint) {
        for (const k of ["binance", "coinbase", "kraken", "okx"] as const) {
          if (point[k] === null && typeof prevPoint[k] === "number") point[k] = prevPoint[k];
        }
      }
      const series = [...priceSeriesRef.current, point].slice(-40);
      priceSeriesRef.current = series;

      // --- Opportunities (volume + profit in USD, readable status) ---
      const opportunities = (s.opportunities ?? []).map((o: any, i: number) => ({
        id: i + 1,
        buyExchange: normalizeExchangeName(o.buyExchange),
        sellExchange: normalizeExchangeName(o.sellExchange),
        spread: Number((safeNumber(o.grossSpreadPct) * 100).toFixed(3)),
        volume: Math.round(safeNumber(o.amount) * safeNumber(o.buyPrice, markPrice)),
        profit: Number(safeNumber(o.netProfit).toFixed(2)),
        status: o.executable ? "Executable" : STATUS_LABEL[o.rejectReason] ?? "Rejected",
      }));

      // --- Recent operations (execution log table) ---
      const operations = (s.trades ?? []).map((t: any, i: number) => ({
        id: i + 1,
        time: new Date(t.ts ?? Date.now()).toLocaleTimeString("en-GB"),
        buyExchange: normalizeExchangeName(t.buyExchange),
        sellExchange: normalizeExchangeName(t.sellExchange),
        pair: s.symbol ?? "BTC/USDT",
        volume: Math.round(safeNumber(t.amount) * markPrice),
        fee: Number(safeNumber(t.fee).toFixed(2)),
        slippage: Number(((safeNumber(t.slippage) / Math.max(1, safeNumber(t.amount) * markPrice)) * 100).toFixed(3)),
        pnl: Number(safeNumber(t.netProfit).toFixed(2)),
        status: t.status ?? (t.partial ? "PARTIAL" : "FILLED"),
      }));

      // --- Wallet balances (value + % share) ---
      const walletValues = wallets.map((w) => ({
        name: normalizeExchangeName(w.exchange),
        value: safeNumber(w.quote) + safeNumber(w.base) * markPrice,
      }));
      const totalVal = walletValues.reduce((a, w) => a + w.value, 0) || 1;
      const balances = walletValues.map((w) => ({
        name: w.name,
        value: Number(w.value.toFixed(2)),
        percent: Math.round((w.value / totalVal) * 100),
        color: getExchangeVisualConfig(w.name).iconColor,
      }));

      // --- KPIs ---
      const portfolioValue = s.portfolio?.totalValueQuote ?? totalVal;
      const startValue = 700_000; // initial paper capital baseline for % P&L
      const kpis = {
        exchangesConnected: books.length,
        opportunitiesDetected: Math.max(safeNumber(stats.opportunitiesSeen), opportunities.length),
        operationsExecuted: Math.max(safeNumber(stats.tradesExecuted), operations.length),
        pnl: Number(safeNumber(stats.realizedPnl).toFixed(2)),
        pnlPercent: Number(((safeNumber(stats.realizedPnl) / startValue) * 100).toFixed(3)),
        portfolioValue: Number(safeNumber(portfolioValue).toFixed(2)),
        trades: Math.max(safeNumber(stats.tradesExecuted), operations.length),
        bestTrade: Number(safeNumber(stats.bestTradePnl).toFixed(2)),
        riskStatus: riskState.breakerActive ? "Alto" : "Bajo",
        capitalAllocated: Number(safeNumber(portfolioValue).toFixed(2)),
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
            exchange: normalizeExchangeName(tri.exchange),
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
