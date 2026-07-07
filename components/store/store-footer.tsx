"use client"

import { Zap, Send, MessageCircle } from "lucide-react"

export function StoreFooter({ onOpenMiniApp }: { onOpenMiniApp: () => void }) {
  return (
    <footer className="mt-auto bg-zinc-950 text-zinc-400">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white">
                <Zap className="h-5 w-5" />
              </div>
              <span className="font-bold text-white">Stars Market</span>
            </div>
            <p className="text-sm max-w-md">
              Магазин цифровых товаров: Telegram Stars, Premium-аккаунты,
              виртуальные номера и подарки. Мгновенная выдача и гарантия на всё.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={onOpenMiniApp}
                className="flex items-center gap-2 rounded-full bg-[#229ED9] hover:opacity-90 px-4 py-2 text-sm text-white"
              >
                <Send className="h-4 w-4" /> Открыть в Telegram
              </button>
              <a
                href="#"
                className="flex items-center gap-2 rounded-full bg-white/5 hover:bg-white/10 px-4 py-2 text-sm text-white"
              >
                <MessageCircle className="h-4 w-4" /> Поддержка
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-white mb-3 text-sm">Каталог</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#catalog" className="hover:text-white">Telegram Stars</a></li>
              <li><a href="#catalog" className="hover:text-white">Premium аккаунты</a></li>
              <li><a href="#catalog" className="hover:text-white">Виртуальные номера</a></li>
              <li><a href="#catalog" className="hover:text-white">Подарки</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-white mb-3 text-sm">Информация</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white">Условия использования</a></li>
              <li><a href="#" className="hover:text-white">Политика конфиденциальности</a></li>
              <li><a href="#" className="hover:text-white">Возврат и обмен</a></li>
              <li><a href="#" className="hover:text-white">Связаться с нами</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <p>© 2024 Stars Market. Все права защищены.</p>
          <p className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Сервис работает · Автовыдача 24/7
          </p>
        </div>
      </div>
    </footer>
  )
}
