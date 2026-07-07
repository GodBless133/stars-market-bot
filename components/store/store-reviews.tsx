"use client"

import { Stars } from "@/components/stars"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { timeAgo } from "@/lib/store"
import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Quote } from "lucide-react"

interface Review {
  id: string
  author: string
  rating: number
  text: string
  createdAt: string
  product?: { title: string }
}

export function StoreReviews() {
  const [reviews, setReviews] = useState<Review[]>([])

  useEffect(() => {
    api.get<{ reviews: Review[] }>(`/api/reviews?published=1`).then((d) => {
      setReviews(d.reviews.slice(0, 8))
    })
  }, [])

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold">Отзывы клиентов</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Более 10 000 довольных покупателей
        </p>
      </div>

      {reviews.length === 0 ? null : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border bg-white dark:bg-zinc-900 p-5 relative"
            >
              <Quote className="absolute top-4 right-4 h-6 w-6 text-zinc-100 dark:text-zinc-800" />
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-600 text-white text-xs">
                    {r.author.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{r.author}</p>
                  <Stars value={r.rating} size={11} />
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                «{r.text}»
              </p>
              <p className="mt-3 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
