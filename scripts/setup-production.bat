@echo off
echo Setting up production database...

if "%DATABASE_URL%"=="" (
    echo ERROR: DATABASE_URL environment variable is not set
    echo Please set it in Vercel dashboard or run: vercel env pull
    exit /b 1
)

echo Generating Prisma Client...
call npx prisma generate

echo Pushing database schema...
call npx prisma db push --accept-data-loss

echo Seeding database...
call npm run db:seed

echo.
echo Production setup complete!
echo Your database is ready!
pause
