"use client";

import { memo } from "react";
import {
  CheckCircle2,
  GaugeCircle,
  Link2,
  ShieldCheck,
  Wallet2,
  Zap,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { generateSparklineData } from "@/lib/mock-data";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface KPICardsProps {
  data: {
    exchangesConnected: number;
    opportunitiesDetected: number;
    operationsExecuted: number;
    pnl: number;
    pnlPercent: number;
    portfolioValue: number;
    trades: number;
    bestTrade: number;
    riskStatus: string;
    capitalAllocated: number;
    capitalUsage: number;
  };
}

function SecondaryMetric({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="group rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_14px_45px_rgba(7,43,78,0.055)] transition duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_18px_55px_rgba(7,43,78,0.09)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            {label}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-slate-950">
            {value}
          </p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-50 text-cyan-700 transition group-hover:bg-cyan-100">
          {icon}
        </div>
      </div>
      <p className="mt-4 text-sm font-normal text-slate-500">{helper}</p>
    </article>
  );
}

function KPICardsComponent({ data }: KPICardsProps) {
  const pnlSparkline = generateSparklineData(data.pnl, 16, 0.012);

  return (
    <section className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-12">
      <article className="relative overflow-hidden rounded-[1.75rem] border border-cyan-200/70 bg-white p-6 shadow-[0_24px_80px_rgba(8,92,126,0.11)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_90px_rgba(8,92,126,0.15)] md:p-7 xl:col-span-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(34,211,238,0.18),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(238,252,255,0.72))]" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" />
              Net Realized P&amp;L
            </div>
            <p className="mt-5 text-sm font-normal text-slate-500">
              P&amp;L neto realizado · sesión actual
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <h2 className="text-5xl font-bold tracking-[-0.055em] text-slate-950 md:text-6xl">
                {formatCurrency(data.pnl)}
              </h2>
              <span className="mb-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-600">
                {formatPercent(data.pnlPercent)} ↗
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-500 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-3">
                <p className="font-normal">Trades</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{data.trades}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-3">
                <p className="font-normal">Mejor trade</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  {formatCurrency(data.bestTrade)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-3">
                <p className="font-normal">Riesgo</p>
                <p className="mt-1 text-lg font-semibold text-emerald-600">{data.riskStatus}</p>
              </div>
            </div>
          </div>
          <div className="h-28 min-w-[190px] md:h-36 md:w-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pnlSparkline}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#0891b2"
                  strokeWidth={2.5}
                  fill="url(#pnlGradient)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </article>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:col-span-6">
        <SecondaryMetric
          label="Portfolio value"
          value={formatCurrency(data.portfolioValue)}
          helper="Total estimado en wallets conectadas"
          icon={<Wallet2 className="h-5 w-5" />}
        />
        <SecondaryMetric
          label="Opportunities"
          value={data.opportunitiesDetected}
          helper="Detectadas en los últimos 5 minutos"
          icon={<Zap className="h-5 w-5" />}
        />
        <SecondaryMetric
          label="Operaciones"
          value={data.operationsExecuted}
          helper="Ejecuciones completadas en 24 h"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <SecondaryMetric
          label="Capital asignado"
          value={formatCurrency(data.capitalAllocated)}
          helper={`${data.capitalUsage}% de uso de capital`}
          icon={<GaugeCircle className="h-5 w-5" />}
        />
        <SecondaryMetric
          label="Exchanges"
          value={data.exchangesConnected}
          helper="Conectados y sincronizados"
          icon={<Link2 className="h-5 w-5" />}
        />
        <SecondaryMetric
          label="Risk status"
          value={data.riskStatus}
          helper="Circuit breaker armado"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </div>
    </section>
  );
}

export const KPICards = memo(KPICardsComponent);
