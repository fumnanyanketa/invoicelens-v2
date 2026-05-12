/**
 * Shared Prisma client for command-line scripts.
 *
 * Why this exists: each script in this folder is a standalone Node process that
 * runs outside Next.js. Next.js's env-file loading (.env.local precedence) doesn't
 * apply. Each script also needs its own PrismaClient instance because singletons
 * in lib/prisma.ts are scoped to the Next.js runtime.
 *
 * This helper centralises three things:
 *   1. Loading .env.local then .env (Next.js convention, done manually here)
 *   2. Constructing the Postgres adapter
 *   3. Instantiating PrismaClient with that adapter
 *
 * Import pattern:
 *   import { prisma } from "./_prisma";
 *   await prisma.invoice.findMany();
 *   await prisma.$disconnect();
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Make sure it is defined in .env.local."
  );
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });