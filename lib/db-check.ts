import { prisma } from './prisma';

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

export async function initializeDatabase() {
  const isConnected = await checkDatabaseConnection();
  
  if (!isConnected) {
    console.warn('⚠️  Database connection failed. Please check your DATABASE_URL');
    return false;
  }
  
  console.log('✅ Database connected successfully');
  return true;
}
