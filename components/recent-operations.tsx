"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { exchangeConfig } from "@/lib/mock-data";

interface Operation {
  id: number;
  time: string;
  buyExchange: string;
  sellExchange: string;
  pair: string;
  volume: number;
  pnl: number;
}

interface RecentOperationsProps {
  operations: Operation[];
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
      <span className="text-sm font-medium text-foreground">{exchange}</span>
    </div>
  );
}

export function RecentOperations({ operations }: RecentOperationsProps) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          Operaciones recientes
        </h3>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
          Ver historial
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Hora
              </th>
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Comprar en
              </th>
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Vender en
              </th>
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Par
              </th>
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Volumen
              </th>
              <th className="pb-4 text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">
                {"P&L"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {operations.map((op) => (
              <tr key={op.id} className="hover:bg-muted/50 transition-colors">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm text-muted-foreground">
                      {op.time}
                    </span>
                  </div>
                </td>
                <td className="py-3">
                  <ExchangeBadge exchange={op.buyExchange} />
                </td>
                <td className="py-3">
                  <ExchangeBadge exchange={op.sellExchange} />
                </td>
                <td className="py-3">
                  <span className="text-sm text-muted-foreground">
                    {op.pair}
                  </span>
                </td>
                <td className="py-3">
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(op.volume)}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className="text-sm font-semibold text-emerald-500">
                    {formatCurrency(op.pnl)}
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
