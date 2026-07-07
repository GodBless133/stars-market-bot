"use client"

import { ShieldCheck, Zap, Headphones, CreditCard, RefreshCw, Lock } from "lucide-react"

const FEATURES = [
  {
    icon: Zap,
    title: "Мгновенная выдача",
    desc: "Товар приходит сразу после оплаты — без ожиданий и проверок",
    color: "from-amber-400 to-orange-600",
  },
  {
    icon: ShieldCheck,
    title: "Гарантия качества",
    desc: "Все товары проверены. Если что-то не так — вернём деньги",
    color: "from-emerald-400 to-green-600",
  },
  {
    icon: Headphones,
    title: "Поддержка 24/7",
    desc: "Отвечаем в течение 2 минут в любое время дня и ночи",
    color: "from-sky-400 to-cyan-600",
  },
  {
    icon: CreditCard,
    title: "Удобная оплата",
    desc: "Карты, Telegram Stars, криптовалюта и баланс аккаунта",
    color: "from-pink-400 to-rose-600",
  },
  {
    icon: RefreshCw,
    title: "Возврат и обмен",
    desc: "Если товар не подошёл — поможем обменять или вернём средства",
    color: "from-purple-400 to-fuchsia-600",
  },
  {
    icon: Lock,
    title: "Безопасно",
    desc: "Защищённые платежи и конфиденциальность ваших данных",
    color: "from-indigo-400 to-violet-600",
  },
]

export function StoreFeatures() {
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900/50 border-y">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold">Почему выбирают нас</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Создано для удобства и безопасности
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl bg-white dark:bg-zinc-900 border p-5 flex gap-4"
            >
              <div
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${f.color} text-white`}
              >
                <f.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
