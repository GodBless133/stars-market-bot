"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Store,
  Bot,
  Link2,
  Save,
  Copy,
  ExternalLink,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react"

interface Settings {
  id: string
  storeName: string
  tagline: string
  logo: string | null
  botUsername: string | null
  miniAppUrl: string | null
  supportContact: string | null
  currency: string
}

export function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [botHealth, setBotHealth] = useState<"up" | "down" | "checking">("checking")

  const load = () => {
    setLoading(true)
    api.get<{ settings: Settings }>("/api/admin/settings").then((d) => {
      setSettings(d.settings)
      setLoading(false)
    })
    checkBot()
  }

  const checkBot = async () => {
    setBotHealth("checking")
    try {
      const data = await api.get<{ ok: boolean; bot?: string }>("/api/bot-health")
      setBotHealth(data.ok ? "up" : "down")
    } catch {
      setBotHealth("down")
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await api.patch("/api/admin/settings", settings)
      toast.success("Настройки сохранены")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const miniAppUrl =
    settings?.miniAppUrl || (typeof window !== "undefined" ? `${window.location.origin}/?app=1#app` : "")

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Скопировано")
  }

  if (loading || !settings) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Настройки</h1>
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки магазина</h1>
        <p className="text-sm text-muted-foreground">
          Управление параметрами магазина, ботом и Mini App
        </p>
      </div>

      {/* Store */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-4 w-4 text-amber-500" />
            Магазин
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Название магазина</Label>
            <Input
              value={settings.storeName}
              onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Слоган / теглайн</Label>
            <Input
              value={settings.tagline}
              onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Контакт поддержки</Label>
            <Input
              placeholder="@support_username"
              value={settings.supportContact || ""}
              onChange={(e) => setSettings({ ...settings, supportContact: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Валюта</Label>
            <div className="flex gap-2">
              {["RUB", "USD", "EUR", "UAH"].map((c) => (
                <button
                  key={c}
                  onClick={() => setSettings({ ...settings, currency: c })}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
                    settings.currency === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mini App */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-sky-500" />
            Mini App (витрина для Telegram)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>URL Mini App</Label>
            <Input
              placeholder="https://..."
              value={settings.miniAppUrl || ""}
              onChange={(e) => setSettings({ ...settings, miniAppUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Оставьте пустым, чтобы использовать текущий адрес сайта
            </p>
          </div>

          <div className="rounded-xl border bg-zinc-50 dark:bg-zinc-900 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Активный URL для бота</span>
              <Badge variant="outline" className="text-sky-600 border-sky-500/30">
                Mini App
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono break-all">{miniAppUrl}</code>
              <Button size="icon" variant="ghost" onClick={() => copy(miniAppUrl)} title="Копировать">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => window.open(miniAppUrl, "_blank")}
                title="Открыть"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-emerald-500" />
            Telegram-бот
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Username бота</Label>
            <Input
              placeholder="@stars_market_bot"
              value={settings.botUsername || ""}
              onChange={(e) => setSettings({ ...settings, botUsername: e.target.value })}
            />
          </div>

          <div className="rounded-xl border bg-zinc-50 dark:bg-zinc-900 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Статус сервиса бота</p>
                <div className="flex items-center gap-2">
                  {botHealth === "up" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Работает (порт 3004)
                    </Badge>
                  ) : botHealth === "down" ? (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" /> Не отвечает
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Проверка...
                    </Badge>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={checkBot}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Проверить
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
              💡 Настройка бота
            </p>
            <p>
              Токен бота задаётся в файле{" "}
              <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">
                mini-services/tg-bot/.env
              </code>{" "}
              (переменная <code className="font-mono">BOT_TOKEN</code>). После изменения
              перезапустите сервис командой в папке бота.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <Button
          onClick={save}
          disabled={saving}
          size="lg"
          className="rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90 shadow-lg"
        >
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Сохранение..." : "Сохранить настройки"}
        </Button>
      </div>
    </div>
  )
}
