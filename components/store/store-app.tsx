"use client"

import { useState } from "react"
import { StoreHeader } from "./store-header"
import { StoreHero } from "./store-hero"
import { StoreCatalog } from "./store-catalog"
import { StoreFeatures } from "./store-features"
import { StoreReviews } from "./store-reviews"
import { StoreFooter } from "./store-footer"
import { CartSheet } from "./cart-sheet"

export function StoreApp({
  onOpenAdmin,
  onOpenMiniApp,
}: {
  onOpenAdmin: () => void
  onOpenMiniApp: () => void
}) {
  const [cartOpen, setCartOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <StoreHeader onOpenCart={() => setCartOpen(true)} onOpenAdmin={onOpenAdmin} />
      <main className="flex-1">
        <StoreHero onOpenMiniApp={onOpenMiniApp} />
        <StoreCatalog />
        <StoreFeatures />
        <StoreReviews />
      </main>
      <StoreFooter onOpenMiniApp={onOpenMiniApp} />
      <CartSheet open={cartOpen} onOpenChange={setCartOpen} />
    </div>
  )
}
