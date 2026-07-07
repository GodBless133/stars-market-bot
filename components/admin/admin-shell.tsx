"use client"

import { useState } from "react"
import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Star,
  Users,
  Settings,
  ExternalLink,
  LogOut,
  Zap,
} from "lucide-react"
import { AdminDashboard } from "./panels/dashboard"
import { AdminProducts } from "./panels/products"
import { AdminOrders } from "./panels/orders"
import { AdminReviews } from "./panels/reviews"
import { AdminCustomers } from "./panels/customers"
import { AdminSettings } from "./panels/settings"

type Tab = "dashboard" | "products" | "orders" | "reviews" | "customers" | "settings"

const NAV: { id: Tab; label: string; icon: any }[] = [
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard },
  { id: "products", label: "Товары", icon: Package },
  { id: "orders", label: "Заказы", icon: ShoppingCart },
  { id: "reviews", label: "Отзывы", icon: Star },
  { id: "customers", label: "Клиенты", icon: Users },
  { id: "settings", label: "Настройки", icon: Settings },
]

export function AdminShell({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard")
  const setAdminAuthed = useStore((s) => s.setAdminAuthed)

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-white">
              <Zap className="h-4 w-4" />
            </div>
            <div className="font-semibold leading-tight">
              Stars Market
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                Admin
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onExit}>
              <ExternalLink className="h-4 w-4 mr-1" /> Mini App
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdminAuthed(false)
                onExit()
              }}
            >
              <LogOut className="h-4 w-4 mr-1" /> Выйти
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="hidden md:flex w-56 flex-col border-r bg-white dark:bg-zinc-900 p-3 gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                tab === n.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
              )}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </button>
          ))}
        </aside>

        {/* Mobile nav */}
        <div className="md:hidden border-b bg-white dark:bg-zinc-900 p-2 flex gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap",
                tab === n.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <n.icon className="h-3.5 w-3.5" />
              {n.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 p-4 md:p-6">
          {tab === "dashboard" && <AdminDashboard />}
          {tab === "products" && <AdminProducts />}
          {tab === "orders" && <AdminOrders />}
          {tab === "reviews" && <AdminReviews />}
          {tab === "customers" && <AdminCustomers />}
          {tab === "settings" && <AdminSettings />}
        </main>
      </div>
    </div>
  )
}
