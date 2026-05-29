import { ArrowRight, ShieldCheck } from "lucide-react";

export function HeroSection() {
  return (
    <section className="mb-7 grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-cyan-100/80 bg-white/80 p-7 shadow-[0_18px_60px_rgba(7,43,78,0.07)] backdrop-blur xl:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(20,184,166,0.13),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(241,249,255,0.76))]" />
        <div className="absolute right-0 top-0 h-full w-2/3 opacity-45 [background-image:linear-gradient(rgba(15,71,116,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(15,71,116,0.07)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3.5 py-2 text-sm font-medium text-cyan-700">
            <span className="h-2 w-2 rounded-full bg-cyan-500 shadow-[0_0_0_6px_rgba(6,182,212,0.14)]" />
            Mercado sincronizado en vivo
          </div>
          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-[-0.045em] text-slate-950 md:text-5xl">
            Arbitraje BTC con lectura institucional del mercado
          </h1>
          <p className="mt-4 max-w-2xl text-base font-normal leading-7 text-slate-600 md:text-lg">
            Supervisa spreads, riesgo, balances y ejecución multi-exchange en una interfaz clara para tomar decisiones rápidas sin ruido visual.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm font-medium text-slate-600">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Riesgo protegido
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Latencia media 23 ms
            </div>
          </div>
        </div>
      </div>

      <article className="relative min-h-[300px] overflow-hidden rounded-[1.75rem] border border-white/40 bg-[#0a3769] p-4 text-white shadow-[0_22px_70px_rgba(5,39,78,0.2)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.3),transparent_30%),linear-gradient(135deg,#07315f,#0d6aa9_58%,#bfefff)]" />
        <img
          src="/imagehero.png"
          alt="Visual tecnológico de arbitraje cripto de ArbiCore"
          className="absolute inset-0 h-full w-full rounded-[1.5rem] object-cover object-center opacity-95"
        />
        <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-r from-[#08284d]/88 via-[#08315f]/48 to-white/5" />
        <div className="relative z-10 flex h-full min-h-[268px] flex-col justify-end p-4 md:max-w-[58%] xl:max-w-[64%]">
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
            Ejecución inteligente sin fricción
          </h2>
          <p className="mt-3 text-sm font-normal leading-6 text-cyan-50/90">
            El motor prioriza oportunidades ejecutables, costos reales y exposición antes de enviar una orden.
          </p>
          <button className="mt-5 inline-flex w-fit items-center gap-3 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:-translate-y-0.5 hover:bg-cyan-50">
            Ver flujo operativo
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </article>
    </section>
  );
}
