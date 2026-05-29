"use client";

import { CheckCircle2, Link2, TrendingUp, Zap } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { generateSparklineData } from "@/lib/mock-data";
import { formatCurrency, formatPercent } from "@/lib/utils";

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
    <article className="group relative overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(7,43,78,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_80px_rgba(7,43,78,0.12)]">
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[4rem] bg-cyan-50/70 transition group-hover:bg-cyan-100/70" />
      <div className="relative flex items-start justify-between gap-4">
        <div className={`grid h-14 w-14 place-items-center rounded-2xl ${iconBg}`}>
          {icon}
        </div>
        {showSparkline && (
          <div className="h-12 w-28">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line type="monotone" dataKey="value" stroke="#14b8a6" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="relative mt-5">
        <p className="max-w-[12rem] text-sm font-semibold leading-5 text-slate-500">{title}</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <span className="text-3xl font-black tracking-[-0.04em] text-slate-950">{value}</span>
          {change !== undefined && (
            <span className="pb-1 text-sm font-black text-emerald-500">{formatPercent(change)} ↗</span>
          )}
        </div>
        {subtitle && <p className="mt-3 text-sm font-bold text-cyan-600">{subtitle}</p>}
      </div>
    </article>
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
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      <KPICard
        title="Exchanges conectados"
        value={data.exchangesConnected}
        subtitle="En línea"
        icon={<Link2 className="h-7 w-7 text-cyan-600" />}
        iconBg="bg-cyan-50"
      />
      <KPICard
        title="Oportunidades detectadas"
        value={data.opportunitiesDetected}
        subtitle="Últimos 5 min"
        icon={<Zap className="h-7 w-7 text-teal-600" />}
        iconBg="bg-teal-50"
      />
      <KPICard
        title="Operaciones ejecutadas"
        value={data.operationsExecuted}
        subtitle="Últimas 24 h"
        icon={<CheckCircle2 className="h-7 w-7 text-blue-600" />}
        iconBg="bg-blue-50"
      />
      <KPICard
        title="P&L neto (24h)"
        value={formatCurrency(data.pnl)}
        subtitle=""
        icon={<TrendingUp className="h-7 w-7 text-violet-600" />}
        iconBg="bg-violet-50"
        change={data.pnlPercent}
        showSparkline
      />
    </div>
  );
}
