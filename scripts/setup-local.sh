#!/bin/bash

echo "🔧 Setting up local development environment..."

# Use SQLite for local development
cat > .env.local << EOF
# Local Development (SQLite)
DATABASE_URL="file:./dev.db"
REDIS_URL=""
CRON_SECRET="local-dev-secret"
EOF

# Update schema temporarily
sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
sed -i '/directUrl/d' prisma/schema.prisma

echo "📦 Installing dependencies..."
npm install

echo "🗄️  Setting up database..."
npx prisma generate
npx prisma db push
npm run db:seed

echo "✅ Local setup complete!"
echo "🚀 Run 'npm run dev' to start the server"
