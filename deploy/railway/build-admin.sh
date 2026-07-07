#!/usr/bin/env bash
set -e

echo "🚂 [admin] Railway build..."
echo "📦 npm install..."
npm install

echo "🔧 prisma generate..."
npx prisma generate

echo "🗄 prisma db push (creating tables if needed)..."
# --accept-data-loss removed: db push is safe by default.
# If a schema drift requires data loss, run `prisma migrate` manually instead.
npx prisma db push --skip-generate || echo "⚠️ db push warning (will retry at runtime if needed)"

echo "🌱 seeding database (idempotent)..."
# Seeds are idempotent (skip if already applied). Safe to run on every build.
npx tsx prisma/seed.ts || echo "⚠️ seed.ts warning"
npx tsx prisma/seed-additional.ts || echo "⚠️ seed-additional.ts warning"

echo "🏗 next build..."
npm run build
echo "✅ build complete"
