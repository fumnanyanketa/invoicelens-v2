/**
 * One-off backfill: process a single PDF and insert it as a PENDING invoice.
 *
 * Used when /api/scan misses a file (e.g., client timeout mid-batch).
 *
 * Run with:
 *   npx tsx scripts/backfill-one.ts INV-013-dna.pdf
 */

import { prisma } from "./_prisma";

const filename = process.argv[2];

if (!filename) {
  console.error("Usage: npx tsx scripts/backfill-one.ts <filename>");
  process.exit(1);
}

async function main() {
  // -----------------------------------------------------------------------
  // Idempotency check
  // -----------------------------------------------------------------------
  const existing = await prisma.invoice.findFirst({
    where: { originalFilename: filename },
  });
  if (existing) {
    console.log(`${filename} already exists in DB (invoice id ${existing.id}). Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  // -----------------------------------------------------------------------
  // Call /api/check
  // -----------------------------------------------------------------------
  console.log(`Calling /api/check for ${filename}...`);
  const start = Date.now();
  const resp = await fetch("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  const decision = await resp.json();
  console.log(`HTTP ${resp.status} - ${Date.now() - start}ms`);

  if (!decision.success) {
    console.error("Check failed:", JSON.stringify(decision, null, 2));
    await prisma.$disconnect();
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Insert as PENDING (mirrors the scan route logic)
  // -----------------------------------------------------------------------
  const ex = (decision.extraction ?? {}) as Record<string, unknown>;
  const reasonObj = (decision.reasoning ?? {}) as Record<string, unknown>;
  const conf = decision.confidence;
  const matchedVendorId = decision.checks?.vendorMatch?.matchedVendorId ?? null;

  const parseDateOrNull = (v: unknown): Date | null => {
    if (typeof v !== "string" || v.length === 0) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  const fullSnapshot = JSON.stringify({
    extraction: decision.extraction,
    reasoning: decision.reasoning,
    checks: decision.checks,
    confidence: decision.confidence,
    lane: decision.lane,
    hardFailReason: decision.hardFailReason,
  });

  const invoice = await prisma.invoice.create({
    data: {
      originalFilename: filename,
      storagePath: `lib/mock-invoices/${filename}`,
      vendorName: (ex.vendorName as string | null) ?? null,
      vendorEmail: (ex.vendorEmail as string | null) ?? null,
      invoiceNumber: (ex.invoiceNumber as string | null) ?? null,
      invoiceDate: parseDateOrNull(ex.invoiceDate),
      dueDate: parseDateOrNull(ex.dueDate),
      grossAmount: (ex.grossAmount as number | null) ?? null,
      vatAmount: (ex.vatAmount as number | null) ?? null,
      vatRate: (ex.vatRate as number | null) ?? null,
      vatCode: (ex.vatCode as string | null) ?? null,
      currency: (ex.currency as string | undefined) ?? "EUR",
      lineItems: fullSnapshot,
      glCodeSuggestion: (reasonObj.glCode as string | null) ?? null,
      glReasoning: (reasonObj.oneLineSummary as string | null) ?? null,
      extractionCompleteness: conf?.extractionCompleteness ?? null,
      vendorMatchScore: conf?.vendorMatchScore ?? null,
      duplicateSignal: conf?.duplicateSignal ?? null,
      sanctionsSignal: conf?.sanctionsSignal ?? null,
      confidenceScore: conf?.composite ?? null,
      lane: decision.lane,
      status: "PENDING",
      vendorId: matchedVendorId,
    },
  });

  console.log(`Inserted invoice id ${invoice.id}. Lane: ${decision.lane}, composite: ${conf?.composite?.toFixed(3) ?? "n/a"}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});