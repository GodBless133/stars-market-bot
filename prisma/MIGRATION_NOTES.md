# Prisma Migration Notes

## Schema

Both `prisma/schema.prisma` (Next.js app) and `mini-services/tg-bot/prisma/schema.prisma` (bot service) are **byte-identical** and use `provider = "postgresql"`.

## Field added: `StockItem.reservedOrderId`

```prisma
model StockItem {
  ...
  reservedOrderId String?   // ID заказа, под который зарезервирован
  @@index([reservedOrderId])
}
```

### Why
Previous code released reserved stock by `productId + status:"reserved"` — this could release another order's reserved stock on cancel. Now release is scoped by `reservedOrderId`.

### Migration impact
- Existing `reserved` rows (if any) will have `reservedOrderId = null`.
- The old productId-based release code is replaced; null-`reservedOrderId` reserved rows from before this change can be released manually:
  ```sql
  UPDATE "StockItem" SET status = 'available' WHERE status = 'reserved' AND "reservedOrderId" IS NULL;
  ```
- `sold` and `available` rows are unaffected.

## Database provider

Schema is locked to `postgresql`. If you need SQLite for local development:
1. Either install Postgres locally (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`)
2. Or maintain a separate `schema.sqlite.prisma` and run `prisma db push --schema schema.sqlite.prisma`

**Do NOT** sed-rewrite `schema.prisma` at runtime (was fragile, broke reproducibility — removed).

## Workflow

### Local development
```bash
bun install                              # root
npx prisma generate                      # generate client
npx prisma db push                       # create/sync tables (dev only)
bun run db:seed                          # seed initial data (idempotent)
```

### Production (Railway)
- `deploy/railway/build-admin.sh` runs: `npm install` → `prisma generate` → `prisma db push --skip-generate` → `tsx prisma/seed.ts` → `tsx prisma/seed-additional.ts` → `npm run build`
- `mini-services/tg-bot/build-railway.sh` runs: `npm install --omit=dev` → `prisma generate`
- `mini-services/tg-bot/start.sh` runs `prisma db push --skip-generate` at startup (creates tables if missing)
- Seeds are idempotent — safe to run on every deploy (skip if already applied)

### When to use `prisma migrate` instead of `db push`
Once you have **production data**, switch to migrations:
```bash
bun run db:migrate                       # applies pending migrations from prisma/migrations/
```
For now, no migration files exist — `db push` is used. The first schema-affecting change in production should create the initial migration baseline:
```bash
npx prisma migrate dev --name init       # locally, against a dev DB
npx prisma migrate resolve --applied     # mark baseline as applied on prod
```

## Prisma version

Both `package.json` (root) and `mini-services/tg-bot/package.json` use `prisma` + `@prisma/client` `^6.11.1` — keep them in sync. Earlier the bot used `^5.22.0` which generated an incompatible client.
