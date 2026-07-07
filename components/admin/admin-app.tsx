"use client"

import { useStore } from "@/lib/store-state"
import { AdminLogin } from "./admin-login"
import { AdminShell } from "./admin-shell"

export function AdminApp({ onExit }: { onExit: () => void }) {
  const authed = useStore((s) => s.adminAuthed)
  if (!authed) return <AdminLogin onBack={onExit} />
  return <AdminShell onExit={onExit} />
}
