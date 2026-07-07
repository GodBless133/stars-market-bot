import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export default async function ContactsPage() {
  const settings = await db.settings.findUnique({ where: { id: "singleton" } })
  const support = settings?.supportContact || "@Zippa005"
  const storeName = settings?.storeName || "Stars Market"
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">Контакты поддержки</h1>
        <div className="space-y-6">
          <div className="rounded-2xl border p-6">
            <h2 className="text-xl font-semibold mb-3">Связь с поддержкой</h2>
            <div className="space-y-3 text-sm">
              <p><strong>Telegram:</strong> <a href="https://t.me/Zippa005" className="text-amber-600 underline">@Zippa005</a></p>
              <p><strong>Время работы:</strong> 24/7 (ответ в течение 1-2 часов)</p>
              <p><strong>Язык поддержки:</strong> Русский, English</p>
            </div>
          </div>
          <div className="rounded-2xl border p-6">
            <h2 className="text-xl font-semibold mb-3">По каким вопросам обращаться</h2>
            <ul className="list-disc pl-6 space-y-2 text-sm">
              <li>Проблемы с заказом (не пришёл товар, ошибка оплаты)</li>
              <li>Возврат средств</li>
              <li>Вопросы по тарифам и услугам</li>
              <li>Жалобы и предложения</li>
              <li>Сотрудничество и опт</li>
            </ul>
          </div>
          <div className="rounded-2xl border p-6">
            <h2 className="text-xl font-semibold mb-3">Полезные ссылки</h2>
            <div className="space-y-2 text-sm">
              <p><a href="/privacy" className="text-amber-600 underline">Политика конфиденциальности</a></p>
              <p><a href="/terms" className="text-amber-600 underline">Пользовательское соглашение</a></p>
              <p><a href="/pricing" className="text-amber-600 underline">Цены и тарифы</a></p>
              <p><a href="/reviews" className="text-amber-600 underline">Отзывы покупателей</a></p>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t">
          <a href="https://t.me/Zippa005" className="inline-flex items-center gap-2 text-amber-600 hover:underline">← Вернуться в бота</a>
        </div>
      </div>
    </div>
  )
}
