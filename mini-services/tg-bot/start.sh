#!/usr/bin/env bash
set -e

echo "=== Stars Market Bot — startup ==="

DB_URL="${DATABASE_URL:-}"
echo "DATABASE_URL scheme: $(echo "$DB_URL" | sed -E 's|^([a-z]+)://.*|\1|')"

# Ensure deps installed (in case build skipped)
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
  echo "→ npm install..."
  npm install 2>&1 | tail -3
fi

# Generate Prisma client
echo "→ prisma generate"
npx prisma generate

# Create tables
echo "→ prisma db push"
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠️ db push warning"

# Install tsx if not present
if ! npx tsx --version &>/dev/null; then
  echo "→ installing tsx..."
  npm install tsx 2>&1 | tail -2
fi

# Start bot
echo "→ starting bot"
exec npx tsx index.ts
# trigger
