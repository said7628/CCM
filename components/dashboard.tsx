"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { HeroSection } from "@/components/hero-section";
import { KPICards } from "@/components/kpi-cards";
import { PriceChart } from "@/components/price-chart";
import { OpportunitiesTable } from "@/components/opportunities-table";
import { BalancesChart } from "@/components/balances-chart";
import { RecentOperations } from "@/components/recent-operations";
import { RiskEngine } from "@/components/risk-engine";
import { SystemHealth } from "@/components/system-health";
import {
  generatePriceData,
  initialKPIs,
  mockOpportunities,
  mockBalances,
  mockOperations,
  mockRiskMetrics,
  mockSystemHealth,
} from "@/lib/mock-data";

export default function Dashboard() {
  // State for live data
  const [kpis, setKpis] = useState(initialKPIs);
  const [priceData, setPriceData] = useState(() => generatePriceData(71800, 30));
  const [riskMetrics, setRiskMetrics] = useState(mockRiskMetrics);
  const [systemHealth, setSystemHealth] = useState(mockSystemHealth);

  // Simulate live updates
  useEffect(() => {
    // Update price data every 3 seconds
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
          binance:
            lastPrice.binance + (Math.random() - 0.5) * 30,
          coinbase:
            lastPrice.coinbase + (Math.random() - 0.5) * 30,
          kraken:
            lastPrice.kraken + (Math.random() - 0.5) * 30,
        });

        return newData;
      });
    }, 3000);

    // Update KPIs every 5 seconds
    const kpiInterval = setInterval(() => {
      setKpis((prev) => ({
        ...prev,
        opportunitiesDetected: prev.opportunitiesDetected + Math.floor(Math.random() * 3),
        operationsExecuted: prev.operationsExecuted + (Math.random() > 0.7 ? 1 : 0),
        pnl: prev.pnl + (Math.random() - 0.3) * 100,
        pnlPercent: prev.pnlPercent + (Math.random() - 0.4) * 0.05,
      }));
    }, 5000);

    // Update risk metrics every 4 seconds
    const riskInterval = setInterval(() => {
      setRiskMetrics((prev) => ({
        ...prev,
        latency: Math.max(15, Math.min(35, prev.latency + (Math.random() - 0.5) * 4)),
        slippage: Math.max(0.01, Math.min(0.1, prev.slippage + (Math.random() - 0.5) * 0.01)),
      }));
    }, 4000);

    // Update system health check timer
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
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <div className="ml-64">
        <Header />
        
        <main className="p-8">
          <HeroSection />
          
          <KPICards data={kpis} />
          
          {/* Middle section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2">
              <PriceChart data={priceData} />
            </div>
            <div>
              <OpportunitiesTable opportunities={mockOpportunities} />
            </div>
          </div>
          
          {/* Balances section */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
            <div className="lg:col-span-3">
              <RecentOperations operations={mockOperations} />
            </div>
            <div>
              <BalancesChart balances={mockBalances} />
            </div>
          </div>
          
          {/* Bottom section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <RiskEngine metrics={riskMetrics} />
            </div>
            <div>
              <SystemHealth data={systemHealth} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
