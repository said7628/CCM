"use client";

import {
  Home,
  Zap,
  ArrowRightLeft,
  Building2,
  ShieldAlert,
  LineChart,
  History,
  Bell,
  Settings,
  Pause,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { activeStrategy } from "@/lib/mock-data";

const menuItems = [
  { icon: Home, label: "Resumen", active: true },
  { icon: Zap, label: "Oportunidades" },
  { icon: ArrowRightLeft, label: "Operaciones" },
  { icon: Building2, label: "Exchanges" },
  { icon: ShieldAlert, label: "Riesgo" },
  { icon: LineChart, label: "Estrategias" },
  { icon: History, label: "Backtesting" },
  { icon: Bell, label: "Alertas" },
  { icon: Settings, label: "Configuracion" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary">ArbiCore</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Arbitrage Simulator
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 overflow-y-auto">
        <ul className="space-y-1">
          {menuItems.map((item) => (
            <li key={item.label}>
              <button
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  item.active
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Strategy Card */}
      <div className="p-4">
        <div className="p-4 rounded-2xl bg-gradient-to-br from-muted to-muted/50 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground">
              Estrategia activa
            </span>
          </div>
          <h3 className="font-semibold text-foreground mb-3">
            {activeStrategy.name}
          </h3>

          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Capital asignado</span>
              <span className="font-semibold text-foreground">
                {formatCurrency(activeStrategy.capital)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Uso del capital</span>
              <span className="font-semibold text-secondary">
                {activeStrategy.capitalUsage}%
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-background rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-gradient-to-r from-secondary to-accent rounded-full transition-all duration-500"
              style={{ width: `${activeStrategy.capitalUsage}%` }}
            />
          </div>

          <button className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
            <Pause className="w-4 h-4" />
            Pausar motor
          </button>
        </div>
      </div>
    </aside>
  );
}
