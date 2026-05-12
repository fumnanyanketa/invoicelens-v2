"use server";

/**
 * Server Action: submit Heikki's decision on an invoice.
 *
 * Called from the invoice detail modal client component. Internally posts to
 * /api/decide and triggers a cache revalidation so the triage queue refreshes
 * automatically after a decision is recorded.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

interface DecisionInput {
  invoiceId: number;
  action: "APPROVED" | "EDITED" | "BLOCKED";
  overrideGlCode?: string;
  reasoning?: string;
}

interface DecisionResult {
  success: boolean;
  error?: string;
  finalGlCode?: string | null;
  auditLogId?: number;
}

export async function submitDecision(input: DecisionInput): Promise<DecisionResult> {
  try {
    // ---------------------------------------------------------------------
    // 1. Fetch the invoice + reconstruct the decision package from its snapshot
    // ---------------------------------------------------------------------
    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
    });

    if (!invoice) {
      return { success: false, error: `Invoice ${input.invoiceId} not found.` };
    }

    // The full decision package was stored as JSON in the lineItems field
    // during /api/scan. Parse it back out.
    let decisionPackage: Record<string, unknown>;
    try {
      decisionPackage = JSON.parse(invoice.lineItems);
      // Ensure filename is in the package (it should be from the scan)
      if (!decisionPackage.filename) {
        decisionPackage.filename = invoice.originalFilename;
      }
    } catch (err) {
      return {
        success: false,
        error: `Could not parse decision snapshot for invoice ${input.invoiceId}.`,
      };
    }

    // ---------------------------------------------------------------------
    // 2. POST to /api/decide (we use absolute URL because server actions run server-side)
    // ---------------------------------------------------------------------
    // Determine origin - in dev, localhost:3000; in production, Vercel sets VERCEL_URL
    const origin =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    const resp = await fetch(`${origin}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionPackage,
        action: input.action,
        overrideGlCode: input.overrideGlCode,
        reasoning: input.reasoning,
      }),
    });

    const data = await resp.json();

    if (!data.success) {
      return { success: false, error: data.error ?? "Decision failed." };
    }

    // ---------------------------------------------------------------------
    // 3. Delete the original PENDING row (since /api/decide created a new row)
    // ---------------------------------------------------------------------
    // /api/decide creates a fresh Invoice row from the decision package. Our
    // PENDING row needs to be removed so we don't have duplicates.
    // (Future refactor: /api/decide should update-in-place. For v2 this works.)
    await prisma.invoice.delete({
      where: { id: input.invoiceId },
    });

    // ---------------------------------------------------------------------
    // 4. Invalidate the triage page cache so the queue refreshes
    // ---------------------------------------------------------------------
    revalidatePath("/triage");

    return {
      success: true,
      finalGlCode: data.finalGlCode,
      auditLogId: data.auditLogId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}