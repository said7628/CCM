import { ArrowRight, ShieldCheck } from "lucide-react";

export function HeroSection() {
  return (
    <section className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.9fr_1fr]">
      <div className="relative overflow-hidden rounded-[2rem] border border-cyan-100/80 bg-white/75 p-8 shadow-[0_20px_70px_rgba(7,43,78,0.08)] backdrop-blur xl:p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(20,184,166,0.14),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(241,249,255,0.74))]" />
        <div className="absolute right-0 top-0 h-full w-2/3 opacity-50 [background-image:linear-gradient(rgba(15,71,116,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,71,116,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700">
            <span className="h-2 w-2 rounded-full bg-cyan-500 shadow-[0_0_0_6px_rgba(6,182,212,0.14)]" />
            Mercado sincronizado en vivo
          </div>
          <h1 className="max-w-3xl text-balance text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl xl:text-6xl">
            Arbitraje en tiempo real
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
            Detectamos oportunidades en milisegundos, validamos riesgo y
            ejecutamos arbitrajes con precisión institucional.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-600">
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

      <article className="relative min-h-[330px] overflow-hidden rounded-[2rem] border border-white/30 bg-[#0a3769] p-5 text-white shadow-[0_24px_80px_rgba(5,39,78,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.34),transparent_30%),linear-gradient(135deg,#07315f,#0d6aa9_58%,#bfefff)]" />
        <img
          src="/imagehero.png"
          alt="Visual tecnológico de arbitraje cripto de ArbiCore"
          className="absolute inset-0 h-full w-full object-cover opacity-90 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#08284d]/90 via-[#08315f]/58 to-white/10" />
        <div className="relative z-10 flex h-full min-h-[290px] flex-col justify-end p-4 md:max-w-[56%] xl:max-w-[62%]">
          <h2 className="text-balance text-2xl font-black tracking-[-0.03em] md:text-3xl">
            Ejecución inteligente sin límites
          </h2>
          <p className="mt-4 text-sm leading-7 text-cyan-50/90">
            Nuestro motor busca, evalúa y prioriza oportunidades en múltiples
            mercados de forma automática.
          </p>
          <button className="mt-6 inline-flex w-fit items-center gap-3 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:-translate-y-0.5 hover:bg-cyan-50">
            Ver cómo funciona
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </article>
    </section>
  );
}
