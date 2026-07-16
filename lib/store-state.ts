"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface CartItem {
  productId: string
  title: string
  price: number
  image?: string
  qty: number
  type?: string
}

export type AppMode = "store" | "admin" | "miniapp"

interface CartState {
  items: CartItem[]
  mode: AppMode
  adminAuthed: boolean
  // storefront
  selectedCategory: string
  searchQuery: string
  // tg user (mini app)
  tgUser: { id: string; firstName?: string; username?: string } | null
  // actions
  add: (item: Omit<CartItem, "qty">, qty?: number) => void
  remove: (productId: string) => void
  setQty: (productId: string, qty: number) => void
  clear: () => void
  setMode: (m: AppMode) => void
  setAdminAuthed: (v: boolean) => void
  setCategory: (c: string) => void
  setSearch: (q: string) => void
  setTgUser: (u: CartState["tgUser"]) => void
  // selectors
  total: () => number
  count: () => number
}

export const useStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      mode: "store",
      adminAuthed: false,
      selectedCategory: "all",
      searchQuery: "",
      tgUser: null,
      add: (item, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.productId === item.productId)
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.productId === item.productId ? { ...i, qty: i.qty + qty } : i
              ),
            }
          }
          return { items: [...s.items, { ...item, qty }] }
        }),
      remove: (productId) =>
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
      setQty: (productId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.productId !== productId)
              : s.items.map((i) =>
                  i.productId === productId ? { ...i, qty } : i
                ),
        })),
      clear: () => set({ items: [] }),
      setMode: (m) => set({ mode: m }),
      setAdminAuthed: (v) => set({ adminAuthed: v }),
      setCategory: (c) => set({ selectedCategory: c }),
      setSearch: (q) => set({ searchQuery: q }),
      setTgUser: (u) => set({ tgUser: u }),
      total: () => get().items.reduce((s, i) => s + i.price * i.qty, 0),
      count: () => get().items.reduce((s, i) => s + i.qty, 0),
    }),
    {
      name: "stars-market-store",
      partialize: (s) => ({
        items: s.items,
        mode: s.mode,
        adminAuthed: s.adminAuthed,
        tgUser: s.tgUser,
      }),
    }
  )
)
