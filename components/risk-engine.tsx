"use client";

import { ArrowRight, Gauge, Activity, Shield, XCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface RiskMetrics {
  latency: number;
  slippage: number;
  circuitBreaker: string;
  rejectedOpportunities: number;
  netExposure: number;
  marginUsage: number;
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
    <div className="flex flex-col gap-2 p-4 rounded-xl bg-slate-50">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      <span className="text-xl font-bold text-slate-950">{value}</span>
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
        <span className="text-xs text-slate-500">{status}</span>
      </div>
    </div>
  );
}

export function RiskEngine({ metrics }: RiskEngineProps) {
  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(7,43,78,0.07)] transition duration-300 hover:shadow-[0_24px_80px_rgba(7,43,78,0.11)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-black text-slate-950">
          Motor de riesgo
        </h3>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 text-sm font-bold text-slate-700 hover:bg-cyan-50 hover:text-cyan-700 transition-colors">
          Detalles
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon={<Gauge className="w-4 h-4" />}
          title="Latencia promedio"
          value={`${Math.round(metrics.latency)} ms`}
          status="Excelente"
          statusColor="bg-emerald-500"
        />
        <MetricCard
          icon={<Activity className="w-4 h-4" />}
          title="Deslizamiento"
          value={`${metrics.slippage.toFixed(2)}%`}
          status="Bajo"
          statusColor="bg-amber-500"
        />
        <MetricCard
          icon={<Shield className="w-4 h-4" />}
          title="Circuit breaker"
          value={metrics.circuitBreaker}
          status="Protegido"
          statusColor="bg-emerald-500"
        />
        <MetricCard
          icon={<XCircle className="w-4 h-4" />}
          title="Oportunidades rechazadas"
          value={String(metrics.rejectedOpportunities)}
          status="Últimas 24h"
          statusColor="bg-slate-400"
        />
      </div>

      {/* Bottom metrics */}
      <div className="flex flex-col lg:flex-row gap-6 pt-4 border-t border-slate-200">
        <div className="flex-1">
          <span className="text-sm text-slate-500">Exposición neta</span>
          <p className="text-2xl font-bold text-slate-950 mt-1">
            {formatCurrency(metrics.netExposure)}
          </p>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-500">Uso de margen</span>
            <span className="text-sm font-semibold text-slate-950">
              {metrics.marginUsage}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${metrics.marginUsage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
