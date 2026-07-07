#!/usr/bin/env bash
set -e

echo "🚂 [bot] Railway build..."

# Generate Prisma client. Schema declares provider = "postgresql" — must match DATABASE_URL.
# No runtime sed-rewrites of schema.prisma (was fragile, broke reproducibility).
echo "🔧 prisma generate..."
bunx prisma generate

# Tables are created at startup via `prisma db push` in start.sh
echo "✅ [bot] build complete — tables will be created at startup (start.sh)"
