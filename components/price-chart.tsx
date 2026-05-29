"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

interface PriceChartProps {
  data: Array<{
    time: string;
    binance: number | null;
    coinbase: number | null;
    kraken: number | null;
    okx: number | null;
  }>;
}

const timeFilters = ["1M", "5M", "15M", "1H"];
const series = [
  { key: "binance", label: "Binance", color: "#06b6d4" },
  { key: "coinbase", label: "Coinbase", color: "#0052FF" },
  { key: "kraken", label: "Kraken", color: "#5741D9" },
  { key: "okx", label: "OKX", color: "#111827" },
] as const;

export function PriceChart({ data }: PriceChartProps) {
  const [activeFilter, setActiveFilter] = useState("5M");

  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(7,43,78,0.065)] transition duration-300 hover:shadow-[0_24px_70px_rgba(7,43,78,0.1)] md:p-6">
      <div className="mb-5 flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl font-semibold tracking-[-0.025em] text-slate-950">
            Comparativa BTC entre exchanges
          </h3>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            En vivo
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-cyan-300">
            <option>BTC / USDT</option>
            <option>ETH / USDT</option>
          </select>

          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {timeFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  activeFilter === filter
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-950"
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 transition hover:bg-cyan-50">
            <Maximize2 className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {series.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-sm font-normal text-slate-500">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="h-[330px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-sm text-slate-500">
            Esperando serie de precios viva desde /stream.
          </div>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 12, fontWeight: 400 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 12, fontWeight: 400 }}
              dx={-10}
              domain={["dataMin - 90", "dataMax + 90"]}
              tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
              width={86}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "14px",
                boxShadow: "0 14px 36px rgba(15,23,42,0.12)",
              }}
              labelStyle={{ color: "#0f172a", fontWeight: 600 }}
              itemStyle={{ color: "#64748b", fontWeight: 400 }}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
            />
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                name={item.label}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
