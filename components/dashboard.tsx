"use client";

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
import { useEngineData } from "@/lib/use-engine-data";

export default function Dashboard() {
  const data = useEngineData();

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f8fcff_0%,#eef7fb_45%,#ffffff_100%)] text-slate-950">
      <Sidebar />

      <div className="lg:ml-72">
        <Header connected={data.connected} />

        <main className="mx-auto max-w-[1800px] px-5 py-6 lg:px-8 lg:py-8">
          <HeroSection />
          <KPICards data={data.kpis} />
          <BtcExchangePrices prices={data.exchangePrices} />

          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <PriceChart data={data.priceData} />
            </div>
            <div className="xl:col-span-5">
              <OpportunitiesTable opportunities={data.opportunities} />
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <RecentOperations operations={data.operations} />
            </div>
            <div className="xl:col-span-4">
              <BalancesChart balances={data.balances} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-6">
              <RiskEngine metrics={data.riskMetrics} />
            </div>
            <div className="xl:col-span-3">
              <CostBreakdown data={data.costBreakdown} />
            </div>
            <div className="xl:col-span-3">
              <SystemHealth data={data.systemHealth} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
