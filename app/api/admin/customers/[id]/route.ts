import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { banned } = body as { banned?: boolean }
  const data: any = {}
  if (typeof banned === "boolean") data.banned = banned
  const customer = await db.customer.update({ where: { id }, data })
  return NextResponse.json({ customer })
}
