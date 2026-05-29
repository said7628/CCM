"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { exchangeConfig } from "@/lib/mock-data";

interface ExchangePrice {
  exchange: string;
  price: number;
  change: number;
}

interface ExchangePricesProps {
  prices: ExchangePrice[];
}

function ExchangeLogo({ exchange }: { exchange: string }) {
  const config = exchangeConfig[exchange] || {
    color: "#666",
    bgColor: "#f0f0f0",
    icon: exchange[0],
  };

  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
      style={{ backgroundColor: config.bgColor, color: config.color }}
    >
      {config.icon}
    </div>
  );
}

function PriceCard({ data }: { data: ExchangePrice }) {
  const isPositive = data.change > 0;
  const isNegative = data.change < 0;

  return (
    <div className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <ExchangeLogo exchange={data.exchange} />
        <div>
          <p className="text-sm font-medium text-foreground">{data.exchange}</p>
          <p className="text-xs text-muted-foreground">BTC/USDT</p>
        </div>
      </div>
      
      <div className="text-right">
        <p className="text-lg font-bold text-foreground">
          ${data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className={`flex items-center justify-end gap-1 text-xs ${
          isPositive ? "text-emerald-500" : isNegative ? "text-red-500" : "text-muted-foreground"
        }`}>
          {isPositive ? (
            <TrendingUp className="w-3 h-3" />
          ) : isNegative ? (
            <TrendingDown className="w-3 h-3" />
          ) : (
            <Minus className="w-3 h-3" />
          )}
          <span>{isPositive ? "+" : ""}{data.change.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

export function ExchangePrices({ prices }: ExchangePricesProps) {
  return (
    <div className="bg-card rounded-2xl p-6 border border-border shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Precio BTC por Exchange</h3>
          <p className="text-sm text-muted-foreground">Actualizado en tiempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs text-emerald-600 font-medium">En vivo</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {prices.map((price) => (
          <PriceCard key={price.exchange} data={price} />
        ))}
      </div>
    </div>
  );
}
