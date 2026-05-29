"use client";

import { formatCurrency } from "@/lib/utils";

interface CostBreakdownProps {
  data: {
    grossProfit: number;
    tradingFees: number;
    slippage: number;
    latencyPenalty: number;
    netProfit: number;
  };
}

export function CostBreakdown({ data }: CostBreakdownProps) {
  const costs = [
    { label: "Trading fees", value: data.tradingFees },
    { label: "Slippage", value: data.slippage },
    { label: "Latency penalty", value: data.latencyPenalty },
  ];
  const totalCosts = costs.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(7,43,78,0.065)] transition duration-300 hover:shadow-[0_24px_70px_rgba(7,43,78,0.1)] md:p-6">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-600">Economics</p>
      <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950">
        Cost breakdown
      </h3>

      <div className="mt-6 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-normal text-slate-500">Gross profit</span>
          <span className="font-semibold text-slate-950">{formatCurrency(data.grossProfit)}</span>
        </div>
        <div className="mt-4 space-y-3">
          {costs.map((item) => (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-normal text-slate-500">{item.label}</span>
                <span className="font-medium text-rose-600">-{formatCurrency(item.value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-cyan-400/80"
                  style={{ width: `${Math.max((item.value / totalCosts) * 100, 8)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-normal text-emerald-700">Net profit</p>
            <p className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-emerald-700">
              {formatCurrency(data.netProfit)}
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700">
            After costs
          </span>
        </div>
      </div>
    </div>
  );
}
