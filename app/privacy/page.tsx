import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export default async function PrivacyPage() {
  const settings = await db.settings.findUnique({ where: { id: "singleton" } })
  const storeName = settings?.storeName || "Stars Market"
  const support = settings?.supportContact || "@Zippa005"
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Политика конфиденциальности</h1>
        <p className="text-sm text-muted-foreground mb-8">Последнее обновление: 28 июня 2026 г.</p>
        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-4 text-sm leading-relaxed">
          <h2 className="text-xl font-semibold mt-6">1. Общие положения</h2>
          <p>Настоящая Политика конфиденциальности определяет порядок обработки и защиты персональных данных пользователей магазина «{storeName}».</p>
          <p>Используя сервисы Магазина, вы соглашаетесь с настоящей Политикой.</p>
          <h2 className="text-xl font-semibold mt-6">2. Какие данные мы собираем</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Данные Telegram:</strong> Telegram ID, username, имя — для идентификации и обработки заказов.</li>
            <li><strong>Данные заказов:</strong> история покупок, номера заказов, выбранные товары.</li>
            <li><strong>Платёжные данные:</strong> информация об оплате через Telegram Stars. Мы не храним данные банковских карт.</li>
            <li><strong>Технические данные:</strong> IP-адрес, тип устройства — для работоспособности сервиса.</li>
          </ul>
          <h2 className="text-xl font-semibold mt-6">3. Цели обработки</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Обработка и выполнение заказов.</li>
            <li>Предоставление клиентской поддержки.</li>
            <li>Уведомление о статусе заказов.</li>
            <li>Предотвращение мошенничества.</li>
            <li>Улучшение качества услуг.</li>
          </ul>
          <h2 className="text-xl font-semibold mt-6">4. Хранение и защита</h2>
          <p>Данные хранятся на защищённых серверах. Срок хранения — не более 12 месяцев с последнего взаимодействия.</p>
          <h2 className="text-xl font-semibold mt-6">5. Передача третьим лицам</h2>
          <p>Мы не передаём данные третьим лицам, кроме случаев выполнения заказа (SMM-провайдеры) или по требованию закона.</p>
          <h2 className="text-xl font-semibold mt-6">6. Права пользователя</h2>
          <p>Вы можете запросить информацию о данных, исправить или удалить их. Обращайтесь: {support}</p>
          <h2 className="text-xl font-semibold mt-6">7. Изменения Политики</h2>
          <p>Актуальная версия доступна по адресу /privacy</p>
          <h2 className="text-xl font-semibold mt-6">8. Контакты</h2>
          <p>По вопросам конфиденциальности: {support}</p>
        </div>
        <div className="mt-12 pt-6 border-t">
          <a href="https://t.me/Zippa005" className="inline-flex items-center gap-2 text-amber-600 hover:underline">← Вернуться в бота</a>
        </div>
      </div>
    </div>
  )
}
