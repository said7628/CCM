import { Bell, ChevronDown, Search, Sun } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/82 px-5 py-4 backdrop-blur-xl lg:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">
            ¡Bienvenido de vuelta!
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Monitoriza mercados, detecta diferencias y ejecuta arbitrajes con precisión.
          </p>
          <div className="mt-3 h-0.5 w-10 rounded-full bg-cyan-500" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden min-w-[260px] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-400 shadow-sm md:flex">
            <Search className="h-4 w-4" />
            Buscar exchange, par u operación
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.12)]" />
            <span className="text-sm font-bold text-slate-800">Motor activo</span>
          </div>

          <button className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-cyan-200 hover:text-cyan-600">
            <Sun className="h-5 w-5" />
          </button>

          <button className="relative grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-cyan-200 hover:text-cyan-600">
            <Bell className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-cyan-500 text-[10px] font-black text-white ring-4 ring-white">
              3
            </span>
          </button>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white py-2 pl-2 pr-3 shadow-sm">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-slate-950 to-cyan-600 text-sm font-black text-white">
              AR
            </div>
            <div className="hidden leading-tight sm:block">
              <span className="block text-sm font-black text-slate-950">ArbiTrader</span>
              <span className="text-xs font-medium text-slate-500">Cuenta Pro</span>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </div>
        </div>
      </div>
    </header>
  );
}
