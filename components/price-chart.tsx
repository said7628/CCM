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
  Legend,
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
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">
            Precio BTC en tiempo real
          </h3>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            En vivo
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Pair selector */}
          <select className="px-3 py-1.5 rounded-lg bg-muted border border-border text-sm font-medium text-foreground">
            <option>BTC / USDT</option>
            <option>ETH / USDT</option>
          </select>

          {/* Time filters */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted">
            {timeFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeFilter === filter
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Expand button */}
          <button className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors">
            <Maximize2 className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#00b8b0]" />
          <span className="text-sm text-muted-foreground">Binance</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#0052FF]" />
          <span className="text-sm text-muted-foreground">Coinbase</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#5741D9]" />
          <span className="text-sm text-muted-foreground">Kraken</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              dx={-10}
              domain={["dataMin - 100", "dataMax + 100"]}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              itemStyle={{ color: "hsl(var(--muted-foreground))" }}
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
