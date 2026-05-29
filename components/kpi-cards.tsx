"use client";

import { Link2, Zap, CheckCircle2, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { generateSparklineData } from "@/lib/mock-data";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  change?: number;
  showSparkline?: boolean;
}

function KPICard({
  title,
  value,
  subtitle,
  icon,
  iconBg,
  change,
  showSparkline,
}: KPICardProps) {
  const sparklineData = showSparkline ? generateSparklineData(12842, 12, 0.01) : [];

  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center`}
        >
          {icon}
        </div>
        {showSparkline && (
          <div className="w-24 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--secondary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-1">{title}</p>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-foreground">{value}</span>
        {change !== undefined && (
          <span className="text-sm font-medium text-secondary">
            {formatPercent(change)}
          </span>
        )}
      </div>
      <p className="text-sm text-secondary mt-2">{subtitle}</p>
    </div>
  );
}

interface KPICardsProps {
  data: {
    exchangesConnected: number;
    opportunitiesDetected: number;
    operationsExecuted: number;
    pnl: number;
    pnlPercent: number;
  };
}

export function KPICards({ data }: KPICardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <KPICard
        title="Exchanges conectados"
        value={data.exchangesConnected}
        subtitle="En linea"
        icon={<Link2 className="w-6 h-6 text-secondary" />}
        iconBg="bg-secondary/10"
      />
      <KPICard
        title="Oportunidades detectadas"
        value={data.opportunitiesDetected}
        subtitle="Ultimos 5 min"
        icon={<Zap className="w-6 h-6 text-amber-500" />}
        iconBg="bg-amber-50"
      />
      <KPICard
        title="Operaciones ejecutadas"
        value={data.operationsExecuted}
        subtitle="Ultimas 24 h"
        icon={<CheckCircle2 className="w-6 h-6 text-emerald-500" />}
        iconBg="bg-emerald-50"
      />
      <KPICard
        title="P&L neto (24h)"
        value={formatCurrency(data.pnl)}
        subtitle=""
        icon={<TrendingUp className="w-6 h-6 text-secondary" />}
        iconBg="bg-secondary/10"
        change={data.pnlPercent}
        showSparkline
      />
    </div>
  );
}
