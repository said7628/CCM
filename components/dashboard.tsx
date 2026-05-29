"use client";

import { useEffect, useState } from "react";
import { BalancesChart } from "@/components/balances-chart";
import { BtcExchangePrices } from "@/components/btc-exchange-prices";
import { CostBreakdown } from "@/components/cost-breakdown";
import { Header } from "@/components/header";
import { HeroSection } from "@/components/hero-section";
import { KPICards } from "@/components/kpi-cards";
import { OpportunitiesTable } from "@/components/opportunities-table";
import { PriceChart } from "@/components/price-chart";
import { RecentOperations } from "@/components/recent-operations";
import { RiskEngine } from "@/components/risk-engine";
import { Sidebar } from "@/components/sidebar";
import { SystemHealth } from "@/components/system-health";
import {
  generatePriceData,
  initialKPIs,
  mockBalances,
  mockCostBreakdown,
  mockExchangePrices,
  mockOperations,
  mockOpportunities,
  mockRiskMetrics,
  mockSystemHealth,
} from "@/lib/mock-data";

export default function Dashboard() {
  const [kpis, setKpis] = useState(initialKPIs);
  const [priceData, setPriceData] = useState(() => generatePriceData(71800, 30));
  const [riskMetrics, setRiskMetrics] = useState(mockRiskMetrics);
  const [systemHealth, setSystemHealth] = useState(mockSystemHealth);

  useEffect(() => {
    const priceInterval = setInterval(() => {
      setPriceData((prev) => {
        const newData = [...prev.slice(1)];
        const lastPrice = prev[prev.length - 1];
        const time = new Date();

        newData.push({
          time: time.toLocaleTimeString("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          binance: lastPrice.binance + (Math.random() - 0.46) * 26,
          coinbase: lastPrice.coinbase + (Math.random() - 0.5) * 28,
          kraken: lastPrice.kraken + (Math.random() - 0.48) * 24,
          okx: lastPrice.okx + (Math.random() - 0.5) * 22,
        });

        return newData;
      });
    }, 3000);

    const kpiInterval = setInterval(() => {
      setKpis((prev) => ({
        ...prev,
        opportunitiesDetected: prev.opportunitiesDetected + Math.floor(Math.random() * 3),
        operationsExecuted: prev.operationsExecuted + (Math.random() > 0.72 ? 1 : 0),
        trades: prev.trades + (Math.random() > 0.72 ? 1 : 0),
        pnl: prev.pnl + (Math.random() - 0.28) * 95,
        pnlPercent: prev.pnlPercent + (Math.random() - 0.42) * 0.04,
      }));
    }, 5000);

    const riskInterval = setInterval(() => {
      setRiskMetrics((prev) => ({
        ...prev,
        averageLatency: Math.max(18, Math.min(31, prev.averageLatency + (Math.random() - 0.5) * 2.4)),
        currentLatency: Math.max(1.8, Math.min(8.4, 2.8 + Math.random() * 4.8)),
        slippage: Math.max(0.01, Math.min(0.1, prev.slippage + (Math.random() - 0.5) * 0.01)),
      }));
    }, 1200);

    const healthInterval = setInterval(() => {
      setSystemHealth((prev) => ({
        ...prev,
        lastCheck: (prev.lastCheck % 60) + 1,
      }));
    }, 1000);

    return () => {
      clearInterval(priceInterval);
      clearInterval(kpiInterval);
      clearInterval(riskInterval);
      clearInterval(healthInterval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f8fcff_0%,#eef7fb_45%,#ffffff_100%)] text-slate-950">
      <Sidebar />

      <div className="lg:ml-72">
        <Header />

        <main className="mx-auto max-w-[1800px] px-5 py-6 lg:px-8 lg:py-8">
          <HeroSection />
          <KPICards data={kpis} />
          <BtcExchangePrices prices={mockExchangePrices} />

          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <PriceChart data={priceData} />
            </div>
            <div className="xl:col-span-5">
              <OpportunitiesTable opportunities={mockOpportunities} />
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <RecentOperations operations={mockOperations} />
            </div>
            <div className="xl:col-span-4">
              <BalancesChart balances={mockBalances} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-6">
              <RiskEngine metrics={riskMetrics} />
            </div>
            <div className="xl:col-span-3">
              <CostBreakdown data={mockCostBreakdown} />
            </div>
            <div className="xl:col-span-3">
              <SystemHealth data={systemHealth} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
