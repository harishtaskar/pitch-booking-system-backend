# Architecture & Design Decisions

Cricket Pitch Booking System — a real-time platform where many users check
availability and book hourly pitch slots concurrently without conflicts.

---

## System overview

```
        ┌───────────────┐      REST (JWT)      ┌────────────────────────┐
        │ React + Vite  │ ───────────────────▶ │  Express API (Node/TS) │
        │  frontend     │ ◀─────────────────── │                        │
        │ (Socket.io    │   Socket.io (WS)     │  ┌──────────────────┐  │
        │  client)      │ ◀═══════════════════▶│  │  Socket.io + Redis│  │
        └───────────────┘                      │  │  adapter          │  │
                                               │  └──────────────────┘  │
                                               └─────┬───────────┬──────┘
                                                     │           │
                                            ┌────────▼───┐  ┌────▼─────────┐
                                            │ PostgreSQL │  │    Redis     │
                                            │ (durable)  │  │ (ephemeral)  │
                                            └────────────┘  └──────────────┘
```

**Two stores, two jobs:**

- **PostgreSQL** holds durable truth: users, pitches, slot templates, and
  *confirmed* bookings. It enforces the final correctness guarantee.
- **Redis** holds ephemeral state: 2-minute reservation holds (auto-expiring),
  and acts as the Socket.io pub/sub backbone.

A *reservation* (selected, unconfirmed) lives only in Redis. A *booking*
(confirmed) lives in Postgres. Availability for a pitch+date is computed as:

```
all slot templates  −  CONFIRMED bookings (Postgres)  −  active holds (Redis)
```

---

## 1. Slot race condition — how do we stop two users booking the same slot?

Two complementary layers, fast path first, durable guarantee last.

**Layer 1 — Redis atomic hold (`reserve-slot`).**
Reserving runs a single atomic command:

```
SET reservation:{pitchId}:{slotId}:{date}  {userId}  NX EX 120
```

`NX` means "set only if absent". Redis executes commands one at a time, so when
N users race to hold the same slot, **exactly one** gets `OK`; the rest get
`nil` and a `409`. This resolves almost all contention before the database is
ever touched.

**Layer 2 — Postgres partial unique index (`confirm-booking`).**
Confirmation inserts the booking inside a transaction, guarded by:

```sql
CREATE UNIQUE INDEX bookings_confirmed_slot_date_unique
  ON bookings (slot_id, booking_date)
  WHERE status = 'CONFIRMED';
```

Even if two requests somehow both believed they held the slot (e.g. a hold
expired and was re-acquired at the boundary), the database permits only one
`CONFIRMED` row per `(slot, date)`. The losing `INSERT` fails with a unique
violation (Prisma `P2002`), which we translate to `409`. This is the
**source-of-truth guarantee** — it holds regardless of Redis state.

> Why a *partial* index (`WHERE status = 'CONFIRMED'`)? So a `CANCELLED` booking
> doesn't permanently block the slot from being re-booked.

**Why not rely on a single mechanism?** Redis alone can't survive a Redis
restart or a TTL-boundary race; a DB unique constraint alone serializes every
attempt at the slowest layer and gives a poor UX under load. Redis absorbs
contention cheaply; Postgres makes the outcome correct. Confirm is also
**idempotent**: a retry by the same user returns their existing booking instead
of erroring, which makes network retries safe.

---

## 2. Temporary reservation — how is the 2-minute hold handled?

When a user selects a slot, `reserve-slot` writes a Redis key with a 120-second
TTL (`EX 120`). The value is the owner's `userId`.

- **Self-expiry:** if the user never confirms, Redis deletes the key when the
  TTL lapses — no cron job, no sweeper, no bookkeeping. The hold simply ceases
  to exist and the slot is available again on the next availability read.
- **Instant release broadcast:** Redis is configured with
  `notify-keyspace-events Ex`, so an expiring key emits a keyspace event on
  `__keyevent@0__:expired`. A dedicated subscriber connection listens, parses
  the key back into `{pitchId, slotId, date}`, and emits a `slot:released`
  Socket.io event — so other viewers see the slot free up the moment the hold
  ends, not just on their next refresh.
- **Confirmation** deletes the key explicitly and emits `slot:booked`.
- **Ownership on confirm:** confirming requires an active hold owned by the
  caller. A different user's hold → `409`; an already-expired hold → `409`
  ("please reselect").

TTL is configurable via `RESERVATION_TTL_SECONDS`.

---

## 3. Scalability — 10,000 users checking availability simultaneously

Availability is a **read-mostly** workload, which scales well:

- **Stateless API** behind a load balancer → add instances horizontally; any
  instance can serve any availability request.
- **Cheap query, well-indexed.** A slot lookup is one indexed read of
  `slots` by `pitch_id` plus one indexed read of `bookings` on
  `(slot_id, booking_date)`. Both are O(log n) and touch few rows.
- **Cache the hot reads.** Availability for a given `(pitch, date)` can be
  cached in Redis for a few seconds and invalidated on `reserve`/`confirm`/
  `release`. 10k users polling the same popular pitch then collapse onto a
  single cached value.
- **Connection pooling.** Use PgBouncer or a serverless pooler (e.g. Neon's
  pooled endpoint, which this project uses) so thousands of clients share a
  bounded set of Postgres connections.
- **Read replicas** for availability reads if needed; writes (reserve/confirm)
  stay on the primary. Writes are naturally low-volume relative to reads.

The contended path (reserving the *same* slot) is serialized by a single Redis
key — microsecond-scale and unaffected by overall read volume.

---

## 4. Socket scaling — scaling Socket.io across multiple servers

A WebSocket is a long-lived connection pinned to one server instance, so a naive
multi-instance deploy breaks broadcasts (a booking on instance A wouldn't reach
clients connected to instance B). Solutions, all used here or standard practice:

- **Redis adapter (`@socket.io/redis-adapter`).** Every instance publishes and
  subscribes to room events through Redis pub/sub. Emitting `slot:booked` to
  room `pitch:{id}:{date}` reaches every subscribed client on **any** instance.
- **Sticky sessions** at the load balancer (e.g. `ip_hash`, or cookie-based)
  so a client's HTTP-polling handshake and subsequent WebSocket land on the
  same instance.
- **Rooms** keep fan-out targeted: a client only joins `pitch:{id}:{date}`, so
  an event touches just the users viewing that pitch+date, not everyone.

For very large scale, the same Redis pub/sub model extends to a dedicated
pub/sub cluster or a managed real-time layer.

---

## 5. Database choice — why PostgreSQL (relational) over NoSQL?

The hardest requirement is **never double-book a slot under concurrency**. That
is fundamentally a *consistency / invariant* problem, and relational databases
are built for exactly this:

- **ACID transactions** make confirm-or-fail atomic.
- **Partial unique constraints** express the business invariant ("at most one
  confirmed booking per slot per date") declaratively and enforce it at the
  storage engine — impossible to violate even with buggy app code or races.
- **Strong, immediate consistency.** A NoSQL store with eventual consistency
  could momentarily accept two conflicting bookings on different nodes; closing
  that gap means re-implementing locking/transactions in the application.
- The data is **inherently relational** (users → bookings → slots → pitches)
  and the volume is modest, so the usual NoSQL motivations (massive horizontal
  write scale, schemaless flexibility) don't apply.

Redis (a NoSQL key-value store) *is* used — but deliberately for the ephemeral,
high-churn, auto-expiring concerns it's perfect for, not as the system of
record.

---

## Edge cases handled

| Case | Handling |
|---|---|
| **Duplicate booking requests** | Partial unique index + idempotent confirm (same user re-confirm returns existing booking). |
| **Network retry** | Confirm is idempotent on `(user, slot, date)` — a retried confirm is safe. |
| **Reservation expiry** | Redis TTL is the single authority; key self-deletes after 120s. |
| **User disconnect during reservation** | Hold survives until its TTL, so a reconnect within 2 minutes keeps it; otherwise it auto-releases. |
| **Multiple-tab booking** | Hold value is the `userId`; the same user reserving the same slot again is treated as idempotent (returns the existing hold) rather than a conflict. A different user is blocked. |
| **Lost race at confirm** | `P2002` unique violation → `409` "Slot was just booked by someone else"; the frontend drops the hold and refreshes. |

---

## Trade-offs & possible extensions

- **Slots as time-of-day templates.** Slots are stored once per pitch (16
  hourly rows) and combined with a `booking_date`, rather than materializing a
  row per slot per day. This keeps the schema tiny and avoids a generation job;
  the cost is computing availability per query, which is cheap and cacheable.
- **Auto-release depends on keyspace notifications.** If a managed Redis blocks
  `CONFIG`/notifications, the *instant* `slot:released` broadcast is lost, but
  correctness is unaffected — the key still expires and the slot is free on the
  next availability read. A periodic sweep is a drop-in fallback.
- **Future work:** payment hold before confirm, booking cancellation flow,
  rate limiting on auth, refresh-token rotation, and an availability cache layer
  for very hot pitches.
```
