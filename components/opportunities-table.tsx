"use client";

import { ArrowRight } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { exchangeConfig } from "@/lib/mock-data";

interface Opportunity {
  id: number;
  buyExchange: string;
  sellExchange: string;
  spread: number;
  volume: number;
  profit: number;
  status: string;
}

interface OpportunitiesTableProps {
  opportunities: Opportunity[];
}

function ExchangeBadge({ exchange }: { exchange: string }) {
  const config = exchangeConfig[exchange] || {
    color: "#666",
    bgColor: "#f0f0f0",
    icon: "?",
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold"
        style={{ backgroundColor: config.bgColor, color: config.color }}
      >
        {config.icon}
      </div>
      <span className="text-sm font-medium text-slate-800">{exchange}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles = status === "Executable"
    ? "bg-emerald-50 text-emerald-600"
    : status === "Rejected"
      ? "bg-rose-50 text-rose-600"
      : "bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles}`}>
      {status}
    </span>
  );
}

export function OpportunitiesTable({ opportunities }: OpportunitiesTableProps) {
  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(7,43,78,0.065)] transition duration-300 hover:shadow-[0_24px_70px_rgba(7,43,78,0.1)] md:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-600">Scanner</p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950">
            Oportunidades detectadas
          </h3>
        </div>
        <button className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-700">
          Ver todas
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="text-left">
              <th className="pb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Comprar en</th>
              <th className="pb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Vender en</th>
              <th className="pb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Spread</th>
              <th className="pb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Volumen</th>
              <th className="pb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Estado</th>
              <th className="pb-3 text-right text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Beneficio est.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {opportunities.map((opp) => (
              <tr key={opp.id} className="transition-colors hover:bg-cyan-50/45">
                <td className="py-3.5"><ExchangeBadge exchange={opp.buyExchange} /></td>
                <td className="py-3.5"><ExchangeBadge exchange={opp.sellExchange} /></td>
                <td className="py-3.5 text-sm font-medium text-slate-800">{opp.spread.toFixed(2)}%</td>
                <td className="py-3.5 text-sm font-normal text-slate-500">{formatNumber(opp.volume)} USDT</td>
                <td className="py-3.5"><StatusPill status={opp.status} /></td>
                <td className="py-3.5 text-right text-sm font-semibold text-cyan-700">{formatCurrency(opp.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
