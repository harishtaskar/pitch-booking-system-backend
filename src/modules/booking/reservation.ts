const PREFIX = "reservation";

/**
 * Redis key for a temporary hold on a slot for a given pitch + date.
 * Value stored at this key is the userId that owns the hold.
 */
export function reservationKey(pitchId: string, slotId: string, date: string): string {
  return `${PREFIX}:${pitchId}:${slotId}:${date}`;
}

/** Parse an expired reservation key back into its parts (for the expiry listener). */
export function parseReservationKey(
  key: string
): { pitchId: string; slotId: string; date: string } | null {
  const parts = key.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  return { pitchId: parts[1], slotId: parts[2], date: parts[3] };
}

/** Normalise an incoming date to a canonical YYYY-MM-DD string. */
export function normaliseDate(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  return d.toISOString().slice(0, 10);
}
