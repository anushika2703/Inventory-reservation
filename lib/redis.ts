import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) {
    console.warn('REDIS_URL not configured. Distributed locking disabled.');
    return null;
  }

  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redis.on('error', (err) => {
      console.error('Redis error:', err);
    });
  }

  return redis;
}

/**
 * Acquire a distributed lock using Redis SET NX EX
 * Returns true if lock was acquired, false otherwise
 */
export async function acquireLock(
  key: string,
  ttlSeconds: number = 10
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    // Fallback: no distributed locking, rely on database constraints
    return true;
  }

  try {
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (error) {
    console.error('Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release a distributed lock
 */
export async function releaseLock(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

/**
 * Store idempotency key with response data
 */
export async function storeIdempotencyKey(
  key: string,
  data: any,
  ttlSeconds: number = 86400 // 24 hours
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to store idempotency key:', error);
  }
}

/**
 * Get cached response for idempotency key
 */
export async function getIdempotencyKey(key: string): Promise<any | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to get idempotency key:', error);
    return null;
  }
}
