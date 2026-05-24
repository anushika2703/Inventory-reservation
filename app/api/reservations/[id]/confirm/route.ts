import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIdempotencyKey, storeIdempotencyKey } from '@/lib/redis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for idempotency key
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cachedResponse = await getIdempotencyKey(`idempotency:confirm:${idempotencyKey}`);
      if (cachedResponse) {
        console.log('Returning cached response for idempotency key:', idempotencyKey);
        return NextResponse.json(cachedResponse.data, { status: cachedResponse.status });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Get reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
        include: { product: true },
      });

      if (!reservation) {
        throw new Error('RESERVATION_NOT_FOUND');
      }

      if (reservation.status !== 'PENDING') {
        throw new Error('RESERVATION_NOT_PENDING');
      }

      // Check if expired
      if (new Date() > reservation.expiresAt) {
        // Mark as expired
        await tx.reservation.update({
          where: { id },
          data: { status: 'EXPIRED' },
        });
        throw new Error('RESERVATION_EXPIRED');
      }

      // Confirm reservation
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: 'CONFIRMED' },
        include: { product: true },
      });

      // Decrement total units and reserved units
      await tx.stock.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          totalUnits: {
            decrement: reservation.quantity,
          },
          reservedUnits: {
            decrement: reservation.quantity,
          },
        },
      });

      return updatedReservation;
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
      updatedAt: result.updatedAt.toISOString(),
    };

    // Store idempotency key if provided
    if (idempotencyKey) {
      await storeIdempotencyKey(`idempotency:confirm:${idempotencyKey}`, {
        status: 200,
        data: response,
      });
    }

    return NextResponse.json(response);

  } catch (error: any) {
    if (error.message === 'RESERVATION_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    if (error.message === 'RESERVATION_NOT_PENDING') {
      return NextResponse.json(
        { error: 'Reservation is not in pending state' },
        { status: 400 }
      );
    }

    if (error.message === 'RESERVATION_EXPIRED') {
      return NextResponse.json(
        { error: 'Reservation has expired' },
        { status: 410 }
      );
    }

    console.error('Error confirming reservation:', error);
    return NextResponse.json(
      { error: 'Failed to confirm reservation' },
      { status: 500 }
    );
  }
}
