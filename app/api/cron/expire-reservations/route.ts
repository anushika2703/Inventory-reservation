import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if configured (for Vercel Cron)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET) {
      if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const now = new Date();

    // Find all pending reservations that have expired
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        status: 'PENDING',
        expiresAt: {
          lte: now,
        },
      },
    });

    console.log(`Found ${expiredReservations.length} expired reservations`);

    // Process each expired reservation
    for (const reservation of expiredReservations) {
      try {
        await prisma.$transaction(async (tx) => {
          // Mark as expired
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { status: 'EXPIRED' },
          });

          // Release reserved units
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
        });

        console.log(`Expired reservation ${reservation.id}`);
      } catch (error) {
        console.error(`Failed to expire reservation ${reservation.id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      expiredCount: expiredReservations.length,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('Error in expire-reservations cron:', error);
    return NextResponse.json(
      { error: 'Failed to expire reservations' },
      { status: 500 }
    );
  }
}
