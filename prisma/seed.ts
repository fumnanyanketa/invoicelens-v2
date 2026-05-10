/**
 * InvoiceLens v2 — Vendor master seed
 *
 * Populates the Vendor table with 8 fictional vendors representing
 * Saaristo Logistics Oy's typical supplier base.
 *
 * Run with: npx prisma db seed
 *
 * The script is IDEMPOTENT: upserts on yTunnus mean re-running the seed
 * does not duplicate vendors. Safe to run any number of times.
 */

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter to be passed to the PrismaClient constructor.
 * @prisma/adapter-better-sqlite3 wraps the better-sqlite3 driver and provides
 * the connection interface Prisma 7 expects.
 *
 * The url falls back to "file:./prisma/dev.db" if DATABASE_URL is not set,
 * matching the schema.prisma datasource and the .env configuration.
 */
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

/**
 * 8 vendors designed to exercise every triage lane in the v2 demo:
 * - 6 Finnish vendors (matches a real Turku SME's supplier mix)
 * - 1 cross-border EU vendor (Microsoft Ireland) for VAT reverse-charge
 * - 1 Russia-domiciled vendor (Karelia Logistics) as the sanctions trip-wire
 *
 * Y-tunnus numbers are fictional but format-valid (7 digits + hyphen + check digit)
 * GL categories follow Finnish SME chart-of-accounts conventions
 */
const vendors = [
  {
    name: "Neste Markkinointi Oy",
    nameVariants: ["Neste", "Neste Oyj", "Neste Markkinointi"],
    yTunnus: "1853571-1",
    country: "FI",
    expectedGlCategory: "5000 Vehicle fuel",
    isActive: true,
  },
  {
    name: "Turun Konekorjaamo Oy",
    nameVariants: ["Turun Konekorjaamo", "Turun Konepaja", "TKK Oy"],
    yTunnus: "2486194-3",
    country: "FI",
    expectedGlCategory: "5100 Vehicle maintenance",
    isActive: true,
  },
  {
    name: "DNA Business Oyj",
    nameVariants: ["DNA", "DNA Oyj", "DNA Business"],
    yTunnus: "0592509-6",
    country: "FI",
    expectedGlCategory: "7100 IT subscriptions",
    isActive: true,
  },
  {
    name: "Posti Group Oyj",
    nameVariants: ["Posti", "Posti Oy", "Posti Group"],
    yTunnus: "1531864-4",
    country: "FI",
    expectedGlCategory: "5500 Postage and freight",
    isActive: true,
  },
  {
    name: "Microsoft Ireland Operations Ltd",
    nameVariants: ["Microsoft Ireland", "Microsoft", "Microsoft 365"],
    yTunnus: "IE8256796U",
    country: "IE",
    expectedGlCategory: "7100 IT subscriptions",
    isActive: true,
  },
  {
    name: "Tallink Silja Oy",
    nameVariants: ["Tallink", "Silja Line", "Tallink Silja"],
    yTunnus: "1797667-3",
    country: "FI",
    expectedGlCategory: "6300 Travel",
    isActive: true,
  },
  {
    name: "Helsingin Saksitehdas Oy",
    nameVariants: ["Helsingin Saksitehdas", "Helsingin Saksi", "HS Oy"],
    yTunnus: "2913847-5",
    country: "FI",
    expectedGlCategory: "5200 Workshop supplies",
    isActive: true,
  },
  {
    name: "Karelia Logistics Holding Ltd",
    nameVariants: ["Karelia Logistics", "Karelia Holding", "KLH"],
    yTunnus: "7714039284",
    country: "RU",
    expectedGlCategory: "5400 Subcontractor freight",
    isActive: true,
  },
];

/**
 * Main seeding function.
 * Uses upsert so re-running the seed does not create duplicates.
 * Match key is yTunnus (the natural unique identifier for a business).
 */
async function main() {
  console.log("Seeding vendor master...");

  for (const vendor of vendors) {
    const result = await prisma.vendor.upsert({
      where: { yTunnus: vendor.yTunnus },
      update: {
        name: vendor.name,
        nameVariants: JSON.stringify(vendor.nameVariants),
        country: vendor.country,
        expectedGlCategory: vendor.expectedGlCategory,
        isActive: vendor.isActive,
      },
      create: {
        name: vendor.name,
        nameVariants: JSON.stringify(vendor.nameVariants),
        yTunnus: vendor.yTunnus,
        country: vendor.country,
        expectedGlCategory: vendor.expectedGlCategory,
        isActive: vendor.isActive,
      },
    });
    console.log(`  ${result.name} (${result.yTunnus})`);
  }

  const total = await prisma.vendor.count();
  console.log(`\nSeed complete. ${total} vendors in database.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });