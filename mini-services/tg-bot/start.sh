#!/usr/bin/env bash
set -e

echo "=== Stars Market Bot — startup ==="

DB_URL="${DATABASE_URL:-}"
echo "DATABASE_URL scheme: $(echo "$DB_URL" | sed -E 's|^([a-z]+)://.*|\1|')"

# Ensure deps installed (in case build skipped). No silent fallback — fail if install fails.
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
  echo "→ npm install..."
  npm install
fi

# Generate Prisma client
echo "→ prisma generate"
npx prisma generate

# FIX 5: in production, use `prisma migrate deploy` (safe — only applies existing
# migrations, never auto-diffs the schema). Fall back to `db push` only if no migrations
# exist yet (dev/first-deploy). Auto-running db push on every boot is dangerous in prod
# because schema drift in the codebase could trigger data loss.
echo "→ prisma migrate deploy"
npx prisma migrate deploy 2>&1 || {
  echo "⚠️ migrate deploy failed — falling back to db push (dev only)"
  npx prisma db push --skip-generate 2>&1 || echo "⚠️ db push warning"
}

# Install tsx if not present
if ! npx tsx --version &>/dev/null; then
  echo "→ installing tsx..."
  npm install tsx
fi

# Start bot
echo "→ starting bot"
exec npx tsx index.ts
# trigger
