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
import { ExchangePrices } from "@/components/exchange-prices";
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
  const [exchangePrices, setExchangePrices] = useState([
    { exchange: "Binance", price: 71856.42, change: 0.24 },
    { exchange: "Coinbase", price: 71892.18, change: 0.31 },
    { exchange: "Kraken", price: 71834.55, change: 0.18 },
    { exchange: "Bybit", price: 71821.30, change: 0.12 },
    { exchange: "OKX", price: 71845.67, change: 0.22 },
  ]);

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

    // Update exchange prices every 2 seconds
    const pricesInterval = setInterval(() => {
      setExchangePrices((prev) =>
        prev.map((ex) => ({
          ...ex,
          price: ex.price + (Math.random() - 0.5) * 20,
          change: Math.max(-2, Math.min(2, ex.change + (Math.random() - 0.5) * 0.1)),
        }))
      );
    }, 2000);

    return () => {
      clearInterval(priceInterval);
      clearInterval(kpiInterval);
      clearInterval(riskInterval);
      clearInterval(healthInterval);
      clearInterval(pricesInterval);
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
          
          {/* Exchange Prices Section */}
          <div className="mb-8">
            <ExchangePrices prices={exchangePrices} />
          </div>
          
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
