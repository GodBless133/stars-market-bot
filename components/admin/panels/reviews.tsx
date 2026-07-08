"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Stars } from "@/components/stars"
import { formatDate, timeAgo } from "@/lib/store"
import { Eye, EyeOff, Trash2, Star } from "lucide-react"

interface Review {
  id: string
  author: string
  rating: number
  text: string
  published: boolean
  createdAt: string
  productId: string
  product?: { title: string }
}

export function AdminReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "published" | "hidden">("all")

  const load = () => {
    setLoading(true)
    api
      .get<{ reviews: Review[] }>(
        // FIX 2: fetch from admin endpoint so hidden/unpublished reviews are
        // visible for moderation. /api/reviews now forces published=true.
        `/api/admin/reviews${filter === "published" ? "?published=1" : filter === "hidden" ? "?published=0" : ""}`
      )
      .then((d) => {
        // attach product title — reviews endpoint doesn't include product, fetch separately
        setReviews(d.reviews)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const toggle = async (r: Review) => {
    await api.patch(`/api/admin/reviews/${r.id}`, { published: !r.published })
    toast.success(r.published ? "Отзыв скрыт" : "Отзыв опубликован")
    load()
  }

  const remove = async (r: Review) => {
    if (!confirm("Удалить отзыв?")) return
    await api.delete(`/api/admin/reviews/${r.id}`)
    toast.success("Отзыв удалён")
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Отзывы</h1>
          <p className="text-sm text-muted-foreground">Модерация отзывов клиентов</p>
        </div>
        <div className="flex gap-1">
          {(["all", "published", "hidden"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Все" : f === "published" ? "Опубликованные" : "Скрытые"}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Star className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Отзывов нет
        </div>
      ) : (
        <div className="grid gap-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.author}</span>
                    <Stars value={r.rating} size={13} />
                    <Badge variant={r.published ? "outline" : "secondary"}>
                      {r.published ? "Опубликован" : "Скрыт"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(r.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{r.text}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggle(r)}
                    title={r.published ? "Скрыть" : "Опубликовать"}
                  >
                    {r.published ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => remove(r)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
