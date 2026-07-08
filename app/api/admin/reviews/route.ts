import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// FIX 2: admin-only reviews list. Returns ALL reviews (incl. unpublished) for
// moderation. Protected by middleware (admin_session cookie). Public readers
// must use /api/reviews which forces published=true.
export async function GET(req: NextRequest) {
  const published = req.nextUrl.searchParams.get("published");
  const where: any = {};
  if (published === "0") where.published = false;
  if (published === "1") where.published = true;
  const reviews = await db.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { product: { select: { title: true } } },
  });
  return NextResponse.json({ reviews });
}
