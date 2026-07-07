"use client"

import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Zap,
  ShoppingCart,
  Search,
  ShieldCheck,
  Clock,
  Headphones,
  Settings2,
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"

export function StoreHeader({ onOpenCart, onOpenAdmin }: { onOpenCart: () => void; onOpenAdmin: () => void }) {
  const count = useStore((s) => s.count())
  const search = useStore((s) => s.searchQuery)
  const setSearch = useStore((s) => s.setSearch)

  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 items-center gap-3">
          <button
            onClick={() => setSearch("")}
            className="flex items-center gap-2 flex-shrink-0"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg shadow-orange-500/20">
              <Zap className="h-5 w-5" />
            </div>
            <div className="hidden sm:block leading-tight">
              <p className="font-bold">Stars Market</p>
              <p className="text-[10px] text-muted-foreground -mt-0.5">
                Аккаунты · Звёзды · Подарки
              </p>
            </div>
          </button>

          <div className="relative flex-1 max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Поиск товаров..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-full bg-zinc-100 dark:bg-zinc-900 pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onOpenAdmin} title="Админ-панель">
              <Settings2 className="h-4 w-4" />
              <span className="hidden md:inline ml-1">Админ</span>
            </Button>
            <Button
              size="sm"
              onClick={onOpenCart}
              className="rounded-full relative bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Корзина</span>
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-bold px-1">
                  {count}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* trust bar */}
        <div className="hidden sm:flex items-center gap-5 h-9 text-xs text-muted-foreground border-t">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Гарантия на все товары
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-sky-500" />
            Мгновенная выдача 24/7
          </span>
          <span className="flex items-center gap-1.5">
            <Headphones className="h-3.5 w-3.5 text-amber-500" />
            Поддержка за 2 минуты
          </span>
        </div>
      </div>
    </header>
  )
}
