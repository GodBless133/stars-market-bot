"use client"

import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Zap, Sparkles, ShieldCheck, Gift } from "lucide-react"

export function StoreHero({ onOpenMiniApp }: { onOpenMiniApp: () => void }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-orange-950 text-white">
      {/* glow */}
      <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-amber-500/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-orange-500/20 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
        backgroundSize: "32px 32px",
      }} />

      <div className="relative mx-auto max-w-7xl px-4 py-14 md:py-20">
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          <div>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 mb-4">
              <Sparkles className="h-3 w-3 mr-1" /> №1 магазин Telegram Stars
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">
              Звёзды, аккаунты
              <br />
              и Premium —
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                {" "}мгновенно
              </span>
            </h1>
            <p className="mt-5 text-zinc-300 text-lg max-w-md">
              Покупайте Telegram Stars, Premium и аккаунты по лучшим ценам.
              Автоматическая выдача сразу после оплаты.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="rounded-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 px-7"
                onClick={() => {
                  document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" })
                }}
              >
                <Zap className="h-4 w-4 mr-1" /> В каталог
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-full border-white/20 bg-white/5 backdrop-blur text-white hover:bg-white/10"
                onClick={onOpenMiniApp}
              >
                <Gift className="h-4 w-4 mr-1" /> Открыть в Telegram
              </Button>
            </div>

            <div className="mt-8 flex items-center gap-6 text-sm">
              <div>
                <p className="text-2xl font-bold text-amber-400">10K+</p>
                <p className="text-zinc-400">продаж</p>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <p className="text-2xl font-bold text-amber-400">4.9★</p>
                <p className="text-zinc-400">рейтинг</p>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <p className="text-2xl font-bold text-amber-400">24/7</p>
                <p className="text-zinc-400">поддержка</p>
              </div>
            </div>
          </div>

          {/* visual card stack */}
          <div className="relative hidden lg:block">
            <div className="relative mx-auto max-w-sm">
              <div className="absolute -top-6 -left-6 h-40 w-40 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-600 rotate-12 opacity-90 flex items-center justify-center text-7xl shadow-2xl">
                ⭐
              </div>
              <div className="absolute top-20 -right-4 h-32 w-32 rounded-3xl bg-gradient-to-br from-purple-500 to-fuchsia-700 -rotate-6 opacity-90 flex items-center justify-center text-6xl shadow-2xl">
                👑
              </div>
              <div className="absolute bottom-0 left-12 h-36 w-36 rounded-3xl bg-gradient-to-br from-sky-400 to-cyan-700 rotate-3 opacity-90 flex items-center justify-center text-6xl shadow-2xl">
                🎁
              </div>
              <div className="h-72 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center">
                <ShieldCheck className="h-16 w-16 text-amber-400/40" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
