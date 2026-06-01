import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { HttpError } from "../../utils/httpError";
import { isSlotExpired } from "../../utils/time";
import { normaliseDate, reservationKey } from "../booking/reservation";

export type SlotStatus = "available" | "reserved" | "booked";

export interface SlotAvailability {
  id: string;
  pitchId: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
}

/**
 * Availability = all slot templates for the pitch, minus CONFIRMED bookings
 * (durable, from Postgres) minus active reservations (ephemeral, from Redis).
 */
export async function getAvailability(
  pitchId: string,
  rawDate: string,
  timeZone?: string
): Promise<{ pitchId: string; date: string; slots: SlotAvailability[] }> {
  const date = normaliseDate(rawDate);

  const pitch = await prisma.pitch.findUnique({ where: { id: pitchId } });
  if (!pitch) throw new HttpError(404, "Pitch not found");

  // Only return slots that have not yet started (in the caller's timezone).
  const allSlots = await prisma.slot.findMany({
    where: { pitchId },
    orderBy: { startTime: "asc" },
  });
  const slots = allSlots.filter((s) => !isSlotExpired(date, s.startTime, timeZone));

  const bookings = await prisma.booking.findMany({
    where: { pitchId, bookingDate: new Date(date), status: "CONFIRMED" },
    select: { slotId: true },
  });
  const bookedSlotIds = new Set(bookings.map((b) => b.slotId));

  // Batch-check which non-booked slots currently hold a reservation in Redis.
  const reservableSlots = slots.filter((s) => !bookedSlotIds.has(s.id));
  let reservedSlotIds = new Set<string>();
  if (reservableSlots.length > 0) {
    const keys = reservableSlots.map((s) => reservationKey(pitchId, s.id, date));
    const values = await redis.mget(keys);
    reservedSlotIds = new Set(
      reservableSlots.filter((_, i) => values[i] !== null).map((s) => s.id)
    );
  }

  const result: SlotAvailability[] = slots.map((s) => {
    let status: SlotStatus = "available";
    if (bookedSlotIds.has(s.id)) status = "booked";
    else if (reservedSlotIds.has(s.id)) status = "reserved";
    return {
      id: s.id,
      pitchId: s.pitchId,
      startTime: s.startTime,
      endTime: s.endTime,
      status,
    };
  });

  return { pitchId, date, slots: result };
}
