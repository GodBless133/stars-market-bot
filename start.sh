#!/usr/bin/env bash
set -e

BOT_DIR="mini-services/tg-bot"

if [ -f "index.ts" ]; then
  BOT_DIR="."
elif [ -f "$BOT_DIR/index.ts" ]; then
  BOT_DIR="$BOT_DIR"
else
  echo "❌ ERROR: index.ts не найден ни в корне, ни в $BOT_DIR/"
  echo "Текущая папка: $(pwd)"
  ls -la
  exit 1
fi

cd "$BOT_DIR"
echo "Working directory: $(pwd)"

DB_URL="${DATABASE_URL:-}"

echo "=== Stars Market Bot — startup ==="
echo "DATABASE_URL scheme: $(echo "$DB_URL" | sed -E 's|^([a-z]+)://.*|\1|')"

if echo "$DB_URL" | grep -q "^postgres"; then
  PROVIDER="postgresql"
elif echo "$DB_URL" | grep -q "^file:"; then
  PROVIDER="sqlite"
else
  PROVIDER="postgresql"
fi

echo "Using Prisma provider: $PROVIDER"

sed -i "s|provider = \"sqlite\"|provider = \"$PROVIDER\"|g" prisma/schema.prisma
sed -i "s|provider = \"postgresql\"|provider = \"$PROVIDER\"|g" prisma/schema.prisma

# Убеждаемся что зависимости установлены
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
  echo "→ installing bot dependencies (npm install)..."
  npm install --omit=dev 2>&1 | tail -5 || npm install 2>&1 | tail -5
fi

echo "→ prisma generate"
npx prisma generate

echo "→ prisma db push (creating tables if needed)"
npx prisma db push --skip-generate --accept-data-loss 2>&1 || {
  echo "⚠️ db push failed — retrying in 5s..."
  sleep 5
  npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠️ retry failed"
}

echo "→ starting bot"
if command -v bun &> /dev/null; then
  exec bun run index.ts
elif command -v tsx &> /dev/null; then
  exec tsx index.ts
else
  echo "→ installing tsx (TypeScript runner for Node.js)..."
  npm install --save tsx 2>&1 | tail -3
  exec npx tsx index.ts
fi
