# Prisma Schema Migration Notes

## [Unreleased] — Add `StockItem.reservedOrderId`

### Context
The stock reservation/release flow previously released stock only by `productId`,
which is unsafe when multiple concurrent orders reserve stock for the same product.
To scope reservations per-order, a new optional field `reservedOrderId` is added to
`StockItem`. It stores the ID of the `Order` that the row is currently reserved for.

### Schema change

In both `prisma/schema.prisma` (root, Next.js app) and
`mini-services/tg-bot/prisma/schema.prisma` (Telegram bot), the `StockItem` model
receives:

```prisma
model StockItem {
  // ... existing fields ...
  reservedOrderId String?   // ID заказа, под который зарезервирован (для scoped release)

  @@index([productId, status])
  @@index([reservedOrderId])
}
```

Both schema files MUST stay byte-identical so the Next.js app and the Telegram
bot share the same Prisma Client shape against the same database.

### Migration path (non-destructive, additive)

- Field is **nullable** and has **no default** — additive change, safe for
  `prisma db push` / `prisma migrate deploy` against existing data.
- Existing rows with `status = "reserved"` will get `reservedOrderId = NULL`.
  This is acceptable: legacy `reserved` rows can still be released by the old
  `productId`-based fallback logic, or released manually.
- New reservations SHOULD set `reservedOrderId = <order.id>` at reserve time so
  the scoped release (`WHERE reservedOrderId = <order.id>`) only touches rows
  that belong to that specific order.
- A new index `@@index([reservedOrderId])` supports efficient
  `WHERE reservedOrderId = ?` lookups during scoped release.

### Deploy steps

1. Pull the updated schema files.
2. From the project root run:
   ```bash
   npm run db:push      # or: npm run db:migrate  (prisma migrate deploy)
   npm run db:generate  # regenerate Prisma Client
   ```
3. From `mini-services/tg-bot/` run:
   ```bash
   npm run db:push
   npm run db:generate
   ```
4. Restart both the Next.js app and the Telegram bot so they pick up the
   regenerated Prisma Client.

### Backward compatibility / fallback

Code that releases stock may keep a fallback path: if `reservedOrderId` is NULL
on a reserved row, fall back to releasing by `productId`. This keeps old
reservations working without a data backfill.

### Rollback

Drop the column and index:

```sql
ALTER TABLE "StockItem" DROP COLUMN "reservedOrderId";
DROP INDEX IF EXISTS "StockItem_reservedOrderId_idx";
```

No data loss occurs because `reservedOrderId` is derived state, not authoritative
order data.
