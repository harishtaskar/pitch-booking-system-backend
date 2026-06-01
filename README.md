# Pitch Booking System — Backend

Real-time cricket pitch booking API. Node + Express + TypeScript + Prisma (PostgreSQL) + Redis + Socket.io.

Frontend repo: **pitch-booking-system-frontend**.

---

## Features

- JWT authentication (register / login / logout), bcrypt password hashing, protected routes
- Pitches + pre-generated hourly slots (06:00–22:00)
- **2-minute temporary slot reservation** backed by Redis TTL keys
- **Concurrency-safe confirmation** — Redis `SET NX` first-writer-wins + a Postgres partial unique index
- **Real-time availability** via Socket.io with a Redis adapter for horizontal scaling
- Auto-release of abandoned holds via Redis keyspace-expiry notifications

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design write-up (race conditions, reservation, scaling).

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local, or a hosted provider such as Neon)
- Redis 6+ (local, or a hosted provider such as Upstash)

> **Redis keyspace notifications** must be enabled for instant auto-release:
> the app tries to set `notify-keyspace-events Ex` on startup, but some managed
> providers block the `CONFIG` command. If so, enable it in the provider's
> dashboard (Upstash has it on by default), or start local Redis with:
> `redis-server --notify-keyspace-events Ex`

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   then edit .env with your DATABASE_URL, REDIS_URL and a strong JWT_SECRET

# 3. Apply the database schema (creates tables + the partial unique index)
npx prisma migrate deploy
npx prisma generate

# 4. Seed pitches and hourly slots (idempotent)
npm run seed

# 5. Run the API + Socket.io server
npm run dev          # development (hot reload)
# or
npm run build && npm start   # production
```

API runs on `http://localhost:4000` by default.

### Environment variables

| Var | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (`redis://` or `rediss://`) |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `PORT` | HTTP port (default `4000`) |
| `CLIENT_ORIGIN` | Allowed CORS origin (the frontend URL) |
| `RESERVATION_TTL_SECONDS` | Temporary hold duration (default `120`) |

---

## API

| Method | Path | Auth | Body / Query | Description |
|---|---|---|---|---|
| POST | `/auth/register` | — | `{ name, email, password }` | Create account, returns `{ token, user }` |
| POST | `/auth/login` | — | `{ email, password }` | Returns `{ token, user }` |
| POST | `/auth/logout` | ✓ | — | Stateless; client discards token |
| GET | `/pitches` | — | — | List pitches |
| GET | `/slots` | — | `?pitchId=&date=YYYY-MM-DD&tz=` | Future slots with `available` / `reserved` / `booked` |
| POST | `/reserve-slot` | ✓ | `{ pitchId, slotId, date, tz? }` | Place a 2-min hold |
| POST | `/confirm-booking` | ✓ | `{ pitchId, slotId, date, tz? }` | Confirm a held slot |
| POST | `/release-slot` | ✓ | `{ pitchId, slotId, date }` | Release own hold instantly (e.g. dialog closed) |
| GET | `/my-bookings` | ✓ | — | Current user's bookings |

`GET /slots` and the booking actions accept an optional `tz` (the client's IANA
timezone, e.g. `Asia/Kolkata`). It is used to hide/reject slots whose start time
has already passed, keeping "expired" consistent between server and browser.

Authenticated requests send `Authorization: Bearer <token>`.

### Socket.io events

Clients `emit("join", { pitchId, date })` to subscribe to a pitch+date room and receive:

| Event | Payload | When |
|---|---|---|
| `slot:reserved` | `{ pitchId, slotId, date, status }` | A slot is temporarily held |
| `slot:booked` | same | A booking is confirmed |
| `slot:released` | same | A hold expired (2 min elapsed) |

---

## Database schema

```
User    id, name, email (unique), password, created_at
Pitch   id, name, location, price_per_hour
Slot    id, pitch_id → Pitch, start_time, end_time          (unique: pitch_id + start_time)
Booking id, user_id → User, pitch_id → Pitch, slot_id → Slot,
        booking_date (date), status (CONFIRMED|CANCELLED), created_at
```

**Durable double-booking guard** — a partial unique index:

```sql
CREATE UNIQUE INDEX bookings_confirmed_slot_date_unique
  ON bookings (slot_id, booking_date)
  WHERE status = 'CONFIRMED';
```

Source of truth is `prisma/schema.prisma`; the partial index is added in
`prisma/migrations/.../migration.sql`.

---

## Deployment notes

- **Postgres**: any managed Postgres works (Neon, Supabase, RDS). Run
  `npx prisma migrate deploy` against the production `DATABASE_URL`.
- **Redis**: use a managed Redis and paste its URL into `REDIS_URL`.
  [Upstash](https://upstash.com) is a good fit — free tier, TLS (`rediss://`),
  and keyspace notifications enabled by default. Render/Railway provide a Redis
  add-on that injects an internal URL; prefer the internal/private URL when the
  API and Redis are on the same platform.
- For multiple API instances, enable **sticky sessions** at the load balancer
  so Socket.io's long-lived connections stay pinned; the Redis adapter fans out
  events across instances.

---

## Testing the concurrency guarantee

With the server running, fire two confirmations at the same slot in parallel —
exactly one returns `201`, the other `409`:

```bash
# (after reserving + grabbing two tokens and a slotId)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/confirm-booking \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"pitchId":"...","slotId":"...","date":"2026-06-03"}' &
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/confirm-booking \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"pitchId":"...","slotId":"...","date":"2026-06-03"}' &
wait
```

---

## Project structure

```
src/
  config/      env, prisma client, redis clients
  middleware/  JWT auth, error handler
  modules/
    auth/      register / login / logout
    pitch/     GET /pitches
    slot/      GET /slots (availability computation)
    booking/   reserve-slot, confirm-booking, my-bookings + reservation helpers
  sockets/     Socket.io setup, Redis adapter, keyspace-expiry listener
  app.ts       Express app
  server.ts    HTTP + Socket.io bootstrap
prisma/
  schema.prisma, migrations/, seed.ts
```
