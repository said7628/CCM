import {
  Activity,
  ArrowRightLeft,
  Bell,
  Building2,
  History,
  Home,
  LineChart,
  Pause,
  Settings,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { activeStrategy } from "@/lib/mock-data";
import { cn, formatCurrency } from "@/lib/utils";

const menuItems = [
  { icon: Home, label: "Resumen", active: true },
  { icon: Zap, label: "Oportunidades" },
  { icon: ArrowRightLeft, label: "Operaciones" },
  { icon: Building2, label: "Exchanges" },
  { icon: ShieldAlert, label: "Riesgo" },
  { icon: LineChart, label: "Estrategias" },
  { icon: History, label: "Backtesting" },
  { icon: Bell, label: "Alertas" },
  { icon: Settings, label: "Configuración" },
];

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-200/80 bg-white/90 shadow-[18px_0_60px_rgba(15,48,87,0.06)] backdrop-blur-xl lg:flex">
      <div className="px-7 py-7">
        <div className="flex items-center gap-3">
          <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-slate-950 via-blue-900 to-cyan-500 shadow-lg shadow-cyan-900/20">
            <Activity className="h-6 w-6 text-white" />
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-cyan-300 ring-4 ring-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950">
              Arbi<span className="text-cyan-500">Core</span>
            </h1>
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-slate-400">
              Arbitrage Simulator
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 pb-5">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.label}>
              <button
                className={cn(
                  "group flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-sm font-bold transition-all duration-200",
                  item.active
                    ? "bg-cyan-50 text-slate-950 shadow-[0_14px_35px_rgba(6,182,212,0.14)] ring-1 ring-cyan-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                )}
              >
                <item.icon
                  className={cn(
                    "h-5 w-5 transition",
                    item.active ? "text-cyan-600" : "text-blue-900/60 group-hover:text-cyan-600"
                  )}
                />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-5">
        <div className="rounded-[1.75rem] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-5 shadow-[0_18px_60px_rgba(7,43,78,0.08)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">
              Estrategia activa
            </span>
          </div>
          <h3 className="text-lg font-black text-slate-950">{activeStrategy.name}</h3>

          <div className="mt-5 space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500">Capital asignado</p>
              <p className="mt-1 text-xl font-black text-slate-950">
                {formatCurrency(activeStrategy.capital)}
              </p>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-bold text-slate-500">Uso del capital</span>
                <span className="font-black text-slate-950">{activeStrategy.capitalUsage}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                  style={{ width: `${activeStrategy.capitalUsage}%` }}
                />
              </div>
            </div>
          </div>

          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition hover:bg-cyan-700">
            <Pause className="h-4 w-4" />
            Pausar motor
          </button>
        </div>
      </div>
    </aside>
  );
}
