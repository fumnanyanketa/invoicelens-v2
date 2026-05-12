import { config as loadDotenv } from "dotenv";

// Load .env.local FIRST (Next.js convention - dev secrets live here),
// then fall through to .env (committed defaults).
// Prisma CLI doesn't read Next.js env files automatically.
loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});