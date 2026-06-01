import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { isAllowedOrigin } from "../config/env";
import { expirySubscriber, pubClient, subClient } from "../config/redis";
import { parseReservationKey } from "../modules/booking/reservation";
import { emitSlotEvent, roomName, setIo } from "./io";

/**
 * Bootstraps Socket.io with the Redis adapter (so events fan out across all
 * server instances) and wires the keyspace-expiry listener that releases
 * abandoned reservations in real time.
 */
export async function initSockets(httpServer: HttpServer): Promise<Server> {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) =>
        isAllowedOrigin(origin)
          ? callback(null, true)
          : callback(new Error(`Origin not allowed by CORS: ${origin}`)),
      methods: ["GET", "POST"],
    },
  });

  // Cross-instance pub/sub. Sticky sessions at the load balancer keep a given
  // client pinned to one instance; the adapter shares emitted events.
  io.adapter(createAdapter(pubClient, subClient));
  setIo(io);

  io.on("connection", (socket) => {
    // Clients viewing a calendar join the room for that pitch+date.
    socket.on("join", ({ pitchId, date }: { pitchId: string; date: string }) => {
      if (pitchId && date) socket.join(roomName(pitchId, date));
    });
    socket.on("leave", ({ pitchId, date }: { pitchId: string; date: string }) => {
      if (pitchId && date) socket.leave(roomName(pitchId, date));
    });
  });

  await setupExpiryListener();
  return io;
}

/**
 * When a `reservation:*` key's TTL lapses, Redis emits a keyspace `expired`
 * event. We translate it into a `slot:released` broadcast so other viewers see
 * the slot free up the instant the 2-minute hold ends.
 *
 * Requires Redis to be configured with: notify-keyspace-events Ex
 */
async function setupExpiryListener(): Promise<void> {
  try {
    // Ensure expiry notifications are on (no-op if already configured).
    await pubClient.config("SET", "notify-keyspace-events", "Ex");
  } catch (err) {
    console.warn(
      "[sockets] Could not enable Redis keyspace notifications automatically.",
      "Set `notify-keyspace-events Ex` in redis.conf for real-time expiry events."
    );
  }

  const channel = "__keyevent@0__:expired";
  await expirySubscriber.subscribe(channel);
  expirySubscriber.on("message", (_chan, expiredKey) => {
    const parsed = parseReservationKey(expiredKey);
    if (!parsed) return;
    emitSlotEvent("slot:released", { ...parsed, status: "available" });
  });
}
