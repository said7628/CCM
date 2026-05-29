"use client";

import { ArrowUpRight } from "lucide-react";
import { exchangeConfig } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils";

interface ExchangePrice {
  exchange: string;
  price: number;
  spread: number;
  bid: number;
  ask: number;
  status: string;
}

interface BtcExchangePricesProps {
  prices: ExchangePrice[];
}

export function BtcExchangePrices({ prices }: BtcExchangePricesProps) {
  const minPrice = Math.min(...prices.map((item) => item.price));
  const maxPrice = Math.max(...prices.map((item) => item.price));
  const range = Math.max(maxPrice - minPrice, 1);

  return (
    <section className="mb-8 rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(7,43,78,0.065)] md:p-6">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-600">
            Order book · BTC/USDT
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950">
            Precio BTC por exchange
          </h3>
        </div>
        <p className="text-sm font-normal text-slate-500">
          Bid/ask y spread normalizados para detectar diferencias accionables.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {prices.map((item) => {
          const config = exchangeConfig[item.exchange];
          const position = ((item.price - minPrice) / range) * 100;
          const isLive = item.status === "Live";

          return (
            <article
              key={item.exchange}
              className="group rounded-[1.25rem] border border-slate-200 bg-slate-50/60 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white hover:shadow-[0_16px_45px_rgba(7,43,78,0.08)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-xl text-xs font-semibold"
                    style={{ backgroundColor: config.bgColor, color: config.color }}
                  >
                    {config.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.exchange}</p>
                    <p className="text-xs font-normal text-slate-500">BTC spot</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${isLive ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {item.status}
                </span>
              </div>

              <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-slate-950">
                {formatCurrency(item.price)}
              </p>

              <div className="mt-4 h-2 rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                  style={{ width: `${Math.max(position, 8)}%` }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="font-normal text-slate-400">Bid</p>
                  <p className="mt-1 font-medium text-slate-700">{formatCurrency(item.bid)}</p>
                </div>
                <div>
                  <p className="font-normal text-slate-400">Ask</p>
                  <p className="mt-1 font-medium text-slate-700">{formatCurrency(item.ask)}</p>
                </div>
                <div>
                  <p className="font-normal text-slate-400">Spread</p>
                  <p className="mt-1 inline-flex items-center gap-1 font-medium text-cyan-700">
                    {item.spread.toFixed(2)}% <ArrowUpRight className="h-3 w-3" />
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
