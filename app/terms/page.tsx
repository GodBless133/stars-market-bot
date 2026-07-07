import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export default async function TermsPage() {
  const settings = await db.settings.findUnique({ where: { id: "singleton" } })
  const storeName = settings?.storeName || "Stars Market"
  const support = settings?.supportContact || "@Zippa005"
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Пользовательское соглашение</h1>
        <p className="text-sm text-muted-foreground mb-8">Последнее обновление: 28 июня 2026 г.</p>
        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-4 text-sm leading-relaxed">
          <h2 className="text-xl font-semibold mt-6">1. Общие положения</h2>
          <p>Настоящее Пользовательское соглашение (далее — «Соглашение») регулирует отношения между магазином «{storeName}» (далее — «Магазин») и пользователем (далее — «Пользователь») при использовании сервисов Магазина.</p>
          <p>Используя сервисы Магазина, Пользователь подтверждает согласие с условиями Соглашения.</p>
          <h2 className="text-xl font-semibold mt-6">2. Услуги Магазина</h2>
          <p>Магазин предоставляет следующие услуги:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Продажа Telegram Stars и Telegram Premium.</li>
            <li>Продажа Telegram-аккаунтов с автоматической выдачей данных для входа.</li>
            <li>Услуги накрутки подписчиков, просмотров и реакций.</li>
            <li>Продажа Telegram-каналов.</li>
            <li>Продажа виртуальных номеров и подарков.</li>
          </ul>
          <h2 className="text-xl font-semibold mt-6">3. Оплата</h2>
          <p>Оплата услуг производится через Telegram Stars (валюта XTR). Стоимость услуг указана в каталоге. Оплата считается завершённой после подтверждения Telegram.</p>
          <h2 className="text-xl font-semibold mt-6">4. Доставка</h2>
          <p>Цифровые товары (аккаунты, коды) доставляются автоматически сразу после оплаты. Услуги накрутки выполняются в течение 30 минут — 24 часов. Информация о статусе заказа доступна в разделе «Мои заказы».</p>
          <h2 className="text-xl font-semibold mt-6">5. Возврат средств</h2>
          <p>Возврат средств возможен в следующих случаях:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Товар не был доставлен в течение 24 часов.</li>
            <li>Товар оказался некачественным (аккаунт не работает, накрутка не выполнена).</li>
            <li>Техническая ошибка при оплате (двойное списание).</li>
          </ul>
          <p>Для возврата обратитесь в поддержку: {support}. Возврат производится в течение 3 рабочих дней.</p>
          <h2 className="text-xl font-semibold mt-6">6. Гарантии</h2>
          <p>Магазин гарантирует:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Доставку товара после оплаты.</li>
            <li>Работоспособность аккаунтов в момент выдачи.</li>
            <li>Выполнение услуг накрутки в указанном объёме.</li>
          </ul>
          <p>Магазин не несёт ответственности за действия Пользователя после получения товара (смена пароля, нарушение правил Telegram и т.д.).</p>
          <h2 className="text-xl font-semibold mt-6">7. Запрещённые действия</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Мошенничество и обман поддержки.</li>
            <li>Попытки взлома или нарушения работы сервиса.</li>
            <li>Использование товара для незаконных целей.</li>
          </ul>
          <p>При нарушении Магазин вправе заблокировать Пользователя без возврата средств.</p>
          <h2 className="text-xl font-semibold mt-6">8. Изменения Соглашения</h2>
          <p>Магазин вправе изменять Соглашение. Актуальная версия доступна по адресу /terms</p>
          <h2 className="text-xl font-semibold mt-6">9. Контакты</h2>
          <p>Поддержка: {support}</p>
        </div>
        <div className="mt-12 pt-6 border-t">
          <a href="https://t.me/Zippa005" className="inline-flex items-center gap-2 text-amber-600 hover:underline">← Вернуться в бота</a>
        </div>
      </div>
    </div>
  )
}
