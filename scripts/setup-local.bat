@echo off
echo Setting up local development environment...

REM Create local env file with SQLite
(
echo # Local Development ^(SQLite^)
echo DATABASE_URL="file:./dev.db"
echo REDIS_URL=""
echo CRON_SECRET="local-dev-secret"
) > .env.local

echo Installing dependencies...
call npm install

echo Setting up database...
call npx prisma generate
call npx prisma db push
call npm run db:seed

echo.
echo Local setup complete!
echo Run 'npm run dev' to start the server
pause
