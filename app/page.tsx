'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Warehouse {
  warehouseId: string;
  warehouseName: string;
  warehouseLocation: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  price: number;
  warehouses: Warehouse[];
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/products');
      if (!response.ok) throw new Error('Failed to fetch products');
      const data = await response.json();
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleReserve = async (productId: string, warehouseId: string) => {
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity: 1,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        alert('❌ ' + data.error);
        fetchProducts(); // Refresh to show updated stock
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create reservation');
      }

      // Navigate to reservation page
      router.push(`/reservation/${data.id}`);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'An error occurred'));
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">Loading products...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Products</h2>
        <p className="mt-2 text-gray-600">
          Browse available products and reserve inventory from our warehouses
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <div
            key={product.id}
            className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200"
          >
            <div className="p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {product.name}
              </h3>
              <p className="text-sm text-gray-500 mb-1">SKU: {product.sku}</p>
              {product.description && (
                <p className="text-sm text-gray-600 mb-4">{product.description}</p>
              )}
              <p className="text-2xl font-bold text-gray-900 mb-4">
                ₹{(product.price / 100).toLocaleString('en-IN')}
              </p>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700">
                  Available at:
                </h4>
                {product.warehouses.map((warehouse) => (
                  <div
                    key={warehouse.warehouseId}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {warehouse.warehouseName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {warehouse.warehouseLocation}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        Available: <span className="font-semibold">{warehouse.availableUnits}</span>
                        {' '}/ Total: {warehouse.totalUnits}
                        {warehouse.reservedUnits > 0 && (
                          <span className="text-orange-600">
                            {' '}({warehouse.reservedUnits} reserved)
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => handleReserve(product.id, warehouse.warehouseId)}
                      disabled={warehouse.availableUnits === 0}
                      className={`ml-3 px-4 py-2 rounded-md text-sm font-medium ${
                        warehouse.availableUnits > 0
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      Reserve
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
