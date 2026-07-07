import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export default async function PricingPage() {
  const products = await db.product.findMany({
    where: { active: true },
    orderBy: [{ categoryId: "asc" }, { price: "asc" }],
    include: { category: true },
  })
  const settings = await db.settings.findUnique({ where: { id: "singleton" } })
  const storeName = settings?.storeName || "Stars Market"
  
  // Группируем по категориям
  const grouped: Record<string, any[]> = {}
  for (const p of products) {
    const catName = p.category?.name || "Другое"
    if (!grouped[catName]) grouped[catName] = []
    grouped[catName].push(p)
  }
  
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Цены и тарифы</h1>
        <p className="text-sm text-muted-foreground mb-8">Актуальные цены на все товары и услуги</p>
        
        <div className="rounded-2xl border border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 p-4 mb-8">
          <p className="text-sm">
            <strong>Способ оплаты:</strong> Telegram Stars (⭐)<br/>
            <strong>Курс:</strong> 1 ⭐ ≈ 1.4 ₽ (примерно)<br/>
            <strong>Комиссия:</strong> включена в стоимость
          </p>
        </div>
        
        {Object.entries(grouped).map(([catName, items]) => (
          <div key={catName} className="mb-8">
            <h2 className="text-xl font-semibold mb-3">{catName}</h2>
            <div className="space-y-2">
              {items.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-sm">{p.title}</p>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description.slice(0, 80)}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="font-bold">{p.price} ₽</p>
                    <p className="text-xs text-amber-600">{Math.max(1, Math.round(p.price * 0.5))} ⭐</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        <div className="mt-12 pt-6 border-t">
          <a href="https://t.me/Zippa005" className="inline-flex items-center gap-2 text-amber-600 hover:underline">← Вернуться в бота</a>
        </div>
      </div>
    </div>
  )
}
