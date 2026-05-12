/**
 * Shared Prisma client singleton.
 *
 * Why this exists: Next.js dev mode hot-reloads on file save, which means
 * every route file would instantiate a new PrismaClient on every reload.
 * Each new client opens a database connection. Postgres has connection
 * limits (Neon's free tier: 100 concurrent connections). Without this
 * singleton, the dev server would exhaust the pool within ~20 reloads.
 *
 * Prisma 7 pattern: PrismaClient requires a driver adapter. For Postgres
 * we use @prisma/adapter-pg which wraps node-postgres. The connection URL
 * comes from the DATABASE_URL env var. On Vercel, this should be the
 * pooled Neon URL (with -pooler in the hostname) so serverless function
 * cold starts don't exhaust direct connections.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local for local dev or to Vercel env vars for production."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}