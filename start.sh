#!/usr/bin/env bash
set -e

# Root deploy script — always runs the bot from mini-services/tg-bot/.
# (Root index.ts was a stale duplicate and has been deleted.)
BOT_DIR="mini-services/tg-bot"

if [ ! -f "$BOT_DIR/index.ts" ]; then
  echo "❌ ERROR: $BOT_DIR/index.ts не найден."
  echo "Текущая папка: $(pwd)"
  ls -la
  exit 1
fi

cd "$BOT_DIR"
echo "Working directory: $(pwd)"

DB_URL="${DATABASE_URL:-}"

echo "=== Stars Market Bot — startup ==="
echo "DATABASE_URL scheme: $(echo "$DB_URL" | sed -E 's|^([a-z]+)://.*|\1|')"

# NOTE: We no longer sed-rewrite the provider in schema.prisma at runtime.
# The schema's declared provider (postgresql) must match DATABASE_URL at deploy time.
# If you need sqlite locally, edit prisma/schema.prisma directly or maintain a
# second schema file.

# Install dependencies. No double-install fallback — fail if install fails.
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
  echo "→ installing bot dependencies (npm install)..."
  npm install --omit=dev
fi

echo "→ prisma generate"
npx prisma generate

echo "→ prisma db push (creating tables if needed)"
# --accept-data-loss removed — db push is safe by default.
npx prisma db push --skip-generate 2>&1 || {
  echo "⚠️ db push failed — retrying in 5s..."
  sleep 5
  npx prisma db push --skip-generate 2>&1 || echo "⚠️ retry failed"
}

echo "→ starting bot"
if command -v bun &> /dev/null; then
  exec bun run index.ts
elif command -v tsx &> /dev/null; then
  exec tsx index.ts
else
  echo "→ installing tsx (TypeScript runner for Node.js)..."
  npm install --save tsx
  exec npx tsx index.ts
fi
