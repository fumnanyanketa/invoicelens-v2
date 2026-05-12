/**
 * Identify which mock-invoice PDFs are NOT yet in the Invoice table.
 */
import { prisma } from "./_prisma";
import fs from "fs/promises";
import path from "path";

async function main() {
  const dir = path.join(process.cwd(), "lib", "mock-invoices");
  const files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf"));

  const existing = await prisma.invoice.findMany({
    select: { originalFilename: true },
  });
  const existingSet = new Set(existing.map((i) => i.originalFilename));

  const missing = files.filter((f) => !existingSet.has(f));

  console.log(`Total PDFs in folder:   ${files.length}`);
  console.log(`Total invoices in DB:   ${existing.length}`);
  console.log(`Missing from DB:        ${missing.length}`);
  if (missing.length > 0) {
    console.log(`\nMissing files:`);
    for (const f of missing) console.log(`  - ${f}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});