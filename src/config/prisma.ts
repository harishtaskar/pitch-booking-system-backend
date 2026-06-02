import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env";

/**
 * Prisma 7 connects through a driver adapter instead of a connection URL in the
 * schema. We use the node-postgres (`pg`) adapter, pointed at DATABASE_URL.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});
