/**
 * POST /api/scan
 *
 * Batch-processes all PDFs in lib/mock-invoices/ that aren't already in the
 * database. For each new PDF: calls /api/check to get the full decision
 * package, creates an Invoice row with status PENDING.
 *
 * No AuditLog rows are created here - that happens when Heikki makes a
 * decision via /api/decide.
 *
 * Request body (optional):
 *   { "force": true }   // re-scan even already-processed files
 *
 * Success response (200):
 *   {
 *     "success": true,
 *     "scanned": 30,
 *     "processed": 27,
 *     "skipped": 3,
 *     "results": [
 *       { "filename": "...", "lane": "GREEN", "invoiceId": 4 },
 *       ...
 *     ]
 *   }
 *
 * This is Stage 8.0 of the InvoiceLens v2 build.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs/promises";
import path from "path";

const MOCK_INVOICE_DIR = path.join(process.cwd(), "lib", "mock-invoices");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    // ---------------------------------------------------------------------
    // 1. List all PDFs in the mock-invoices directory
    // ---------------------------------------------------------------------
    const allFiles = await fs.readdir(MOCK_INVOICE_DIR);
    const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));

    // ---------------------------------------------------------------------
    // 2. Find which ones are already in the database
    // ---------------------------------------------------------------------
    const existing = await prisma.invoice.findMany({
      where: { originalFilename: { in: pdfFiles } },
      select: { originalFilename: true },
    });
    const existingSet = new Set(existing.map((i) => i.originalFilename));

    const toProcess = force ? pdfFiles : pdfFiles.filter((f) => !existingSet.has(f));
    const skipped = pdfFiles.length - toProcess.length;

    // ---------------------------------------------------------------------
    // 3. Run /api/check for each file, persist as PENDING
    // ---------------------------------------------------------------------
    const origin = request.nextUrl.origin;
    const results: Array<{
      filename: string;
      lane: string | null;
      invoiceId: number | null;
      error?: string;
    }> = [];

    for (const filename of toProcess) {
      try {
        const checkResp = await fetch(`${origin}/api/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename }),
        });
        const decision = await checkResp.json();

        if (!decision.success) {
          results.push({
            filename,
            lane: null,
            invoiceId: null,
            error: decision.error ?? "Check failed",
          });
          continue;
        }

        // Resolve vendor relation if matched
        const matchedVendorId =
          decision.checks?.vendorMatch?.matchedVendorId ?? null;

        // Parse ISO date strings
        const parseDateOrNull = (v: unknown): Date | null => {
          if (typeof v !== "string" || v.length === 0) return null;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        };

        const ex = (decision.extraction ?? {}) as Record<string, unknown>;
        const reasonObj = (decision.reasoning ?? {}) as Record<string, unknown>;
        const conf = decision.confidence;

        // Store full decision snapshot for the UI to render the card.
        // We re-use the lineItems field to hold the full check snapshot
        // (a bit overloaded but avoids a schema change for v2).
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

        results.push({
          filename,
          lane: decision.lane,
          invoiceId: invoice.id,
        });
      } catch (err) {
        results.push({
          filename,
          lane: null,
          invoiceId: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      scanned: pdfFiles.length,
      processed: results.filter((r) => r.invoiceId !== null).length,
      skipped,
      errors: results.filter((r) => r.error).length,
      results,
    });
  } catch (err) {
    console.error("Scan route error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: errorMessage, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}