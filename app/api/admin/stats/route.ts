import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const [
    totalProducts,
    totalOrders,
    totalCustomers,
    totalReviews,
    pendingOrders,
    completedOrders,
    revenueAgg,
    lowStockProducts,
  ] = await Promise.all([
    db.product.count(),
    db.order.count(),
    db.customer.count(),
    db.review.count(),
    db.order.count({ where: { status: "pending" } }),
    db.order.count({ where: { status: "completed" } }),
    db.order.aggregate({
      where: { status: "completed" },
      _sum: { total: true },
    }),
    db.product.findMany({
      where: { active: true },
      include: { _count: { select: { stock: { where: { status: "available" } } } } },
      take: 100,
    }),
  ])

  const lowStock = lowStockProducts
    .filter((p) => p._count.stock <= 3)
    .map((p) => ({ id: p.id, title: p.title, inStock: p._count.stock }))

  // Revenue last 14 days
  const since = new Date()
  since.setDate(since.getDate() - 13)
  since.setHours(0, 0, 0, 0)
  const recentOrders = await db.order.findMany({
    where: { status: "completed", createdAt: { gte: since } },
    select: { total: true, createdAt: true },
  })

  const days: { date: string; revenue: number; orders: number }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    const dayOrders = recentOrders.filter(
      (o) => o.createdAt.toISOString().slice(0, 10) === key
    )
    days.push({
      date: key,
      revenue: dayOrders.reduce((s, o) => s + o.total, 0),
      orders: dayOrders.length,
    })
  }

  // Top products by sales
  const topProducts = await db.product.findMany({
    orderBy: { salesCount: "desc" },
    take: 5,
    select: { id: true, title: true, salesCount: true, price: true },
  })

  // Category distribution
  const categories = await db.category.findMany({
    include: { _count: { select: { products: true } } },
  })

  return NextResponse.json({
    totals: {
      products: totalProducts,
      orders: totalOrders,
      customers: totalCustomers,
      reviews: totalReviews,
      pendingOrders,
      completedOrders,
      revenue: revenueAgg._sum.total ?? 0,
    },
    revenueChart: days,
    topProducts,
    categories,
    lowStock,
  })
}
