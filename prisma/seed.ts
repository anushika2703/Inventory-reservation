import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.reservation.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // Create warehouses
  const warehouse1 = await prisma.warehouse.create({
    data: {
      name: 'Mumbai Central',
      location: 'Mumbai, Maharashtra',
    },
  });

  const warehouse2 = await prisma.warehouse.create({
    data: {
      name: 'Delhi North',
      location: 'Delhi, NCR',
    },
  });

  const warehouse3 = await prisma.warehouse.create({
    data: {
      name: 'Bangalore Tech Park',
      location: 'Bangalore, Karnataka',
    },
  });

  console.log('✅ Created warehouses');

  // Create products
  const products = [
    {
      name: 'iPhone 15 Pro',
      sku: 'IPHONE-15-PRO-256',
      description: 'Latest iPhone with A17 Pro chip, 256GB storage',
      price: 129900,
    },
    {
      name: 'Samsung Galaxy S24',
      sku: 'SAMSUNG-S24-128',
      description: 'Flagship Samsung phone with AI features, 128GB',
      price: 79999,
    },
    {
      name: 'MacBook Air M3',
      sku: 'MACBOOK-AIR-M3-512',
      description: '13-inch MacBook Air with M3 chip, 512GB SSD',
      price: 134900,
    },
    {
      name: 'Sony WH-1000XM5',
      sku: 'SONY-WH1000XM5-BLK',
      description: 'Premium noise-cancelling headphones',
      price: 29990,
    },
    {
      name: 'iPad Pro 11"',
      sku: 'IPAD-PRO-11-256',
      description: '11-inch iPad Pro with M2 chip, 256GB',
      price: 81900,
    },
  ];

  for (const productData of products) {
    const product = await prisma.product.create({
      data: productData,
    });

    // Create stock for each warehouse with varying quantities
    await prisma.stock.create({
      data: {
        productId: product.id,
        warehouseId: warehouse1.id,
        totalUnits: Math.floor(Math.random() * 50) + 10, // 10-60 units
        reservedUnits: 0,
      },
    });

    await prisma.stock.create({
      data: {
        productId: product.id,
        warehouseId: warehouse2.id,
        totalUnits: Math.floor(Math.random() * 50) + 10,
        reservedUnits: 0,
      },
    });

    await prisma.stock.create({
      data: {
        productId: product.id,
        warehouseId: warehouse3.id,
        totalUnits: Math.floor(Math.random() * 50) + 10,
        reservedUnits: 0,
      },
    });
  }

  console.log('✅ Created products and stock');
  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
