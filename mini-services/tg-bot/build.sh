#!/usr/bin/env bash
set -e

echo "🚂 [bot] Railway build..."

DB_URL="${DATABASE_URL:-}"
if echo "$DB_URL" | grep -q "^postgres"; then
  echo "→ switching schema to postgresql"
  sed -i 's|provider = "sqlite"|provider = "postgresql"|g' prisma/schema.prisma
fi

bunx prisma generate

echo "✅ [bot] build complete — tables will be created at startup"
