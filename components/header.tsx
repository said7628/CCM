"use client";

import { Bell, Sun, ChevronDown, User } from "lucide-react";

export function Header() {
  return (
    <header className="h-20 bg-card border-b border-border flex items-center justify-between px-8">
      {/* Welcome text */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {"!Bienvenido de vuelta!"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Monitoriza mercados, detecta diferencias y ejecuta arbitrajes con
          precision.
        </p>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-4">
        {/* Motor badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-medium text-foreground">
            Motor activo
          </span>
        </div>

        {/* Theme toggle */}
        <button className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors">
          <Sun className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Notifications */}
        <button className="relative w-10 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors">
          <Bell className="w-5 h-5 text-muted-foreground" />
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-secondary text-[10px] font-bold text-white flex items-center justify-center">
            3
          </span>
        </button>

        {/* Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-border">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold text-sm">
            AR
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              ArbiTrader
            </span>
            <span className="text-xs text-muted-foreground">Cuenta Pro</span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </header>
  );
}
