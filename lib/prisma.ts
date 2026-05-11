/**
 * Shared Prisma client singleton.
 *
 * Why this exists: Next.js dev mode hot-reloads on file save, which means
 * every route file would instantiate a new PrismaClient on every reload.
 * Each new client opens a database connection. SQLite has a connection
 * cap. Without this singleton, the dev server crashes within ~20 reloads.
 *
 * Pattern: stash the client on the global object so it survives hot reloads.
 * In production (Vercel), each serverless function gets a fresh global,
 * so the singleton naturally rebuilds per function invocation.
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}