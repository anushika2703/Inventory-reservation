#!/bin/bash

echo "🚀 Setting up production database..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    echo "Please set it in Vercel dashboard or run: vercel env pull"
    exit 1
fi

echo "📦 Generating Prisma Client..."
npx prisma generate

echo "🗄️  Pushing database schema..."
npx prisma db push --accept-data-loss

echo "🌱 Seeding database..."
npm run db:seed

echo "✅ Production setup complete!"
echo "🎉 Your database is ready!"
