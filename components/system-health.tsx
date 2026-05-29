"use client";

import { Wifi, BarChart2, Zap, Database, CheckCircle2 } from "lucide-react";

interface SystemHealthData {
  uptime: number;
  connectivity: string;
  marketFeeds: string;
  execution: string;
  database: string;
  lastCheck: number;
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
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm font-medium text-emerald-500">{status}</span>
    </div>
  );
}

export function SystemHealth({ data }: SystemHealthProps) {
  const circumference = 2 * Math.PI * 70;
  const strokeDashoffset = circumference - (data.uptime / 100) * circumference;

  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      {/* Header */}
      <h3 className="text-lg font-semibold text-foreground mb-6">
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
              stroke="hsl(var(--muted))"
              strokeWidth="12"
            />
            {/* Progress circle */}
            <circle
              cx="88"
              cy="88"
              r="70"
              fill="none"
              stroke="hsl(var(--secondary))"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000"
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-foreground">
              {data.uptime}%
            </span>
            <span className="text-sm text-muted-foreground">Uptime</span>
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
          label="Ejecucion"
          status={data.execution}
        />
        <StatusItem
          icon={<Database className="w-4 h-4" />}
          label="Base de datos"
          status={data.database}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-4 border-t border-border text-muted-foreground">
        <CheckCircle2 className="w-4 h-4 text-secondary" />
        <span className="text-xs">
          Ultima verificacion: hace {data.lastCheck} segundos
        </span>
      </div>
    </div>
  );
}
