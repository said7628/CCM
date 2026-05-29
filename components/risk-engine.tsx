"use client";

import { memo } from "react";
import { Activity, ArrowRight, Gauge, Shield, XCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface RiskMetrics {
  averageLatency: number;
  currentLatency: number;
  slippage: number;
  circuitBreaker: string;
  rejectedOpportunities: number;
  netExposure: number;
  marginUsage: number;
  riskStatus: string;
}

interface RiskEngineProps {
  metrics: RiskMetrics;
}

function MetricCard({
  icon,
  title,
  value,
  status,
  statusColor,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  status: string;
  statusColor: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-cyan-200 hover:bg-white">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-[0.12em]">{title}</span>
      </div>
      <span className="mt-3 block text-2xl font-semibold tracking-[-0.03em] text-slate-950">{value}</span>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
        <span className="text-xs font-normal text-slate-500">{status}</span>
      </div>
    </div>
  );
}

function RiskEngineComponent({ metrics }: RiskEngineProps) {
  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(7,43,78,0.065)] transition duration-300 hover:shadow-[0_24px_70px_rgba(7,43,78,0.1)] md:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-600">Risk engine</p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950">
            Motor de riesgo
          </h3>
        </div>
        <button className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-700">
          Detalles
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Gauge className="h-4 w-4" />}
          title="Latencia promedio"
          value={`${Math.round(metrics.averageLatency)} ms`}
          status="Estable"
          statusColor="bg-emerald-500"
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          title="Latencia actual"
          value={`${metrics.currentLatency.toFixed(1)} ms`}
          status="Stream real"
          statusColor="bg-cyan-500"
        />
        <MetricCard
          icon={<Shield className="h-4 w-4" />}
          title="Circuit breaker"
          value={metrics.circuitBreaker}
          status="Protegido"
          statusColor="bg-emerald-500"
        />
        <MetricCard
          icon={<XCircle className="h-4 w-4" />}
          title="Rechazadas"
          value={String(metrics.rejectedOpportunities)}
          status="Últimas 24 h"
          statusColor="bg-slate-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 md:grid-cols-3">
        <div className="rounded-2xl bg-cyan-50/60 p-4">
          <span className="text-sm font-normal text-slate-500">Slippage</span>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            {metrics.slippage.toFixed(2)}%
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <span className="text-sm font-normal text-slate-500">Exposición neta</span>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            {formatCurrency(metrics.netExposure)}
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-normal text-slate-500">Uso de margen</span>
            <span className="text-sm font-medium text-slate-950">{metrics.marginUsage.toFixed(1)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${metrics.marginUsage}%` }}
            />
          </div>
          <p className="mt-3 text-xs font-medium text-emerald-600">Estado: {metrics.riskStatus}</p>
        </div>
      </div>
    </div>
  );
}

export const RiskEngine = memo(RiskEngineComponent);
