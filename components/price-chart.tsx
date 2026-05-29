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
    binance: number;
    coinbase: number;
    kraken: number;
  }>;
}

const timeFilters = ["1M", "5M", "15M", "1H"];

export function PriceChart({ data }: PriceChartProps) {
  const [activeFilter, setActiveFilter] = useState("5M");

  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(7,43,78,0.07)] transition duration-300 hover:shadow-[0_24px_80px_rgba(7,43,78,0.11)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-black text-slate-950">
            Precio BTC en tiempo real
          </h3>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            En vivo
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Pair selector */}
          <select className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700">
            <option>BTC / USDT</option>
            <option>ETH / USDT</option>
          </select>

          {/* Time filters */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {timeFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeFilter === filter
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-950"
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Expand button */}
          <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 transition hover:bg-cyan-50">
            <Maximize2 className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#00b8b0]" />
          <span className="text-sm text-slate-500">Binance</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#0052FF]" />
          <span className="text-sm text-slate-500">Coinbase</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#5741D9]" />
          <span className="text-sm text-slate-500">Kraken</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[315px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }}
              dx={-10}
              domain={["dataMin - 100", "dataMax + 100"]}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              labelStyle={{ color: "#0f172a", fontWeight: 800 }}
              itemStyle={{ color: "#64748b" }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
            />
            <Line
              type="monotone"
              dataKey="binance"
              stroke="#00b8b0"
              strokeWidth={2}
              dot={false}
              name="Binance"
            />
            <Line
              type="monotone"
              dataKey="coinbase"
              stroke="#0052FF"
              strokeWidth={2}
              dot={false}
              name="Coinbase"
            />
            <Line
              type="monotone"
              dataKey="kraken"
              stroke="#5741D9"
              strokeWidth={2}
              dot={false}
              name="Kraken"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
