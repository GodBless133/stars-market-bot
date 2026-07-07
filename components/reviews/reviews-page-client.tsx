"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Stars } from "@/components/stars"
import { ProductCover } from "@/components/product-cover"
import { toast } from "sonner"
import {
  Star,
  MessageSquare,
  TrendingUp,
  Users,
  ChevronLeft,
  Send,
  Quote,
  CheckCircle2,
  Sparkles,
} from "lucide-react"
import Link from "next/link"
import { formatPrice, timeAgo } from "@/lib/store"

interface Review {
  id: string
  author: string
  rating: number
  text: string
  createdAt: string
  product?: { title: string; image: string | null } | null
}

interface Props {
  initialReviews: Review[]
  avgRating: number
  totalReviews: number
  distribution: { star: number; count: number; percent: number }[]
}

export function ReviewsPageClient({ initialReviews, avgRating, totalReviews, distribution }: Props) {
  const [reviews, setReviews] = useState(initialReviews)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ author: "", rating: 5, text: "" })

  const submit = async () => {
    if (!form.author.trim() || !form.text.trim()) {
      toast.error("Заполните имя и текст отзыва")
      return
    }
    if (form.text.length < 10) {
      toast.error("Отзыв слишком короткий (минимум 10 символов)")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Ошибка")
      toast.success("Спасибо! Отзыв опубликован.")
      setReviews([
        {
          id: data.review.id,
          author: form.author,
          rating: form.rating,
          text: form.text,
          createdAt: new Date().toISOString(),
          product: null,
        },
        ...reviews,
      ])
      setForm({ author: "", rating: 5, text: "" })
      setShowForm(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center gap-3">
          <a
            href="https://t.me/StarsMarkeet_bot"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Назад в бота
          </a>
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-bold">Stars Market</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <Badge className="mb-3 bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Star className="h-3 w-3 mr-1 fill-amber-400 text-amber-400" />
            Отзывы покупателей
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Нам доверяют тысячи клиентов
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Реальные отзывы о покупках в нашем магазине. Делитесь опытом — это помогает другим
            сделать выбор.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {/* Average rating */}
          <Card className="relative overflow-hidden">
            <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-amber-500/10" />
            <CardContent className="p-5 relative">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Средний рейтинг</p>
                <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold">{avgRating.toFixed(1)}</span>
                <Stars value={avgRating} size={16} className="mb-1" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">из 5.0</p>
            </CardContent>
          </Card>

          {/* Total reviews */}
          <Card className="relative overflow-hidden">
            <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-sky-500/10" />
            <CardContent className="p-5 relative">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Всего отзывов</p>
                <MessageSquare className="h-4 w-4 text-sky-500" />
              </div>
              <p className="mt-2 text-3xl font-bold">{totalReviews}</p>
              <p className="text-xs text-muted-foreground mt-1">проверенных покупателей</p>
            </CardContent>
          </Card>

          {/* Satisfied */}
          <Card className="relative overflow-hidden">
            <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-emerald-500/10" />
            <CardContent className="p-5 relative">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Довольны покупкой</p>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="mt-2 text-3xl font-bold">
                {totalReviews > 0
                  ? Math.round((distribution.filter(d => d.star >= 4).reduce((s, d) => s + d.count, 0) / totalReviews) * 100)
                  : 0}
                %
              </p>
              <p className="text-xs text-muted-foreground mt-1">оценили на 4–5 звёзд</p>
            </CardContent>
          </Card>
        </div>

        {/* Distribution + CTA */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium mb-3">Распределение оценок</p>
              <div className="space-y-2">
                {distribution.map(d => (
                  <div key={d.star} className="flex items-center gap-3">
                    <span className="text-xs w-12 flex items-center gap-1">
                      {d.star} <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                        style={{ width: `${d.percent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{d.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-500/20">
            <CardContent className="p-5 flex flex-col items-center justify-center text-center">
              <Quote className="h-8 w-8 text-amber-500 mb-2" />
              <p className="font-semibold mb-1">Поделитесь своим опытом</p>
              <p className="text-sm text-muted-foreground mb-4">
                Ваш отзыв поможет другим покупателям выбрать лучший товар
              </p>
              <Button
                onClick={() => setShowForm(!showForm)}
                className="rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
              >
                <Send className="h-4 w-4 mr-1" />
                {showForm ? "Скрыть форму" : "Оставить отзыв"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Review form */}
        {showForm && (
          <Card className="mb-8 border-amber-500/30">
            <CardContent className="p-5">
              <div className="grid gap-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Ваше имя *</label>
                    <Input
                      placeholder="Например, Алексей"
                      value={form.author}
                      onChange={e => setForm({ ...form, author: e.target.value })}
                      maxLength={50}
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Оценка *</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(r => (
                        <button
                          key={r}
                          onClick={() => setForm({ ...form, rating: r })}
                          className="p-1 hover:scale-110 transition-transform"
                          type="button"
                        >
                          <Star
                            className={`h-7 w-7 ${
                              r <= form.rating
                                ? "fill-amber-400 text-amber-400"
                                : "fill-zinc-200 text-zinc-200 dark:fill-zinc-700 dark:text-zinc-700"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Текст отзыва * (минимум 10 символов)</label>
                  <Textarea
                    placeholder="Расскажите о вашем опыте покупки. Что понравилось? Быстро ли доставили товар?"
                    rows={4}
                    value={form.text}
                    onChange={e => setForm({ ...form, text: e.target.value })}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground text-right">{form.text.length}/500</p>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setShowForm(false)}>
                    Отмена
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={submitting}
                    className="bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
                  >
                    {submitting ? "Публикация..." : "Опубликовать отзыв"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reviews list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" />
              Все отзывы ({reviews.length})
            </h2>
          </div>

          {reviews.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 text-zinc-300" />
                <p className="font-medium">Пока нет отзывов</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Будьте первым — поделитесь своим опытом!
                </p>
                <Button
                  className="mt-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
                  onClick={() => setShowForm(true)}
                >
                  <Send className="h-4 w-4 mr-1" /> Оставить первый отзыв
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {reviews.map(review => (
                <Card key={review.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-600 text-white text-sm font-bold">
                        {review.author.slice(0, 2).toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{review.author}</span>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            <span className="text-xs text-muted-foreground">Проверенная покупка</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(review.createdAt)}
                          </span>
                        </div>

                        {/* Rating */}
                        <div className="mt-1">
                          <Stars value={review.rating} size={14} />
                        </div>

                        {/* Text */}
                        <p className="mt-2 text-sm leading-relaxed">{review.text}</p>

                        {/* Product tag */}
                        {review.product && (
                          <div className="mt-3 flex items-center gap-2">
                            <div className="h-8 w-8 rounded-md overflow-hidden flex-shrink-0">
                              <ProductCover
                                image={review.product.image || undefined}
                                title={review.product.title}
                                className="h-full w-full"
                              />
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {review.product.title}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="mt-12 text-center">
          <Card className="bg-gradient-to-br from-zinc-900 to-zinc-800 text-white border-0">
            <CardContent className="p-8">
              <Sparkles className="h-8 w-8 mx-auto mb-3 text-amber-400" />
              <h3 className="text-xl font-bold">Готовы сделать покупку?</h3>
              <p className="text-sm text-zinc-300 mt-1 mb-4">
                Присоединяйтесь к тысячам довольных клиентов
              </p>
              <a
                href="https://t.me/StarsMarkeet_bot"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 h-10 px-8 bg-gradient-to-br from-amber-500 to-orange-600 text-white hover:opacity-90"
              >
                Вернуться в бота
              </a>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
