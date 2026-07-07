"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { formatPrice, PRODUCT_TYPES } from "@/lib/store"
import { ProductCover } from "@/components/product-cover"
import { Stars } from "@/components/stars"
import { Plus, Search, Pencil, Trash2, Package, Upload, X } from "lucide-react"

interface Category {
  id: string
  name: string
  slug: string
  icon: string
}

interface Product {
  id: string
  title: string
  slug: string
  description: string
  price: number
  oldPrice: number | null
  categoryId: string
  type: string
  badge: string | null
  image: string | null
  rating: number
  salesCount: number
  featured: boolean
  active: boolean
  inStock: number
  category?: Category
}

export function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get<{ products: Product[] }>(`/api/admin/products?q=${encodeURIComponent(search)}`),
      api.get<{ categories: Category[] }>("/api/categories"),
    ])
      .then(([p, c]) => {
        setProducts(p.products)
        setCategories(c.categories)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const remove = async (p: Product) => {
    if (!confirm(`Удалить «${p.title}»?`)) return
    await api.delete(`/api/admin/products/${p.id}`)
    toast.success("Товар удалён")
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Товары</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} позиций в каталоге
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> Добавить товар
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск товаров..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <div
              key={p.id}
              className="group rounded-xl border bg-white dark:bg-zinc-900 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="flex">
                <ProductCover
                  image={p.image || undefined}
                  title={p.title}
                  className="h-28 w-28 flex-shrink-0"
                />
                <div className="p-3 min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm leading-tight line-clamp-2">
                      {p.title}
                    </p>
                    {p.badge && <Badge variant="secondary">{p.badge}</Badge>}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Stars value={p.rating} size={12} />
                    <span className="text-xs text-muted-foreground">
                      {p.salesCount} прод.
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-semibold text-sm">{formatPrice(p.price)}</span>
                    {p.oldPrice && (
                      <span className="text-xs text-muted-foreground line-through">
                        {formatPrice(p.oldPrice)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant={p.inStock > 0 ? "outline" : "destructive"}>
                      {p.inStock} шт.
                    </Badge>
                    {p.featured && <Badge className="bg-amber-500">★ Хит</Badge>}
                    {!p.active && <Badge variant="destructive">Скрыт</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-none"
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Изменить
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-none text-destructive hover:text-destructive"
                  onClick={() => remove(p)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
                </Button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-2 opacity-40" />
              Товары не найдены
            </div>
          )}
        </div>
      )}

      {(creating || editing) && (
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function ProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    title: product?.title || "",
    description: product?.description || "",
    longDesc: product?.longDesc || "",
    price: product?.price ?? 0,
    oldPrice: product?.oldPrice ?? 0,
    categoryId: product?.categoryId || categories[0]?.id || "",
    type: product?.type || "digital",
    badge: product?.badge || "",
    image: product?.image || "stars",
    featured: product?.featured ?? false,
    active: product?.active ?? true,
    stockCount: 0,
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.title || !form.description || !form.categoryId) {
      toast.error("Заполните обязательные поля")
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        title: form.title,
        description: form.description,
        longDesc: form.longDesc,
        price: Number(form.price),
        oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
        categoryId: form.categoryId,
        type: form.type,
        badge: form.badge || null,
        image: form.image,
        featured: form.featured,
        active: form.active,
      }
      if (!product) payload.stockCount = Number(form.stockCount)
      if (product) {
        await api.patch(`/api/admin/products/${product.id}`, payload)
        toast.success("Товар обновлён")
      } else {
        await api.post("/api/admin/products", payload)
        toast.success("Товар создан")
      }
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Редактировать товар" : "Новый товар"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Название *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Краткое описание *</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Полное описание</Label>
            <Textarea
              rows={4}
              value={form.longDesc}
              onChange={(e) => setForm({ ...form, longDesc: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Цена *</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Старая цена</Label>
              <Input
                type="number"
                value={form.oldPrice}
                onChange={(e) => setForm({ ...form, oldPrice: Number(e.target.value) })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Бейдж</Label>
              <Input
                value={form.badge}
                onChange={(e) => setForm({ ...form, badge: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Категория *</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => setForm({ ...form, categoryId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Тип</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.icon} {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Обложка товара</Label>
            
            {/* Загрузка своей аватарки */}
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Загрузить изображение</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      toast.error("Файл слишком большой (макс 2 МБ)");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setForm({ ...form, image: reader.result as string });
                      toast.success("Изображение загружено");
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {form.image && form.image.startsWith("data:") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm({ ...form, image: "stars" })}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Удалить
                </Button>
              )}
            </div>
            
            {/* Выбор стандартной обложки */}
            {!form.image?.startsWith("data:") && (
              <Select
                value={form.image || ""}
                onValueChange={(v) => setForm({ ...form, image: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["stars", "premium", "account", "number", "gift", "bundle"].map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {/* Превью */}
            <div className="h-24 w-full rounded-lg overflow-hidden mt-1">
              {form.image?.startsWith("data:") ? (
                <img src={form.image} alt="cover" className="h-full w-full object-cover" />
              ) : (
                <ProductCover image={form.image || undefined} title={form.title} className="h-full w-full" />
              )}
            </div>
          </div>
          {!product && (
            <div className="grid gap-2">
              <Label>Кол-во на складе</Label>
              <Input
                type="number"
                value={form.stockCount}
                onChange={(e) => setForm({ ...form, stockCount: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                Сколько единиц создать (каждая = отдельный код/аккаунт для выдачи)
              </p>
            </div>
          )}
          {product && <StockManager productId={product.id} />}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => setForm({ ...form, featured: v })}
              />
              <span className="text-sm">Рекомендуемый</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              <span className="text-sm">Активен</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface StockItem {
  id: string
  content: string
  status: string
  createdAt: string
}

function StockManager({ productId }: { productId: string }) {
  const [stock, setStock] = useState<StockItem[]>([])
  const [count, setCount] = useState(5)
  const [content, setContent] = useState("")
  const [adding, setAdding] = useState(false)

  const load = () => {
    api.get<{ stock: StockItem[] }>(`/api/admin/products/${productId}/stock`).then((d) => {
      setStock(d.stock)
    })
  }

  useEffect(() => {
    load()
  }, [productId])

  const add = async () => {
    setAdding(true)
    try {
      await api.post(`/api/admin/products/${productId}/stock`, {
        count,
        content: content || undefined,
      })
      toast.success(`Добавлено: ${count} шт.`)
      setContent("")
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(false)
    }
  }

  const available = stock.filter((s) => s.status === "available").length
  const sold = stock.filter((s) => s.status === "sold").length

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Package className="h-4 w-4" /> Склад и выдача
        </Label>
        <div className="flex gap-1.5">
          <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
            В наличии: {available}
          </Badge>
          <Badge variant="secondary">Продано: {sold}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Input
          type="number"
          min={1}
          max={1000}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-20"
        />
        <Input
          placeholder="Свой код (иначе сгенерируется автоматически)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <Button size="sm" onClick={add} disabled={adding} className="w-full">
        <Plus className="h-3.5 w-3.5 mr-1" />
        {adding ? "Добавление..." : `Добавить ${count} шт. на склад`}
      </Button>

      {stock.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
          {stock.slice(0, 20).map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <Badge
                variant="outline"
                className={
                  s.status === "available"
                    ? "text-emerald-600 border-emerald-500/30"
                    : s.status === "sold"
                    ? "text-zinc-400"
                    : "text-amber-600 border-amber-500/30"
                }
              >
                {s.status === "available" ? "✓" : s.status === "sold" ? "✕" : "⏳"}
              </Badge>
              <code className="flex-1 font-mono truncate">{s.content}</code>
            </div>
          ))}
          {stock.length > 20 && (
            <p className="text-center text-xs text-muted-foreground py-1.5">
              ...и ещё {stock.length - 20}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
