"use client"

import { useState } from "react"
import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck, Lock, ExternalLink } from "lucide-react"

export function AdminLogin({ onBack }: { onBack: () => void }) {
  const setAdminAuthed = useStore((s) => s.setAdminAuthed)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (res.status === 200) {
        setAdminAuthed(true)
      } else if (res.status === 401) {
        setError("Неверный пароль")
      } else {
        setError("Ошибка входа. Попробуйте позже.")
      }
    } catch {
      setError("Ошибка сети. Попробуйте позже.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle>Stars Market · Admin</CardTitle>
          <p className="text-sm text-muted-foreground">Панель управления магазином</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              placeholder="Пароль администратора"
              className="pl-9"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError("")
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={submit} disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onBack}>
            <ExternalLink className="h-4 w-4 mr-2" /> Открыть Mini App
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
