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
        className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: config.bgColor, color: config.color }}
      >
        {config.icon}
      </div>
      <span className="text-sm font-medium text-slate-950">{exchange}</span>
    </div>
  );
}

export function OpportunitiesTable({ opportunities }: OpportunitiesTableProps) {
  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(7,43,78,0.07)] transition duration-300 hover:shadow-[0_24px_80px_rgba(7,43,78,0.11)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-black text-slate-950">
          Oportunidades detectadas
        </h3>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 text-sm font-bold text-slate-700 hover:bg-cyan-50 hover:text-cyan-700 transition-colors">
          Ver todas
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="pb-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
                Comprar en
              </th>
              <th className="pb-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
                Vender en
              </th>
              <th className="pb-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
                Spread
              </th>
              <th className="pb-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
                Volumen (USDT)
              </th>
              <th className="pb-4 text-xs font-medium text-slate-500 uppercase tracking-wider text-right">
                Beneficio est.
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {opportunities.map((opp) => (
              <tr
                key={opp.id}
                className="hover:bg-cyan-50/50 transition-colors"
              >
                <td className="py-4">
                  <ExchangeBadge exchange={opp.buyExchange} />
                </td>
                <td className="py-4">
                  <ExchangeBadge exchange={opp.sellExchange} />
                </td>
                <td className="py-4">
                  <span className="text-sm font-medium text-slate-950">
                    {opp.spread.toFixed(2)}%
                  </span>
                </td>
                <td className="py-4">
                  <span className="text-sm text-slate-500">
                    {formatNumber(opp.volume)}
                  </span>
                </td>
                <td className="py-4 text-right">
                  <span className="text-sm font-semibold text-cyan-600">
                    {formatCurrency(opp.profit)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
