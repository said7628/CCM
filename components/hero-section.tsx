"use client";

import { ArrowRight } from "lucide-react";

export function HeroSection() {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* Left content */}
      <div className="lg:col-span-2">
        <h1 className="text-4xl font-bold text-foreground mb-3 text-balance">
          Arbitraje en tiempo real
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl">
          Detectamos oportunidades en milisegundos y ejecutamos con velocidad.
        </p>
      </div>

      {/* Hero card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-secondary p-6 text-white">
        {/* Abstract shapes */}
        <div className="absolute top-0 right-0 w-32 h-32 opacity-20">
          <div className="absolute top-4 right-4 w-16 h-16 border-2 border-white/40 rounded-lg transform rotate-12" />
          <div className="absolute top-8 right-8 w-12 h-12 border-2 border-white/30 rounded-lg transform -rotate-6" />
          <div className="absolute top-2 right-12 w-8 h-8 bg-white/20 rounded-lg transform rotate-45" />
        </div>

        {/* Bitcoin icon */}
        <div className="absolute bottom-4 right-4 opacity-10">
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M11.5 11.5v-2h1.75c.55 0 1 .45 1 1s-.45 1-1 1H11.5zm0 1h2.25c.55 0 1 .45 1 1s-.45 1-1 1H11.5v-2z" />
            <path d="M9 9V8h1v1h1V8h1v1.09c1.71.17 3 1.6 3 3.32 0 .63-.17 1.22-.47 1.72.3.5.47 1.09.47 1.72 0 1.72-1.29 3.15-3 3.32V20h-1v-1h-1v1H9v-1H7v-1.5h1v-6H7V10h2V9zm2.5 7.5h2.25c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5H11.5v3zm0-4h1.75c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5H11.5v3z" />
          </svg>
        </div>

        <h3 className="text-xl font-bold mb-2 text-balance">
          Ejecucion inteligente sin limites
        </h3>
        <p className="text-sm text-white/80 mb-6 leading-relaxed">
          Nuestro motor busca, evalua y ejecuta oportunidades en multiples
          mercados de forma automatica.
        </p>

        <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-primary font-medium text-sm hover:bg-white/90 transition-colors">
          Ver como funciona
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
