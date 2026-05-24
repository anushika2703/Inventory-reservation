# Architecture Documentation

## System Overview

The Allo Inventory Reservation System is a distributed application that manages inventory across multiple warehouses with temporary reservations to prevent race conditions during checkout.

## High-Level Architecture

```
┌─────────────┐
│   Browser   │
│  (Next.js)  │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────────────────────────────┐
│         Next.js App Router          │
│  ┌──────────────────────────────┐  │
│  │     API Routes (Edge/Node)   │  │
│  │  - /api/products             │  │
│  │  - /api/reservations         │  │
│  │  - /api/cron/expire          │  │
│  └──────────────────────────────┘  │
└───────┬─────────────────┬───────────┘
        │                 │
        ▼                 ▼
┌──────────────┐   ┌──────────────┐
│  PostgreSQL  │   │    Redis     │
│   (Supabase) │   │  (Upstash)   │
│              │   │              │
│ - Products   │   │ - Locks      │
│ - Stock      │   │ - Idempotency│
│ - Reservations│  │              │
└──────────────┘   └──────────────┘
```

## Component Breakdown

### 1. Frontend (React/Next.js)

**Location**: `app/page.tsx`, `app/reservation/[id]/page.tsx`

**Responsibilities**:
- Display product listings with real-time stock
- Handle user interactions (reserve, confirm, cancel)
- Show countdown timer for reservations
- Display error messages (409, 410)

**Key Features**:
- Client-side state management (useState)
- Real-time countdown with useEffect
- Optimistic UI updates
- Error handling with user feedback

### 2. API Layer (Next.js Route Handlers)

**Location**: `app/api/**/*.ts`

**Endpoints**:

| Endpoint | Method | Purpose | Concurrency Control |
|----------|--------|---------|---------------------|
| `/api/products` | GET | List products with stock | Read-only, no locking |
| `/api/warehouses` | GET | List warehouses | Read-only, no locking |
| `/api/reservations` | POST | Create reservation | Redis lock + Serializable TX |
| `/api/reservations/:id/confirm` | POST | Confirm reservation | Serializable TX |
| `/api/reservations/:id/release` | POST | Release reservation | Serializable TX |
| `/api/cron/expire-reservations` | GET | Expire old reservations | Batch processing |

**Key Features**:
- Input validation with Zod
- Error handling with proper HTTP status codes
- Idempotency support via headers
- Distributed locking for critical sections

### 3. Database Layer (PostgreSQL + Prisma)

**Location**: `prisma/schema.prisma`, `lib/prisma.ts`

**Schema Design**:

```
Warehouse (1) ──< Stock >── (1) Product
                    │
                    │ (tracks availability)
                    │
                    ▼
              Reservation ──> (1) Product
```

**Key Tables**:

**Stock**:
- `totalUnits`: Physical inventory count
- `reservedUnits`: Units held by pending reservations
- **Available** = `totalUnits - reservedUnits` (computed)

**Reservation**:
- `status`: PENDING | CONFIRMED | RELEASED | EXPIRED
- `expiresAt`: Timestamp for automatic expiry
- `idempotencyKey`: For safe retries

**Indexes**:
- `Stock(productId, warehouseId)` - Unique constraint
- `Reservation(status, expiresAt)` - For cron queries
- `Reservation(idempotencyKey)` - For idempotency lookups

### 4. Caching/Locking Layer (Redis)

**Location**: `lib/redis.ts`

**Use Cases**:

1. **Distributed Locking**:
```typescript
SET lock:stock:{productId}:{warehouseId} 1 EX 10 NX
```
- Prevents concurrent modifications
- 10-second TTL (auto-release if process crashes)
- Atomic operation (SET NX EX)

2. **Idempotency Cache**:
```typescript
SET idempotency:{key} {response} EX 86400
```
- Stores API responses for 24 hours
- Prevents duplicate operations on retry
- Separate keys for create vs confirm

**Fallback Strategy**:
- If Redis unavailable, skip locking
- Rely on database serializable transactions
- Log warning but don't fail request

## Data Flow

### Create Reservation Flow

```
1. Client → POST /api/reservations
   ↓
2. Validate input (Zod)
   ↓
3. Check idempotency cache (Redis)
   ├─ Hit → Return cached response
   └─ Miss → Continue
   ↓
4. Acquire distributed lock (Redis)
   ├─ Success → Continue
   └─ Failure → Return 503
   ↓
5. Start database transaction (Serializable)
   ↓
6. Read stock (FOR UPDATE implicit)
   ↓
7. Check available = total - reserved
   ├─ Insufficient → Rollback, return 409
   └─ Sufficient → Continue
   ↓
8. Create reservation (status=PENDING)
   ↓
9. Increment stock.reservedUnits
   ↓
10. Commit transaction
    ↓
11. Release lock (Redis)
    ↓
12. Cache response (Redis, if idempotency key)
    ↓
13. Return 201 with reservation data
```

### Confirm Reservation Flow

```
1. Client → POST /api/reservations/:id/confirm
   ↓
2. Check idempotency cache (Redis)
   ├─ Hit → Return cached response
   └─ Miss → Continue
   ↓
3. Start database transaction (Serializable)
   ↓
4. Read reservation
   ├─ Not found → Return 404
   ├─ Not PENDING → Return 400
   └─ PENDING → Continue
   ↓
5. Check if expired (expiresAt < now)
   ├─ Expired → Mark EXPIRED, return 410
   └─ Valid → Continue
   ↓
6. Update reservation (status=CONFIRMED)
   ↓
7. Decrement stock.totalUnits (permanent)
   ↓
8. Decrement stock.reservedUnits (release hold)
   ↓
9. Commit transaction
   ↓
10. Cache response (Redis, if idempotency key)
    ↓
11. Return 200 with updated reservation
```

### Expiry Cron Flow

```
1. Vercel Cron → GET /api/cron/expire-reservations
   ↓
2. Verify CRON_SECRET header
   ├─ Invalid → Return 401
   └─ Valid → Continue
   ↓
3. Query: SELECT * FROM Reservation
          WHERE status='PENDING' AND expiresAt <= NOW()
   ↓
4. For each expired reservation:
   ├─ Start transaction
   ├─ Update status=EXPIRED
   ├─ Decrement stock.reservedUnits
   ├─ Commit transaction
   └─ Log result
   ↓
5. Return summary (count, timestamp)
```

## Concurrency Control Strategy

### Problem: Race Condition

Two customers (A and B) try to reserve the last unit simultaneously:

```
Time  Customer A              Customer B              Stock
────────────────────────────────────────────────────────────
t0    Read stock (1 available)
t1                            Read stock (1 available)
t2    Create reservation
t3                            Create reservation
t4    Increment reserved      Increment reserved
────────────────────────────────────────────────────────────
Result: 2 reservations, 1 unit → PROBLEM!
```

### Solution: Three-Layer Defense

#### Layer 1: Distributed Lock (Redis)

```typescript
const lockKey = `lock:stock:${productId}:${warehouseId}`;
const acquired = await acquireLock(lockKey, 10);
if (!acquired) return 503; // Retry later
```

**Effect**: Only one request enters critical section at a time.

```
Time  Customer A              Customer B              Lock
────────────────────────────────────────────────────────────
t0    Acquire lock (SUCCESS)
t1                            Acquire lock (FAIL)     A holds
t2    Read stock (1 available)
t3                            Return 503 (retry)
t4    Create reservation
t5    Release lock                                    Free
t6                            Retry → Acquire lock    B holds
t7                            Read stock (0 available)
t8                            Return 409 (no stock)
────────────────────────────────────────────────────────────
Result: 1 reservation, 0 available → CORRECT!
```

#### Layer 2: Serializable Transaction (PostgreSQL)

```typescript
await prisma.$transaction(async (tx) => {
  // All operations here are isolated
}, { isolationLevel: 'Serializable' });
```

**Effect**: Even if lock fails, database prevents write skew.

**Isolation Levels**:
- Read Uncommitted: No protection (not used)
- Read Committed: Prevents dirty reads (not enough)
- Repeatable Read: Prevents non-repeatable reads (not enough)
- **Serializable**: Prevents all anomalies (used here)

**Trade-off**: Higher chance of serialization failures (P2034), but we retry.

#### Layer 3: Database Constraints

```prisma
@@unique([productId, warehouseId])
```

**Effect**: Prevents duplicate stock entries at database level.

### Why Three Layers?

1. **Redis lock**: Fast, prevents most conflicts
2. **Serializable TX**: Catches conflicts if Redis fails
3. **DB constraints**: Last line of defense, prevents data corruption

**Redundancy is intentional** - distributed systems need defense in depth.

## Scalability Considerations

### Current Limits

| Resource | Limit | Bottleneck |
|----------|-------|------------|
| Database connections | 100 (Supabase free) | Connection pool |
| Redis commands | 10K/day (Upstash free) | Lock operations |
| API requests | Unlimited (Vercel) | Database/Redis |
| Cron frequency | 1/minute (Vercel) | Expiry latency |

### Scaling Strategy

#### Phase 1: Vertical Scaling (0-1K req/min)
- Upgrade database (more connections)
- Upgrade Redis (more commands)
- Enable connection pooling (PgBouncer)

#### Phase 2: Horizontal Scaling (1K-10K req/min)
- Add read replicas (for product listings)
- Use Redis Cluster (for high availability)
- Enable Edge Functions (lower latency)
- Add CDN caching (for static data)

#### Phase 3: Distributed Architecture (10K+ req/min)
- Shard database by warehouse
- Use message queue (Bull/RabbitMQ) for expiry
- Add event sourcing (audit trail)
- Use CQRS (separate read/write models)

## Security Considerations

### Current Implementation

1. **Input Validation**: Zod schemas prevent injection
2. **SQL Injection**: Prisma uses parameterized queries
3. **Cron Auth**: CRON_SECRET header required
4. **Env Vars**: Secrets not committed to git

### Production Additions

1. **Rate Limiting**: Prevent abuse (Vercel Pro feature)
2. **CSRF Protection**: For authenticated routes
3. **API Keys**: For external integrations
4. **Audit Logging**: Track all state changes
5. **Row-Level Security**: Supabase RLS for multi-tenancy

## Monitoring & Observability

### Metrics to Track

1. **Business Metrics**:
   - Reservation creation rate
   - Confirmation rate (conversions)
   - Expiry rate (abandoned carts)
   - Average time to confirm

2. **Technical Metrics**:
   - API latency (p50, p95, p99)
   - Database query time
   - Redis operation time
   - Lock acquisition failures
   - Transaction conflicts (P2034)

3. **Error Metrics**:
   - 409 rate (stock conflicts)
   - 410 rate (expired confirmations)
   - 503 rate (lock failures)
   - 500 rate (server errors)

### Recommended Tools

- **APM**: Vercel Analytics, Sentry
- **Logging**: LogRocket, Datadog
- **Database**: Supabase Dashboard, pganalyze
- **Redis**: Upstash Metrics
- **Alerts**: PagerDuty, Opsgenie

## Testing Strategy

### Unit Tests
- Redis locking logic
- Validation schemas
- Utility functions

### Integration Tests
- API endpoints (with test database)
- Database transactions
- Cron job logic

### E2E Tests
- Complete reservation flow
- Concurrent reservations
- Expiry scenarios

### Load Tests
- Concurrent requests (k6, Artillery)
- Database connection limits
- Redis throughput

## Deployment Architecture

### Development
```
Local Machine
├── Next.js Dev Server (localhost:3000)
├── PostgreSQL (Supabase/local)
└── Redis (Upstash/local)
```

### Production (Vercel)
```
Vercel Edge Network
├── Edge Functions (API routes)
├── Static Assets (CDN)
└── Cron Jobs (scheduled)
    ↓
Supabase (Database)
    ↓
Upstash (Redis)
```

### CI/CD Pipeline
```
GitHub Push
    ↓
GitHub Actions
├── Lint (ESLint)
├── Type Check (tsc)
└── Build (next build)
    ↓
Vercel Deploy
├── Preview (PR branches)
└── Production (main branch)
    ↓
Post-Deploy
├── Run migrations (prisma db push)
└── Seed database (if needed)
```

## Future Enhancements

### Short-term
1. Add GET /api/reservations/:id
2. Add quantity selector
3. Add proper error boundaries
4. Add loading states

### Medium-term
1. Add authentication (NextAuth.js)
2. Add user dashboard
3. Add webhook notifications
4. Add analytics dashboard

### Long-term
1. Multi-warehouse fulfillment
2. Inventory forecasting
3. Real-time updates (WebSockets)
4. Mobile app (React Native)

## References

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Redis Distributed Locks](https://redis.io/docs/manual/patterns/distributed-locks/)
- [PostgreSQL Isolation Levels](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Idempotency in APIs](https://stripe.com/docs/api/idempotent_requests)
