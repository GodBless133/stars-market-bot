import { db } from "@/lib/db"
import { ReviewsPageClient } from "@/components/reviews/reviews-page-client"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ReviewsPage() {
  // Загружаем отзывы и статистику на сервере
  const [reviews, stats] = await Promise.all([
    db.review.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { product: { select: { title: true, image: true } } },
    }),
    db.review.aggregate({
      where: { published: true },
      _avg: { rating: true },
      _count: true,
    }),
  ])

  // Распределение по звёздам
  const distribution = [5, 4, 3, 2, 1].map(star => {
    const count = reviews.filter(r => r.rating === star).length
    const percent = reviews.length > 0 ? (count / reviews.length) * 100 : 0
    return { star, count, percent }
  })

  return (
    <ReviewsPageClient
      initialReviews={reviews.map(r => ({
        id: r.id,
        author: r.author,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        product: r.product ? { title: r.product.title, image: r.product.image } : null,
      }))}
      avgRating={stats._avg.rating ?? 0}
      totalReviews={stats._count}
      distribution={distribution}
    />
  )
}
