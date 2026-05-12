/**
 * Delete all PENDING invoices and re-scan them with the current orchestrator.
 * Decided invoices (APPROVED/EDITED/BLOCKED) are preserved.
 *
 * Used after orchestrator calibration changes to refresh the PENDING queue.
 *
 * Run with:
 *   npx tsx scripts/rescan-pending.ts
 */

import { prisma } from "./_prisma";

async function main() {
  // -----------------------------------------------------------------------
  // 1. Find PENDING invoices and remember their filenames
  // -----------------------------------------------------------------------
  const pendings = await prisma.invoice.findMany({
    where: { status: "PENDING" },
    select: { id: true, originalFilename: true },
  });

  console.log(`Found ${pendings.length} PENDING invoices to rescan.\n`);

  if (pendings.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // -----------------------------------------------------------------------
  // 2. Delete the PENDING rows (decided ones stay)
  // -----------------------------------------------------------------------
  const deleted = await prisma.invoice.deleteMany({
    where: { status: "PENDING" },
  });
  console.log(`Deleted ${deleted.count} PENDING rows.\n`);

  // -----------------------------------------------------------------------
  // 3. Re-check each filename via /api/check + insert as PENDING
  // -----------------------------------------------------------------------
  const filenames = pendings.map((p) => p.originalFilename);
  let processed = 0;
  const lanes = { GREEN: 0, AMBER: 0, RED: 0 };

  for (const filename of filenames) {
    process.stdout.write(`  Scanning ${filename}... `);
    const start = Date.now();

    try {
      const resp = await fetch("http://localhost:3000/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const decision = await resp.json();

      if (!decision.success) {
        process.stdout.write(`ERROR (${decision.error})\n`);
        continue;
      }

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

      await prisma.invoice.create({
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

      processed++;
      if (decision.lane === "GREEN") lanes.GREEN++;
      else if (decision.lane === "AMBER") lanes.AMBER++;
      else if (decision.lane === "RED") lanes.RED++;

      process.stdout.write(`${decision.lane} ${conf.composite.toFixed(3)} (${Date.now() - start}ms)\n`);
    } catch (err) {
      process.stdout.write(`EXCEPTION (${err instanceof Error ? err.message : String(err)})\n`);
    }
  }

  console.log(`\nProcessed: ${processed}/${filenames.length}`);
  console.log(`Lane distribution (PENDING only):`);
  console.log(`  GREEN: ${lanes.GREEN}`);
  console.log(`  AMBER: ${lanes.AMBER}`);
  console.log(`  RED:   ${lanes.RED}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});