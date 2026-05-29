"use client";

import { ArrowRight } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface Balance {
  name: string;
  value: number;
  percent: number;
  color: string;
}

interface BalancesChartProps {
  balances: Balance[];
}

export function BalancesChart({ balances }: BalancesChartProps) {
  const total = balances.reduce((sum, b) => sum + b.value, 0);

  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      {/* Header */}
      <h3 className="text-lg font-semibold text-foreground mb-6">
        Balances por exchange
      </h3>

      {/* Donut Chart */}
      <div className="relative h-48 mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={balances}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {balances.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-xl font-bold text-foreground">
            ${(total / 1000000).toFixed(2)}M
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-3">
        {balances.map((balance) => (
          <div
            key={balance.name}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: balance.color }}
              />
              <span className="text-sm text-muted-foreground">
                {balance.name}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">
                {formatCurrency(balance.value)}
              </span>
              <span className="text-xs text-muted-foreground w-8 text-right">
                {balance.percent}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer button */}
      <button className="w-full mt-6 flex items-center justify-center gap-2 py-3 rounded-xl bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
        Ver todos los balances
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
