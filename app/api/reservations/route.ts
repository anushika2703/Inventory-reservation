import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createReservationSchema } from '@/lib/validations';
import { acquireLock, releaseLock, getIdempotencyKey, storeIdempotencyKey } from '@/lib/redis';
import { addMinutes } from 'date-fns';

const RESERVATION_DURATION_MINUTES = 10;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input
    const validation = createReservationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { productId, warehouseId, quantity } = validation.data;

    // Check for idempotency key
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cachedResponse = await getIdempotencyKey(`idempotency:${idempotencyKey}`);
      if (cachedResponse) {
        console.log('Returning cached response for idempotency key:', idempotencyKey);
        return NextResponse.json(cachedResponse.data, { status: cachedResponse.status });
      }
    }

    // Acquire distributed lock for this product-warehouse combination
    const lockKey = `lock:stock:${productId}:${warehouseId}`;
    const lockAcquired = await acquireLock(lockKey, 10);

    if (!lockAcquired) {
      return NextResponse.json(
        { error: 'Unable to acquire lock. Please try again.' },
        { status: 503 }
      );
    }

    try {
      // Use a transaction with serializable isolation to prevent race conditions
      const result = await prisma.$transaction(async (tx) => {
        // Get current stock with row-level lock (FOR UPDATE)
        const stock = await tx.stock.findUnique({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
        });

        if (!stock) {
          throw new Error('STOCK_NOT_FOUND');
        }

        const availableUnits = stock.totalUnits - stock.reservedUnits;

        if (availableUnits < quantity) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        // Create reservation
        const expiresAt = addMinutes(new Date(), RESERVATION_DURATION_MINUTES);
        const reservation = await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            quantity,
            expiresAt,
            status: 'PENDING',
            idempotencyKey: idempotencyKey || undefined,
          },
          include: {
            product: true,
          },
        });

        // Increment reserved units
        await tx.stock.update({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
          data: {
            reservedUnits: {
              increment: quantity,
            },
          },
        });

        return reservation;
      }, {
        isolationLevel: 'Serializable', // Strongest isolation level
        maxWait: 5000, // Wait up to 5 seconds for transaction to start
        timeout: 10000, // Transaction timeout
      });

      const response = {
        id: result.id,
        productId: result.productId,
        productName: result.product.name,
        warehouseId: result.warehouseId,
        quantity: result.quantity,
        status: result.status,
        expiresAt: result.expiresAt.toISOString(),
        createdAt: result.createdAt.toISOString(),
      };

      // Store idempotency key if provided
      if (idempotencyKey) {
        await storeIdempotencyKey(`idempotency:${idempotencyKey}`, {
          status: 201,
          data: response,
        });
      }

      return NextResponse.json(response, { status: 201 });

    } catch (error: any) {
      if (error.message === 'STOCK_NOT_FOUND') {
        return NextResponse.json(
          { error: 'Stock not found for this product and warehouse' },
          { status: 404 }
        );
      }

      if (error.message === 'INSUFFICIENT_STOCK') {
        return NextResponse.json(
          { error: 'Insufficient stock available' },
          { status: 409 }
        );
      }

      // Handle Prisma transaction conflicts
      if (error.code === 'P2034') {
        return NextResponse.json(
          { error: 'Transaction conflict. Please try again.' },
          { status: 409 }
        );
      }

      throw error;
    } finally {
      // Always release the lock
      await releaseLock(lockKey);
    }

  } catch (error) {
    console.error('Error creating reservation:', error);
    return NextResponse.json(
      { error: 'Failed to create reservation' },
      { status: 500 }
    );
  }
}
