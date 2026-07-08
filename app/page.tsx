"use client"

import { useEffect, useState, useRef } from "react"
import { AdminApp } from "@/components/admin/admin-app"
import { MiniApp } from "@/components/miniapp/mini-app"

// Telegram WebApp typing is declared once in components/miniapp/mini-app.tsx
// (declaring it again here causes TS2717: subsequent property declarations
// must have the same type).

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [showMiniApp, setShowMiniApp] = useState(false)
  const detected = useRef(false)

  useEffect(() => {
    const checkTelegram = () => {
      if (detected.current) return
      const tg = window.Telegram?.WebApp
      // В Telegram WebView platform = "tdesktop"/"android"/"ios"/"web"
      // В обычном браузере platform = undefined, но Telegram SDK может быть загружен
      if (tg && tg.platform && tg.platform !== "unknown") {
        detected.current = true
        setShowMiniApp(true)
        try {
          tg.ready()
          tg.expand()
          tg.setHeaderColor?.("#0a0a0a")
          tg.setBackgroundColor?.("#0a0a0a")
        } catch {}
        setMounted(true)
      } else if (tg && tg.initDataUnsafe && Object.keys(tg.initDataUnsafe).length > 0) {
        detected.current = true
        setShowMiniApp(true)
        try {
          tg.ready()
          tg.expand()
          tg.setHeaderColor?.("#0a0a0a")
          tg.setBackgroundColor?.("#0a0a0a")
        } catch {}
        setMounted(true)
      } else if (window.Telegram) {
        // Telegram SDK загружен, но не в WebView → браузер
        detected.current = true
        setShowMiniApp(false)
        setMounted(true)
      } else {
        // SDK ещё не загружен
        setTimeout(checkTelegram, 100)
      }
    }
    checkTelegram()

    // Fallback через 3 секунды — если ничего не определилось
    const fallback = setTimeout(() => {
      if (!detected.current) {
        detected.current = true
        setShowMiniApp(false)
        setMounted(true)
      }
    }, 3000)

    return () => clearTimeout(fallback)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-6 w-6 rounded-full border-2 border-zinc-300 border-t-amber-500 animate-spin" />
      </div>
    )
  }

  if (showMiniApp) {
    return <MiniApp onExit={() => {}} />
  }

  return <AdminApp onExit={() => {}} />
}
