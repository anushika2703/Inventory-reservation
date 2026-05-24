#!/bin/bash

# Reset database script for local development

echo "🗑️  Resetting database..."

# Push schema (will reset if needed)
npm run db:push

# Seed with fresh data
npm run db:seed

echo "✅ Database reset complete!"
