import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const settings = await db.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  })
  return NextResponse.json({ settings })
}

const ALLOWED = [
  "storeName",
  "tagline",
  "logo",
  "botUsername",
  "miniAppUrl",
  "supportContact",
  "currency",
]

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const data: any = {}
  for (const k of ALLOWED) {
    if (k in body && body[k] !== null) data[k] = String(body[k]).slice(0, 500)
  }
  const settings = await db.settings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  })
  return NextResponse.json({ settings })
}
