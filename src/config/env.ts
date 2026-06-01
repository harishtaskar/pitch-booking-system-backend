import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  RESERVATION_TTL_SECONDS: z.coerce.number().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Allowed CORS origins, parsed from a comma-separated CLIENT_ORIGIN. */
export const clientOrigins = env.CLIENT_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const isDev = process.env.NODE_ENV !== "production";

/**
 * Whether a request origin is allowed. Configured origins always pass; in
 * development any localhost / 127.0.0.1 port is also allowed so the exact Vite
 * dev-server port (5173, 5174, …) doesn't matter.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, mobile, server-to-server)
  if (clientOrigins.includes(origin)) return true;
  if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}