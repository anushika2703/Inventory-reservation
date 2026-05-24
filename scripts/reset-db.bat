@echo off

echo Resetting database...

call npm run db:push

call npm run db:seed

echo Database reset complete!
