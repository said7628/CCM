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
    <div className="flex flex-col gap-2 p-4 rounded-xl bg-muted/50">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      <span className="text-xl font-bold text-foreground">{value}</span>
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
    </div>
  );
}

export function RiskEngine({ metrics }: RiskEngineProps) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          Motor de riesgo
        </h3>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
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
          status="Ultimas 24h"
          statusColor="bg-muted-foreground"
        />
      </div>

      {/* Bottom metrics */}
      <div className="flex flex-col lg:flex-row gap-6 pt-4 border-t border-border">
        <div className="flex-1">
          <span className="text-sm text-muted-foreground">Exposicion neta</span>
          <p className="text-2xl font-bold text-foreground mt-1">
            {formatCurrency(metrics.netExposure)}
          </p>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Uso de margen</span>
            <span className="text-sm font-semibold text-foreground">
              {metrics.marginUsage}%
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-secondary to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${metrics.marginUsage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
