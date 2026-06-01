import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { emitSlotEvent } from "../../sockets/io";
import { HttpError } from "../../utils/httpError";
import { normaliseDate, reservationKey } from "./reservation";

async function getSlotForPitch(pitchId: string, slotId: string) {
  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot || slot.pitchId !== pitchId) {
    throw new HttpError(404, "Slot not found for this pitch");
  }
  return slot;
}

/**
 * Place a 2-minute temporary hold on a slot.
 *
 * Concurrency: `SET key value NX EX ttl` is atomic — only the first caller
 * wins the hold; everyone else gets it back as `null`. The hold auto-expires
 * via the Redis TTL, so an abandoned selection frees itself.
 */
export async function reserveSlot(
  userId: string,
  pitchId: string,
  slotId: string,
  rawDate: string
) {
  const date = normaliseDate(rawDate);
  await getSlotForPitch(pitchId, slotId);

  // Already confirmed by anyone? Cannot reserve.
  const confirmed = await prisma.booking.findFirst({
    where: { slotId, bookingDate: new Date(date), status: "CONFIRMED" },
    select: { id: true },
  });
  if (confirmed) throw new HttpError(409, "Slot is already booked");

  const key = reservationKey(pitchId, slotId, date);
  const ttl = env.RESERVATION_TTL_SECONDS;

  const acquired = await redis.set(key, userId, "EX", ttl, "NX");

  if (acquired !== "OK") {
    // Hold exists. If this same user owns it (e.g. a second tab or a retry),
    // treat it as idempotent and return the remaining time.
    const owner = await redis.get(key);
    if (owner === userId) {
      const remaining = await redis.ttl(key);
      return { reserved: true, expiresInSeconds: remaining > 0 ? remaining : ttl, date };
    }
    throw new HttpError(409, "Slot is temporarily reserved by another user");
  }

  emitSlotEvent("slot:reserved", { pitchId, slotId, date, status: "reserved" });
  return { reserved: true, expiresInSeconds: ttl, date };
}

/**
 * Confirm a held slot into a durable booking.
 *
 * Guarantees against double-booking, in order:
 *  1. Idempotency — an existing CONFIRMED booking by this user is returned as-is
 *     (safe network retries); one by another user is a 409.
 *  2. Ownership — confirming requires an active Redis hold owned by the caller.
 *  3. Durable guard — the partial UNIQUE index (slot_id, booking_date) WHERE
 *     status='CONFIRMED' makes a racing duplicate INSERT fail (P2002 -> 409),
 *     even if two requests pass the checks above simultaneously.
 */
export async function confirmBooking(
  userId: string,
  pitchId: string,
  slotId: string,
  rawDate: string
) {
  const date = normaliseDate(rawDate);
  await getSlotForPitch(pitchId, slotId);

  const existing = await prisma.booking.findFirst({
    where: { slotId, bookingDate: new Date(date), status: "CONFIRMED" },
  });
  if (existing) {
    if (existing.userId === userId) {
      return existing; // idempotent retry
    }
    throw new HttpError(409, "Slot is already booked");
  }

  const key = reservationKey(pitchId, slotId, date);
  const owner = await redis.get(key);
  if (!owner) {
    throw new HttpError(409, "Reservation expired — please reselect the slot");
  }
  if (owner !== userId) {
    throw new HttpError(409, "Slot is reserved by another user");
  }

  let booking;
  try {
    booking = await prisma.$transaction(async (tx) => {
      return tx.booking.create({
        data: {
          userId,
          pitchId,
          slotId,
          bookingDate: new Date(date),
          status: "CONFIRMED",
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost the race at the database level.
      throw new HttpError(409, "Slot was just booked by someone else");
    }
    throw err;
  }

  await redis.del(key);
  emitSlotEvent("slot:booked", { pitchId, slotId, date, status: "booked" });
  return booking;
}

export async function getMyBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    include: {
      pitch: { select: { id: true, name: true, location: true } },
      slot: { select: { id: true, startTime: true, endTime: true } },
    },
  });
}
