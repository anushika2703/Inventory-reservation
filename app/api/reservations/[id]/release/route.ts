import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

      // Release reservation
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: 'RELEASED' },
        include: { product: true },
      });

      // Decrement reserved units (return to available pool)
      await tx.stock.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          reservedUnits: {
            decrement: reservation.quantity,
          },
        },
      });

      return updatedReservation;
    });

    return NextResponse.json({
      id: result.id,
      productId: result.productId,
      productName: result.product.name,
      warehouseId: result.warehouseId,
      quantity: result.quantity,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    });

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

    console.error('Error releasing reservation:', error);
    return NextResponse.json(
      { error: 'Failed to release reservation' },
      { status: 500 }
    );
  }
}
