# Allo Inventory Reservation System

A production-ready Next.js application for managing inventory reservations across multiple warehouses, solving the race condition problem in e-commerce checkout flows.

## 🎯 Problem Statement

When customers reach checkout, payment can take several minutes (3DS flows, UPI confirmations, wallet redirects). During this window:
- If we decrement stock only at payment time → two customers can pay for the same unit
- If we decrement at add-to-cart → inventory looks depleted despite 80% cart abandonment

**Solution**: Temporary reservations that hold units for a short window (10 minutes), then either confirm (payment success) or release (payment failure/timeout).

## 🏗️ Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript (end-to-end type safety)
- **Database**: PostgreSQL (via Prisma ORM)
- **Caching/Locking**: Redis (Upstash)
- **Validation**: Zod
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

### Data Model

```prisma
- Warehouse: id, name, location
- Product: id, name, sku, description, price
- Stock: productId, warehouseId, totalUnits, reservedUnits
- Reservation: id, productId, warehouseId, quantity, status, expiresAt, idempotencyKey
```

**Key insight**: `Stock.reservedUnits` tracks units temporarily held by pending reservations. Available stock = `totalUnits - reservedUnits`.

## 🔒 Concurrency Control

The reservation endpoint uses **three layers of protection** to prevent race conditions:

### 1. Distributed Locking (Redis)
```typescript
const lockKey = `lock:stock:${productId}:${warehouseId}`;
const lockAcquired = await acquireLock(lockKey, 10);
```
- Prevents multiple requests from entering the critical section simultaneously
- Uses Redis `SET NX EX` (atomic set-if-not-exists with expiry)
- Falls back gracefully if Redis is unavailable

### 2. Database Transaction with Serializable Isolation
```typescript
await prisma.$transaction(async (tx) => {
  // Check stock, create reservation, increment reservedUnits
}, {
  isolationLevel: 'Serializable'
});
```
- Strongest isolation level in PostgreSQL
- Prevents phantom reads and write skew
- Automatically retries on serialization failures

### 3. Database Constraints
```prisma
@@unique([productId, warehouseId]) // Prevents duplicate stock entries
```

**Result**: If two requests come in simultaneously for the last unit, exactly one succeeds (201), the other gets 409 Conflict.

## 📡 API Endpoints

| Method | Path | Description | Status Codes |
|--------|------|-------------|--------------|
| GET | `/api/products` | List products with available stock per warehouse | 200 |
| GET | `/api/warehouses` | List all warehouses | 200 |
| POST | `/api/reservations` | Reserve units (with concurrency control) | 201, 409, 503 |
| POST | `/api/reservations/:id/confirm` | Confirm reservation (payment succeeded) | 200, 410 |
| POST | `/api/reservations/:id/release` | Release reservation (payment failed) | 200, 400 |

### Error Handling
- **409 Conflict**: Insufficient stock available (shown to user)
- **410 Gone**: Reservation expired (shown to user)
- **503 Service Unavailable**: Could not acquire lock (retry)

## ⏰ Reservation Expiry

Reservations expire after 10 minutes if not confirmed. We use **three complementary approaches**:

### 1. Vercel Cron Job (Production)
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/expire-reservations",
    "schedule": "* * * * *"  // Every minute
  }]
}
```
- Runs every minute in production
- Finds all `PENDING` reservations where `expiresAt <= NOW()`
- Marks as `EXPIRED` and decrements `reservedUnits`
- Protected by `CRON_SECRET` header

### 2. Lazy Cleanup (Confirm Endpoint)
```typescript
if (new Date() > reservation.expiresAt) {
  await tx.reservation.update({ status: 'EXPIRED' });
  throw new Error('RESERVATION_EXPIRED');
}
```
- When user tries to confirm an expired reservation, we detect and mark it expired
- Returns 410 Gone to the client

### 3. Client-Side Timer
```typescript
// Countdown timer in UI
useEffect(() => {
  const interval = setInterval(() => {
    const diff = expiresAt - now;
    if (diff <= 0) fetchReservation(); // Refresh to show expired
  }, 1000);
}, []);
```
- Live countdown shows time remaining
- Automatically refreshes when timer hits zero

**Trade-off**: Cron runs every minute (not real-time), but this is acceptable because:
- Users see the countdown and know when it expires
- Lazy cleanup catches edge cases
- 1-minute delay in releasing stock is negligible for inventory management

## 🔄 Idempotency (Bonus)

Implemented using Redis to cache responses:

```typescript
// Client sends header
headers: { 'Idempotency-Key': 'unique-uuid' }

// Server checks cache
const cached = await getIdempotencyKey(`idempotency:${key}`);
if (cached) return cached; // Return original response

// Store response for 24 hours
await storeIdempotencyKey(key, { status, data }, 86400);
```

**Benefits**:
- Safe retries on network failures
- Prevents duplicate reservations from double-clicks
- Works for both `/reservations` (create) and `/reservations/:id/confirm`

## 🚀 Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (Supabase/Neon/Railway)
- Redis instance (Upstash recommended)

### Local Development

1. **Clone and install dependencies**
```bash
git clone <repo-url>
cd inventory-reservation
npm install
```

2. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname"
REDIS_URL="redis://default:password@host:6379"
CRON_SECRET="your-random-secret"  # Optional for local
```

3. **Set up database**
```bash
npm run db:push    # Push schema to database
npm run db:seed    # Seed with sample data
```

4. **Run development server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Production Deployment (Vercel)

1. **Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

2. **Deploy to Vercel**
- Import project from GitHub
- Add environment variables:
  - `DATABASE_URL` (from Supabase/Neon)
  - `REDIS_URL` (from Upstash)
  - `CRON_SECRET` (generate random string)
- Deploy

3. **Run migrations and seed**
```bash
# After first deploy
vercel env pull .env.production.local
npm run db:push
npm run db:seed
```

4. **Verify cron job**
- Go to Vercel Dashboard → Project → Cron Jobs
- Should see `/api/cron/expire-reservations` running every minute

## 🧪 Testing Concurrency

To test the race condition handling:

1. Open two browser tabs
2. Navigate to the same product with low stock (e.g., 1 unit available)
3. Click "Reserve" in both tabs simultaneously
4. One should succeed (navigate to reservation page)
5. Other should show "❌ Insufficient stock available"

## 📊 Database Seeding

The seed script creates:
- 3 warehouses (Mumbai, Delhi, Bangalore)
- 5 products (iPhone, Samsung, MacBook, Sony headphones, iPad)
- Random stock quantities (10-60 units per product per warehouse)

## 🎨 UI Features

### Product Listing Page
- Shows all products with prices
- Displays available stock per warehouse
- Real-time stock updates after reservations
- Disabled "Reserve" button when out of stock

### Reservation Page
- Live countdown timer (MM:SS format)
- Turns red when < 1 minute remaining
- "Confirm Purchase" button (simulates payment success)
- "Cancel" button (releases reservation early)
- Auto-refreshes when timer expires
- Shows 410 error if trying to confirm expired reservation

## 🔧 Trade-offs & Future Improvements

### Current Trade-offs
1. **Cron frequency**: Runs every minute instead of real-time
   - **Why**: Vercel Cron limitation, but acceptable for this use case
   - **Alternative**: Background worker with job queue (Bull/BullMQ)

2. **No reservation GET endpoint**: Reservation page uses client-side state
   - **Why**: Simplified for demo, reduces API surface
   - **Production**: Add `GET /api/reservations/:id` for page refreshes

3. **Single quantity**: Only allows reserving 1 unit at a time
   - **Why**: Simplified UI/UX for demo
   - **Production**: Add quantity selector

4. **No authentication**: Anyone can reserve
   - **Why**: Out of scope for this exercise
   - **Production**: Add NextAuth.js or similar

### Future Improvements
1. **Optimistic locking**: Add `version` field to Stock for additional safety
2. **Reservation history**: Track all state transitions for audit trail
3. **Webhook notifications**: Alert users when reservation is about to expire
4. **Multi-warehouse fulfillment**: Automatically split orders across warehouses
5. **Analytics dashboard**: Track reservation conversion rates, expiry rates
6. **Load testing**: Verify concurrency handling under high load (k6, Artillery)

## 📝 Key Learnings

1. **Distributed locking is hard**: Redis provides a good middle ground between complexity and correctness
2. **Database isolation levels matter**: Serializable prevents subtle race conditions
3. **Idempotency is essential**: Network failures are common, retries must be safe
4. **Expiry needs multiple layers**: Cron + lazy cleanup + client-side = robust
5. **User feedback is critical**: Show 409/410 errors clearly, don't swallow them

## 📄 License

MIT

## 👤 Author

Built for Allo's technical assessment.
