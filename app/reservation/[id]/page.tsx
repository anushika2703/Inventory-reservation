'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

interface Reservation {
  id: string;
  productId: string;
  productName: string;
  warehouseId: string;
  quantity: number;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export default function ReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [processing, setProcessing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchReservation();
  }, [resolvedParams.id]);

  useEffect(() => {
    if (!reservation || reservation.status !== 'PENDING') return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expiry = new Date(reservation.expiresAt).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
        // Refresh to show expired status
        fetchReservation();
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [reservation]);

  const fetchReservation = async () => {
    try {
      setLoading(true);
      // In a real app, you'd have a GET endpoint for individual reservations
      // For now, we'll just keep the state from creation
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!reservation) return;

    try {
      setProcessing(true);
      const response = await fetch(`/api/reservations/${reservation.id}/confirm`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.status === 410) {
        alert('❌ ' + data.error);
        setReservation({ ...reservation, status: 'EXPIRED' });
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to confirm reservation');
      }

      setReservation(data);
      alert('✅ Purchase confirmed! Your order has been placed.');
      setTimeout(() => router.push('/'), 2000);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'An error occurred'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!reservation) return;

    if (!confirm('Are you sure you want to cancel this reservation?')) {
      return;
    }

    try {
      setProcessing(true);
      const response = await fetch(`/api/reservations/${reservation.id}/release`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel reservation');
      }

      setReservation(data);
      alert('Reservation cancelled successfully.');
      setTimeout(() => router.push('/'), 2000);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'An error occurred'));
    } finally {
      setProcessing(false);
    }
  };

  // Initial load from URL - simulate fetching
  useEffect(() => {
    // In a production app, fetch from API
    // For demo, we'll create a mock reservation
    const mockReservation: Reservation = {
      id: resolvedParams.id,
      productId: 'mock',
      productName: 'Loading...',
      warehouseId: 'mock',
      quantity: 1,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    setReservation(mockReservation);
    setLoading(false);
  }, [resolvedParams.id]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">Loading reservation...</div>
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-red-600">
          Error: {error || 'Reservation not found'}
        </div>
      </div>
    );
  }

  const isExpired = reservation.status === 'EXPIRED' || timeLeft === 0;
  const isConfirmed = reservation.status === 'CONFIRMED';
  const isReleased = reservation.status === 'RELEASED';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Reservation Details
          </h2>
          <p className="text-sm text-gray-500">ID: {reservation.id}</p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Product:</span>
            <span className="font-semibold">{reservation.productName}</span>
          </div>
          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Quantity:</span>
            <span className="font-semibold">{reservation.quantity}</span>
          </div>
          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Status:</span>
            <span
              className={`font-semibold ${
                isConfirmed
                  ? 'text-green-600'
                  : isExpired
                  ? 'text-red-600'
                  : isReleased
                  ? 'text-gray-600'
                  : 'text-orange-600'
              }`}
            >
              {reservation.status}
            </span>
          </div>
          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Created:</span>
            <span className="font-semibold">
              {new Date(reservation.createdAt).toLocaleString()}
            </span>
          </div>
        </div>

        {reservation.status === 'PENDING' && !isExpired && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Time remaining:</p>
                <p
                  className={`text-5xl font-bold ${
                    timeLeft < 60 ? 'text-red-600' : 'text-blue-600'
                  }`}
                >
                  {formatTime(timeLeft)}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Expires at: {new Date(reservation.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleConfirm}
                disabled={processing}
                className="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {processing ? 'Processing...' : 'Confirm Purchase'}
              </button>
              <button
                onClick={handleCancel}
                disabled={processing}
                className="flex-1 bg-red-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {processing ? 'Processing...' : 'Cancel'}
              </button>
            </div>
          </>
        )}

        {isExpired && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <p className="text-center text-red-600 font-semibold">
              ⏰ This reservation has expired
            </p>
            <p className="text-center text-sm text-gray-600 mt-2">
              The reserved units have been returned to available stock.
            </p>
          </div>
        )}

        {isConfirmed && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
            <p className="text-center text-green-600 font-semibold text-lg">
              ✅ Purchase Confirmed!
            </p>
            <p className="text-center text-sm text-gray-600 mt-2">
              Your order has been successfully placed.
            </p>
          </div>
        )}

        {isReleased && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
            <p className="text-center text-gray-600 font-semibold">
              Reservation Cancelled
            </p>
            <p className="text-center text-sm text-gray-600 mt-2">
              The reserved units have been returned to available stock.
            </p>
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={() => router.push('/')}
            className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300"
          >
            Back to Products
          </button>
        </div>
      </div>
    </div>
  );
}
