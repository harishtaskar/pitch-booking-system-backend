import { Server } from "socket.io";

let io: Server | null = null;

export function setIo(instance: Server): void {
  io = instance;
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.io has not been initialised");
  return io;
}

/** Room shared by everyone viewing the same pitch on the same date. */
export function roomName(pitchId: string, date: string): string {
  return `pitch:${pitchId}:${date}`;
}

export type SlotEvent = "slot:reserved" | "slot:released" | "slot:booked";

export interface SlotEventPayload {
  pitchId: string;
  slotId: string;
  date: string;
  status: "available" | "reserved" | "booked";
}

/** Broadcast a slot status change to everyone viewing that pitch+date. */
export function emitSlotEvent(event: SlotEvent, payload: SlotEventPayload): void {
  if (!io) return; // sockets optional; API still works without them
  io.to(roomName(payload.pitchId, payload.date)).emit(event, payload);
}
