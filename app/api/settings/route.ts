import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const settings = await db.settings.findUnique({ where: { id: "singleton" } })
  return NextResponse.json({ settings })
}
