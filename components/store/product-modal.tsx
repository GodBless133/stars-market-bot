"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ProductCover } from "@/components/product-cover"
import { Stars } from "@/components/stars"
import { formatPrice, PRODUCT_TYPES, timeAgo } from "@/lib/store"
import { ShoppingCart, Check, ShieldCheck, Clock, Zap, Star } from "lucide-react"
import { toast } from "sonner"
import type { Product } from "./product-card"

interface Review {
  id: string
  author: string
  rating: number
  text: string
  createdAt: string
}

export function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const add = useStore((s) => s.add)
  const [added, setAdded] = useState(false)
  const [reviews, setReviews] = useState<Review[]>([])
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewForm, setReviewForm] = useState({ author: "", rating: 5, text: "" })

  useEffect(() => {
    api
      .get<{ reviews: Review[] }>(`/api/reviews?productId=${product.id}&published=1`)
      .then((d) => setReviews(d.reviews))
  }, [product.id])

  const handleAdd = () => {
    add({
      productId: product.id,
      title: product.title,
      price: product.price,
      image: product.image || undefined,
    })
    setAdded(true)
    toast.success("Добавлено в корзину")
    setTimeout(() => setAdded(false), 1500)
  }

  const submitReview = async () => {
    if (!reviewForm.author || !reviewForm.text) {
      toast.error("Заполните имя и текст")
      return
    }
    await api.post("/api/reviews", {
      productId: product.id,
      author: reviewForm.author,
      rating: reviewForm.rating,
      text: reviewForm.text,
    })
    toast.success("Отзыв опубликован!")
    setReviewForm({ author: "", rating: 5, text: "" })
    setShowReviewForm(false)
    api
      .get<{ reviews: Review[] }>(`/api/reviews?productId=${product.id}&published=1`)
      .then((d) => setReviews(d.reviews))
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden p-0">
        <div className="grid md:grid-cols-2 max-h-[92vh] overflow-hidden">
          {/* Left: image */}
          <div className="relative hidden md:block">
            <ProductCover
              image={product.image || undefined}
              title={product.title}
              className="h-full w-full"
            />
            {product.badge && (
              <Badge className="absolute top-4 left-4 bg-zinc-900/80 text-white">
                {product.badge}
              </Badge>
            )}
          </div>

          {/* Right: details + reviews */}
          <div className="flex flex-col max-h-[92vh] overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <span>{PRODUCT_TYPES[product.type]?.icon}</span>
                  <span>{product.category?.name}</span>
                  {product.inStock > 0 ? (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                      В наличии
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Нет в наличии</Badge>
                  )}
                </div>
                <h2 className="text-xl font-bold leading-tight">{product.title}</h2>
                <div className="mt-2 flex items-center gap-3">
                  <Stars value={product.rating} size={16} showValue />
                  <span className="text-sm text-muted-foreground">
                    · {product.salesCount} продаж
                  </span>
                </div>

                <p className="mt-3 text-sm text-muted-foreground">
                  {product.description}
                </p>

                {/* trust */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-2">
                    <ShieldCheck className="h-4 w-4 mx-auto text-emerald-500" />
                    <p className="text-[10px] mt-1 font-medium">Гарантия</p>
                  </div>
                  <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 p-2">
                    <Clock className="h-4 w-4 mx-auto text-sky-500" />
                    <p className="text-[10px] mt-1 font-medium">Мгновенно</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2">
                    <Zap className="h-4 w-4 mx-auto text-amber-500" />
                    <p className="text-[10px] mt-1 font-medium">24/7</p>
                  </div>
                </div>

                {/* price */}
                <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border p-3 bg-zinc-50 dark:bg-zinc-900">
                  <div>
                    {product.oldPrice && (
                      <span className="text-sm text-muted-foreground line-through mr-2">
                        {formatPrice(product.oldPrice)}
                      </span>
                    )}
                    <span className="text-2xl font-bold">
                      {formatPrice(product.price)}
                    </span>
                  </div>
                  <Button
                    onClick={handleAdd}
                    disabled={product.inStock === 0}
                    className="rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
                  >
                    {added ? (
                      <>
                        <Check className="h-4 w-4 mr-1" /> Добавлено
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="h-4 w-4 mr-1" /> В корзину
                      </>
                    )}
                  </Button>
                </div>

                {/* Reviews */}
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-400" />
                      Отзывы ({reviews.length})
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReviewForm(!showReviewForm)}
                    >
                      Оставить отзыв
                    </Button>
                  </div>

                  {showReviewForm && (
                    <div className="rounded-xl border p-3 mb-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Имя</Label>
                          <Input
                            value={reviewForm.author}
                            onChange={(e) =>
                              setReviewForm({ ...reviewForm, author: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Оценка</Label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((r) => (
                              <button
                                key={r}
                                onClick={() => setReviewForm({ ...reviewForm, rating: r })}
                                className="p-1"
                              >
                                <Star
                                  className={
                                    r <= reviewForm.rating
                                      ? "h-5 w-5 fill-amber-400 text-amber-400"
                                      : "h-5 w-5 fill-zinc-200 text-zinc-200"
                                  }
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <Textarea
                        rows={3}
                        placeholder="Поделитесь впечатлением..."
                        value={reviewForm.text}
                        onChange={(e) =>
                          setReviewForm({ ...reviewForm, text: e.target.value })
                        }
                      />
                      <Button size="sm" onClick={submitReview}>
                        Опубликовать
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {reviews.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Пока нет отзывов. Будьте первым!
                      </p>
                    ) : (
                      reviews.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{r.author}</span>
                              <Stars value={r.rating} size={11} />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {timeAgo(r.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{r.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
