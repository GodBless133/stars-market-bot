"use client"

import { ProductCover } from "@/components/product-cover"
import { Stars } from "@/components/stars"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store-state"
import { formatPrice, PRODUCT_TYPES } from "@/lib/store"
import { ShoppingCart, Zap, Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

export interface Product {
  id: string
  title: string
  slug: string
  description: string
  price: number
  oldPrice: number | null
  image: string | null
  type: string
  badge: string | null
  rating: number
  salesCount: number
  inStock: number
  category?: { name: string; icon: string }
}

export function ProductCard({ product, onView }: { product: Product; onView: (p: Product) => void }) {
  const add = useStore((s) => s.add)
  const [added, setAdded] = useState(false)

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    add({
      productId: product.id,
      title: product.title,
      price: product.price,
      image: product.image || undefined,
    })
    setAdded(true)
    toast.success("Добавлено в корзину", { description: product.title })
    setTimeout(() => setAdded(false), 1500)
  }

  const discount = product.oldPrice
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0

  return (
    <div
      onClick={() => onView(product)}
      className="group cursor-pointer rounded-2xl border bg-white dark:bg-zinc-900 overflow-hidden hover:shadow-xl hover:shadow-orange-500/5 hover:-translate-y-0.5 transition-all"
    >
      <div className="relative">
        <ProductCover
          image={product.image || undefined}
          title={product.title}
          className="aspect-[5/3] w-full"
        />
        <div className="absolute top-2 left-2 flex flex-col gap-1.5">
          {product.badge && (
            <Badge className="bg-zinc-900/80 text-white backdrop-blur border-0">
              {product.badge}
            </Badge>
          )}
          {discount > 0 && (
            <Badge className="bg-rose-500 text-white border-0">−{discount}%</Badge>
          )}
        </div>
        {product.inStock <= 3 && product.inStock > 0 && (
          <Badge className="absolute bottom-2 right-2 bg-amber-500 text-white border-0">
            Осталось {product.inStock}
          </Badge>
        )}
        {product.inStock === 0 && (
          <div className="absolute inset-0 bg-zinc-900/60 flex items-center justify-center">
            <Badge variant="destructive">Нет в наличии</Badge>
          </div>
        )}
      </div>

      <div className="p-3.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <span>{PRODUCT_TYPES[product.type]?.icon}</span>
          <span>{product.category?.name}</span>
        </div>
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
          {product.title}
        </h3>

        <div className="mt-2 flex items-center gap-2">
          <Stars value={product.rating} size={12} />
          <span className="text-xs text-muted-foreground">
            · {product.salesCount} прод.
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg">{formatPrice(product.price)}</span>
            </div>
            {product.oldPrice && (
              <span className="text-xs text-muted-foreground line-through">
                {formatPrice(product.oldPrice)}
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={product.inStock === 0}
            className="rounded-full h-8 w-8 p-0 bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
          >
            {added ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
