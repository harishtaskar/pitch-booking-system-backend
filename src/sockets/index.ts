import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { isAllowedOrigin } from "../config/env";
import { expirySubscriber, pubClient, subClient } from "../config/redis";
import { parseReservationKey } from "../modules/booking/reservation";
import { emitSlotEvent, roomName, setIo } from "./io";

/**
 * Bootstraps the real-time layer. Two things happen here:
 *
 *  1. Socket.io is attached to the existing HTTP server and given the Redis
 *     adapter, so a booking made on one server instance is broadcast to clients
 *     connected to *any* instance (horizontal scaling).
 *
 *  2. A Redis keyspace listener turns a hold's TTL expiry into a real-time
 *     "slot freed up" broadcast (see `setupExpiryListener`).
 *
 * Lifecycle / end-to-end example:
 *   - Browser opens Box Cricket for 2 Jun → emits `join {pitchId, date}` →
 *     joins room "pitch:<id>:2026-06-02".
 *   - Another user reserves 7–8 PM → booking.service calls
 *     `emitSlotEvent("slot:reserved", …)` → this browser's grid shows "Reserved".
 *   - That user confirms → "slot:booked"; or the 2-min hold lapses →
 *     Redis expiry → "slot:released" and the slot returns to "Available".
 */
export async function initSockets(httpServer: HttpServer): Promise<Server> {
  const io = new Server(httpServer, {
    // Same allow-list as the REST API. The WebSocket handshake is an HTTP
    // request, so it is subject to CORS too.
    cors: {
      origin: (origin, callback) =>
        isAllowedOrigin(origin)
          ? callback(null, true)
          : callback(new Error(`Origin not allowed by CORS: ${origin}`)),
      methods: ["GET", "POST"],
    },
  });

  // Redis adapter = cross-instance pub/sub. Without it, `io.to(room).emit(...)`
  // only reaches sockets connected to *this* Node process; with it, the event
  // is published to Redis and re-emitted by every instance to its own sockets.
  // (Pair with sticky sessions at the load balancer so a client's long-lived
  // WebSocket stays pinned to one instance.)
  io.adapter(createAdapter(pubClient, subClient));
  setIo(io);

  io.on("connection", (socket) => {
    // The client tells us which pitch+date it is currently looking at, and we
    // subscribe its socket to that room. Joining a room is how we later target
    // broadcasts at *only* the interested viewers.
    //
    // Client side (frontend/src/lib/socket.ts):
    //   socket.emit("join",  { pitchId, date })  // on entering a calendar
    //   socket.emit("leave", { pitchId, date })  // on leaving / changing date
    socket.on("join", ({ pitchId, date }: { pitchId: string; date: string }) => {
      if (pitchId && date) socket.join(roomName(pitchId, date));
    });
    socket.on("leave", ({ pitchId, date }: { pitchId: string; date: string }) => {
      if (pitchId && date) socket.leave(roomName(pitchId, date));
    });
    // Note: we deliberately do NOT release a user's hold on disconnect — the
    // Redis TTL is the single source of truth, so a quick refresh/reconnect
    // within the 2-minute window keeps the reservation alive.
  });

  await setupExpiryListener();
  return io;
}

/**
 * Real-time auto-release of expired holds.
 *
 * A reservation is just a Redis key `reservation:<pitchId>:<slotId>:<date>` set
 * with `EX 120`. When that TTL lapses Redis deletes the key and — if keyspace
 * notifications are enabled — publishes an event on the channel
 * `__keyevent@0__:expired` whose message is the deleted key's name.
 *
 * We subscribe to that channel, parse the key back into {pitchId, slotId, date},
 * and broadcast `slot:released` so every viewer sees the slot turn green at the
 * exact moment the hold ends — no polling, no client-side timer needed.
 *
 * Example:
 *   key "reservation:pitch_42:slot_19_20:2026-06-02" expires
 *     → message on "__keyevent@0__:expired"
 *     → parseReservationKey(...) = { pitchId: "pitch_42", slotId: "slot_19_20", date: "2026-06-02" }
 *     → emitSlotEvent("slot:released", { ...parsed, status: "available" })
 *
 * Requires Redis configured with `notify-keyspace-events Ex` (the `E` enables
 * keyevent notifications, `x` includes expired events). We try to set it
 * automatically below; some managed Redis providers block `CONFIG`, in which
 * case enable it in their dashboard. If it can't be enabled, correctness is
 * unaffected — the slot still frees on the next availability fetch, only the
 * *instant* broadcast is lost.
 */
async function setupExpiryListener(): Promise<void> {
  try {
    // Idempotent: turns on expiry keyspace events if the provider allows it.
    await pubClient.config("SET", "notify-keyspace-events", "Ex");
  } catch {
    console.warn(
      "[sockets] Could not enable Redis keyspace notifications automatically.",
      "Set `notify-keyspace-events Ex` in redis.conf for real-time expiry events."
    );
  }

  // `@0` is the default Redis database index. A dedicated subscriber connection
  // is required because a connection in subscribe mode can't run other commands.
  const channel = "__keyevent@0__:expired";
  await expirySubscriber.subscribe(channel);
  expirySubscriber.on("message", (_chan, expiredKey) => {
    const parsed = parseReservationKey(expiredKey);
    if (!parsed) return; // ignore non-reservation keys that may also expire
    emitSlotEvent("slot:released", { ...parsed, status: "available" });
  });
}
