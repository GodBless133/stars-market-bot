#!/usr/bin/env bash
set -e
echo "🚂 [admin] Railway build..."
echo "📦 npm install..."
npm install
echo "🔧 prisma generate..."
npx prisma generate
echo "🗄 prisma db push..."
npx prisma db push --skip-generate --accept-data-loss || echo "⚠️ db push warning"
echo "🏗 next build..."
npm run build
echo "✅ build complete"
