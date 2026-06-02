import "dotenv/config";
import { defineConfig, env } from "@prisma/config";

/**
 * Prisma 7 moved the database connection URL out of `schema.prisma` and into
 * this config file. The CLI (migrate, db push, studio) reads `datasource.url`
 * from here; the runtime PrismaClient connects via a driver adapter (see
 * src/config/prisma.ts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
