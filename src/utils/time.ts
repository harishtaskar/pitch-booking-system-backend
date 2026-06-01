/**
 * Time helpers for slot expiry.
 *
 * Slot times (e.g. "06:00") are wall-clock times. To decide whether a slot has
 * already passed we compare its wall-clock start against "now" expressed in the
 * SAME timezone, as zero-padded "YYYY-MM-DD HH:MM" strings. Because the format
 * is fixed-width, a lexical comparison is a correct chronological comparison —
 * no timezone-offset arithmetic required.
 *
 * The timezone is supplied by the client (its IANA zone, e.g. "Asia/Kolkata"),
 * so the server and browser agree on what "expired" means. An invalid/absent
 * zone falls back to the server's local time.
 */

function wallClockFormatter(timeZone?: string): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...opts });
  } catch {
    // Invalid IANA zone -> fall back to the server's local timezone.
    return new Intl.DateTimeFormat("en-CA", opts);
  }
}

/** Current wall-clock time in `timeZone` as "YYYY-MM-DD HH:MM". */
export function nowWallClock(timeZone?: string): string {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * Has the slot starting at `startTime` (HH:MM) on `date` (YYYY-MM-DD) already
 * begun, relative to now in the given timezone?
 */
export function isSlotExpired(date: string, startTime: string, timeZone?: string): boolean {
  return `${date} ${startTime}` <= nowWallClock(timeZone);
}
