# Deliverables — Cricket Pitch Booking System

Submission checklist mapping every requirement in the **Full Stack Developer
Assignment** to where and how it is implemented.

- **Backend repo:** `pitch-booking-system-backend` (Node + Express + TypeScript + Prisma 7 + PostgreSQL + Redis + Socket.io)
- **Frontend repo:** `pitch-booking-system-frontend` (React + Vite + TypeScript + Mantine UI + Tailwind CSS)

> "BE" = backend repo, "FE" = frontend repo throughout.

---

## Requirements traceability

| # | Requirement | Status | Where / How |
|---|-------------|--------|-------------|
| 1 | **User Authentication** — Register / Login / Logout, JWT, password hashing, protected APIs | ✅ | BE `src/modules/auth/*` — bcrypt hashing, JWT issue/verify; `src/middleware/auth.ts` protects routes. User model: `id, name, email, password, created_at`. |
| 2 | **Pitch Management** — pitches with name/location/price | ✅ | BE `prisma/schema.prisma` (`Pitch`: `id, name, location, price_per_hour`); seeded in `prisma/seed.ts` (Turf Ground, Box Cricket, Indoor Nets). `GET /pitches`. |
| 3 | **Time Slot System** — hourly slots, generation strategy | ✅ | BE `Slot` (`id, pitch_id, start_time, end_time`). **Strategy: pre-generated** hourly templates 06:00–22:00 per pitch (seed), combined with `booking_date` at query time. Rationale in `ARCHITECTURE.md`. |
| 4 | **Booking Flow** — pick pitch → date → slot → confirm | ✅ | FE `pages/Calendar.tsx` → `pages/BookingConfirm.tsx`. BE `Booking` (`id, user_id, pitch_id, slot_id, booking_date, status, created_at`). |
| 5 | **Concurrency Challenge** — no double booking (+ explanation) | ✅ | Two layers: Redis `SET NX` first-writer-wins + Postgres **partial unique index** `(slot_id, booking_date) WHERE status='CONFIRMED'`. BE `modules/booking/booking.service.ts`, migration SQL. Explained in `ARCHITECTURE.md` §1. |
| 6 | **Real-Time Slot Availability** — Socket.io live updates | ✅ | BE `src/sockets/*` emits `slot:reserved` / `slot:released` / `slot:booked` to `pitch:<id>:<date>` rooms; FE subscribes in `Calendar.tsx`. Redis adapter for multi-instance. |
| 7 | **Booking Expiry Logic** — 2-min hold, auto-release | ✅ | **Strategy: Redis** TTL key (`EX 120`). Auto-release via Redis keyspace-expiry → `slot:released`. Manual instant release on cancel/close via `POST /release-slot`. `ARCHITECTURE.md` §2. |
| 8 | **Booking Calendar UI** — pitch/date/available/booked, React + Tailwind | ✅ | FE `Calendar.tsx` — slot grid with Available / Reserved / Booked / Expired states. Built with **Mantine UI + Tailwind CSS**. |
| 9 | **APIs** — the exact endpoint list | ✅ | All present (table below). |
| 10 | **Edge Cases** — duplicates, retry, expiry, disconnect, multi-tab | ✅ | Handled in `booking.service.ts`; summarised in `ARCHITECTURE.md` "Edge cases handled". |
| 11 | **Database Choice** — choose + justify | ✅ | **PostgreSQL** (relational), justified in `ARCHITECTURE.md` §5 (ACID, partial unique constraint, strong consistency for booking invariants). |
| 12 | **Architecture Questions** (mandatory document) | ✅ | `ARCHITECTURE.md` — answers race condition, temporary reservation, 10k-user scalability, Socket.io scaling (Redis pub/sub, load balancer, sticky sessions). |
| 13 | **Deliverables** — repo, setup, schema, architecture, demo video | ◑ | Repos + `README.md` (setup + schema) + `ARCHITECTURE.md` done. **Demo video: to be recorded by candidate.** |
| 14 | **Expected Time** — 16–20 hours / 2–3 days | ℹ️ | Informational. |

---

## Required APIs (§9)

| Method | Path | Auth | Status |
|--------|------|------|--------|
| POST | `/auth/register` | — | ✅ |
| POST | `/auth/login` | — | ✅ |
| GET | `/pitches` | — | ✅ |
| GET | `/slots?pitchId=&date=` | — | ✅ (also hides past slots; optional `tz`) |
| POST | `/reserve-slot` | ✅ | ✅ |
| POST | `/confirm-booking` | ✅ | ✅ |
| GET | `/my-bookings` | ✅ | ✅ (grouped: upcoming / history) |

Plus added: `POST /auth/logout`, `POST /release-slot` (instant hold release).

---

## Edge cases (§10)

| Case | Handling |
|------|----------|
| Duplicate booking requests | Partial unique index + idempotent confirm (same user re-confirm returns existing booking). |
| Network retry | Confirm idempotent on `(user, slot, date)`. |
| Slot reservation expiry | Redis TTL (120s) is the single authority; key self-deletes. |
| User disconnect during reservation | Hold survives until TTL; reconnect within 2 min keeps it (no release on disconnect). |
| Multiple-tab booking | Hold keyed by `userId`; same user re-reserving is idempotent, a different user is blocked (409). |
| Lost race at confirm | DB unique violation (P2002) → 409. |

---

## Deliverables (§13) status

- ✅ **GitHub repositories** — `pitch-booking-system-backend`, `pitch-booking-system-frontend`.
- ✅ **Setup instructions** — each repo's `README.md` (prerequisites, env, install, migrate, seed, run).
- ✅ **Database schema** — `prisma/schema.prisma` + ER summary in BE `README.md`; the durable double-booking guard is a partial unique index added in the migration SQL.
- ✅ **Architecture explanation** — `ARCHITECTURE.md` (mandatory §12 questions + diagrams + trade-offs).
- ⬜ **Demo video** — to be recorded by the candidate (suggested flow below).

### Suggested demo-video script
1. Register + login (JWT); show a protected request failing without a token.
2. Browse pitches → open a pitch's calendar (AM/PM slots, past slots hidden).
3. Reserve a slot → dedicated confirmation page → confirm → appears in **Upcoming** bookings.
4. **Concurrency:** two browsers, both confirm the same slot → one succeeds, the other gets a conflict.
5. **Real-time:** in browser A reserve/confirm a slot → browser B updates instantly.
6. **Expiry / release:** open the confirm page, cancel → slot frees immediately in the other browser.
7. Show **My Bookings** Upcoming vs History tabs and the profile menu.

---

## How to run (quick reference)

**Prerequisites:** Node 18+, PostgreSQL (local or Neon), Redis (local or Upstash; enable `notify-keyspace-events Ex`).

```bash
# Backend
cd pitch-booking-system-backend
npm install
cp .env.example .env        # set DATABASE_URL, REDIS_URL, JWT_SECRET
npx prisma migrate deploy && npx prisma generate
npm run seed
npm run dev                 # http://localhost:4000

# Frontend
cd pitch-booking-system-frontend
npm install
cp .env.example .env        # VITE_API_URL, VITE_SOCKET_URL
npm run dev                 # http://localhost:5173
```

---

## Enhancements beyond the brief

- **Time-aware availability:** past slots hidden (browser-timezone consistent); expired slots cannot be reserved/confirmed.
- **Dedicated booking confirmation page** (`/booking/confirm`) instead of a modal; instant release on cancel.
- **Modern UI** with Mantine UI + Tailwind: AppShell, Cards, Badges, Modal→Page, Select, DatePicker, Notifications, Skeletons, SegmentedControl, Tabs.
- **Profile menu** in the navbar (avatar, name, email, actions).
- **My Bookings** split into Upcoming / Booking History.
- **Prisma 7** with the `@prisma/adapter-pg` driver adapter and `prisma.config.ts`.
- **Horizontal-scale ready:** Socket.io Redis adapter + CORS allow-list.
