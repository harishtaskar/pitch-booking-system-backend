import { Server } from "socket.io";

/**
 * Thin accessor around the single Socket.io `Server` instance plus the helpers
 * used to broadcast slot changes.
 *
 * Why a module-level singleton?
 *   The HTTP layer (booking.service) needs to emit socket events, but it must
 *   not import the heavy socket-bootstrap module (which pulls in the Redis
 *   adapter, etc.). So `server.ts` creates the `Server` once and registers it
 *   here via `setIo`, and any module can then `emitSlotEvent(...)` without a
 *   direct dependency on the socket setup. This also keeps sockets *optional*:
 *   if `setIo` was never called, `emitSlotEvent` simply no-ops and the REST API
 *   keeps working.
 */

let io: Server | null = null;

/** Called once at startup (server.ts) after the Socket.io server is created. */
export function setIo(instance: Server): void {
  io = instance;
}

/** Get the live server (e.g. to attach the Redis adapter). Throws if too early. */
export function getIo(): Server {
  if (!io) throw new Error("Socket.io has not been initialised");
  return io;
}

/**
 * The "room" key that everyone looking at the same pitch on the same date
 * shares. Socket.io rooms are just string-keyed groups of sockets; emitting to
 * a room reaches only the sockets that joined it.
 *
 * @example
 *   roomName("pitch_42", "2026-06-02") // => "pitch:pitch_42:2026-06-02"
 *
 * A browser viewing Box Cricket on 2 Jun joins exactly this room, so a booking
 * on a *different* pitch or date never reaches it.
 */
export function roomName(pitchId: string, date: string): string {
  return `pitch:${pitchId}:${date}`;
}

/**
 * The three slot lifecycle events pushed to clients:
 *   - "slot:reserved" — someone placed a 2-minute hold (slot turns amber)
 *   - "slot:released" — a hold was cancelled or expired (slot turns green)
 *   - "slot:booked"   — a hold became a confirmed booking (slot turns grey)
 */
export type SlotEvent = "slot:reserved" | "slot:released" | "slot:booked";

export interface SlotEventPayload {
  pitchId: string;
  slotId: string;
  date: string;
  status: "available" | "reserved" | "booked";
}

/**
 * Broadcast a slot status change to every client currently viewing that
 * pitch+date — and, thanks to the Redis adapter, across *all* server instances,
 * not just this one.
 *
 * @example
 *   // Inside confirm-booking, once the booking row is written:
 *   emitSlotEvent("slot:booked", {
 *     pitchId: "pitch_42",
 *     slotId:  "slot_19_20",
 *     date:    "2026-06-02",
 *     status:  "booked",
 *   });
 *   // Every other browser on Box Cricket / 2 Jun instantly greys out 7–8 PM.
 *
 * No-ops if sockets were never initialised, so callers never need to guard.
 */
export function emitSlotEvent(event: SlotEvent, payload: SlotEventPayload): void {
  if (!io) return; // sockets optional; the REST API still works without them
  io.to(roomName(payload.pitchId, payload.date)).emit(event, payload);
}
