import Redis from "ioredis";
import { env } from "./env";

/**
 * Main client used for normal commands (SET NX EX, GET, DEL).
 */
export const redis = new Redis(env.REDIS_URL);

/**
 * Dedicated pub/sub clients for the Socket.io Redis adapter so events
 * propagate across horizontally-scaled server instances.
 */
export const pubClient = redis.duplicate();
export const subClient = redis.duplicate();

/**
 * Separate subscriber connection for keyspace-expiry notifications.
 * A connection in subscribe mode cannot issue regular commands, so it
 * must be its own client.
 */
export const expirySubscriber = redis.duplicate();

redis.on("error", (err) => console.error("[redis] error:", err.message));

export async function connectRedis(): Promise<void> {
  // ioredis connects lazily; a PING forces an early, explicit connection
  // so startup fails fast if Redis is unreachable.
  await redis.ping();
}