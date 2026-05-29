"use client";

import { memo } from "react";
import { Wifi, BarChart2, Zap, Database, CheckCircle2, Gauge } from "lucide-react";

interface SystemHealthData {
  uptime: number;
  connectivity: string;
  marketFeeds: string;
  execution: string;
  database: string;
  lastCheck: number;
  visualLatencyMs: number;
  updatesPerSecond: number;
}

interface SystemHealthProps {
  data: SystemHealthData;
}

function StatusItem({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm font-medium text-emerald-500">{status}</span>
    </div>
  );
}

function SystemHealthComponent({ data }: SystemHealthProps) {
  const circumference = 2 * Math.PI * 70;
  const strokeDashoffset = circumference - (data.uptime / 100) * circumference;

  return (
    <div className="h-full rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(7,43,78,0.07)] transition duration-300 hover:shadow-[0_24px_80px_rgba(7,43,78,0.11)]">
      {/* Header */}
      <h3 className="text-lg font-semibold text-slate-950 mb-6">
        Salud del sistema
      </h3>

      {/* Circular progress */}
      <div className="flex justify-center mb-6">
        <div className="relative w-44 h-44">
          <svg className="w-full h-full transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="88"
              cy="88"
              r="70"
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="12"
            />
            {/* Progress circle */}
            <circle
              cx="88"
              cy="88"
              r="70"
              fill="none"
              stroke="#10b981"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000"
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold text-slate-950">
              {data.uptime}%
            </span>
            <span className="text-sm text-slate-500">Uptime</span>
          </div>
        </div>
      </div>

      {/* Status list */}
      <div className="space-y-1 mb-4">
        <StatusItem
          icon={<Wifi className="w-4 h-4" />}
          label="Conectividad"
          status={data.connectivity}
        />
        <StatusItem
          icon={<BarChart2 className="w-4 h-4" />}
          label="Feeds de mercado"
          status={data.marketFeeds}
        />
        <StatusItem
          icon={<Zap className="w-4 h-4" />}
          label="Ejecución"
          status={data.execution}
        />
        <StatusItem
          icon={<Database className="w-4 h-4" />}
          label="Base de datos"
          status={data.database}
        />
        <StatusItem
          icon={<Gauge className="w-4 h-4" />}
          label="Render visual"
          status={`${data.visualLatencyMs.toFixed(1)} ms · ${data.updatesPerSecond.toFixed(1)} ups`}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-4 border-t border-slate-200 text-slate-500">
        <CheckCircle2 className="w-4 h-4 text-cyan-600" />
        <span className="text-xs">
          Edad del dato crítico: {data.lastCheck} ms
        </span>
      </div>
    </div>
  );
}

export const SystemHealth = memo(SystemHealthComponent);
