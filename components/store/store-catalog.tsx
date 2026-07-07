"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { useStore } from "@/lib/store-state"
import { ProductCard, type Product } from "./product-card"
import { ProductModal } from "./product-modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Package } from "lucide-react"
import { cn } from "@/lib/utils"

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  _count?: { products: number }
}

export function StoreCatalog() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState<Product | null>(null)
  const [sort, setSort] = useState("popular")

  const category = useStore((s) => s.selectedCategory)
  const setCategory = useStore((s) => s.setCategory)
  const search = useStore((s) => s.searchQuery)

  useEffect(() => {
    api.get<{ categories: Category[] }>("/api/categories").then((d) => {
      setCategories([{ id: "all", name: "Все", slug: "all", icon: "🛍️" }, ...d.categories])
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("sort", sort)
    if (category !== "all") params.set("category", category)
    if (search) params.set("q", search)
    api
      .get<{ products: Product[] }>(`/api/products?${params}`)
      .then((d) => setProducts(d.products))
      .finally(() => setLoading(false))
  }, [category, search, sort])

  return (
    <section id="catalog" className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold">Каталог</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? "Загрузка..." : `${products.length} товаров в наличии`}
          </p>
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[150px] sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">По популярности</SelectItem>
            <SelectItem value="price-asc">Сначала дешевле</SelectItem>
            <SelectItem value="price-desc">Сначала дороже</SelectItem>
            <SelectItem value="rating">По рейтингу</SelectItem>
            <SelectItem value="new">Новинки</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Categories chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 -mx-4 px-4">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.slug)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-all",
              category === c.slug
                ? "bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white"
                : "bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700"
            )}
          >
            <span>{c.icon}</span>
            {c.name}
            {c._count && (
              <span className="text-xs opacity-60">{c._count.products}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Ничего не найдено</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onView={setViewing} />
          ))}
        </div>
      )}

      {viewing && <ProductModal product={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
