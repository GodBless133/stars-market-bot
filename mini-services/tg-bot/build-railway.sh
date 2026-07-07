#!/usr/bin/env bash
set -e

echo "🚂 [bot] Railway build..."

# Install dependencies
echo "📦 npm install..."
npm install --omit=dev

# Generate Prisma client (must match the schema's declared provider = postgresql)
echo "🔧 prisma generate..."
npx prisma generate

# NOTE: schema.prisma declares provider = "postgresql" — matches Railway's DATABASE_URL.
# No runtime sed-rewrites. If you run locally on SQLite, edit prisma/schema.prisma manually
# or keep a separate schema file (see prisma/MIGRATION_NOTES.md).

# Tables are created at startup via `prisma db push` in start.sh
echo "✅ [bot] build complete — tables will be created at startup (start.sh)"
