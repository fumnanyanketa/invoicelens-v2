/**
 * POST /api/decide
 *
 * Records Heikki's decision on an invoice. First write to the Invoice and
 * AuditLog tables - all previous routes have been read-only against the DB.
 *
 * The route does two things in a single transaction:
 *   1. Upsert an Invoice row with the extracted data + AI reasoning + confidence
 *   2. Insert an AuditLog row with full snapshots of the AI recommendation and
 *      Heikki's decision
 *
 * Request body:
 *   {
 *     "decisionPackage": { ...the full output of /api/check... },
 *     "action": "APPROVED" | "EDITED" | "BLOCKED",
 *     "overrideGlCode": "5100",      // optional, required if action=EDITED
 *     "reasoning": "Free-text note"  // optional, recommended for EDITED/BLOCKED
 *   }
 *
 * Success response (200):
 *   {
 *     "success": true,
 *     "invoiceId": 17,
 *     "auditLogId": 42,
 *     "action": "APPROVED",
 *     "finalGlCode": "5000"
 *   }
 *
 * This is Stage 7.4 of the InvoiceLens v2 build.
 * Exam mapping: Domain 1 (Agentic Architecture - human-in-the-loop persistence).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_ACTIONS = ["APPROVED", "EDITED", "BLOCKED"] as const;
type Action = (typeof VALID_ACTIONS)[number];

// Match the bounded chart from /api/reasoning
const VALID_GL_CODES = [
  "5000", "5100", "5200", "5300", "5400", "5500", "5600",
  "6300", "7100", "7200", "9000", "UNCATEGORISED",
];

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // ---------------------------------------------------------------------
    // 1. Parse and validate input
    // ---------------------------------------------------------------------
    const body = await request.json();
    const { decisionPackage, action, overrideGlCode, reasoning } = body;

    if (!decisionPackage || typeof decisionPackage !== "object") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'decisionPackage'.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid 'action'. Must be one of: ${VALID_ACTIONS.join(", ")}.`,
          code: "INVALID_ACTION",
        },
        { status: 400 }
      );
    }

    // EDITED requires an overrideGlCode
    if (action === "EDITED") {
      if (!overrideGlCode || typeof overrideGlCode !== "string") {
        return NextResponse.json(
          {
            success: false,
            error: "Action 'EDITED' requires 'overrideGlCode'.",
            code: "MISSING_OVERRIDE",
          },
          { status: 400 }
        );
      }
      if (!VALID_GL_CODES.includes(overrideGlCode)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid 'overrideGlCode'. Must be one of: ${VALID_GL_CODES.join(", ")}.`,
            code: "INVALID_GL_CODE",
          },
          { status: 400 }
        );
      }
    }

    // BLOCKED strongly recommends a reasoning note
    if (action === "BLOCKED" && (!reasoning || reasoning.trim().length === 0)) {
      return NextResponse.json(
        {
          success: false,
          error: "Action 'BLOCKED' requires a 'reasoning' note explaining why.",
          code: "MISSING_REASON",
        },
        { status: 400 }
      );
    }

    const decision = decisionPackage as {
      filename: string;
      extraction: Record<string, unknown> | null;
      reasoning: Record<string, unknown> | null;
      checks: Record<string, unknown> | null;
      confidence: Record<string, number>;
      lane: string;
      hardFailReason: string | null;
    };

    // Determine the final GL code Heikki is committing to
    const finalGlCode =
      action === "EDITED"
        ? overrideGlCode
        : action === "BLOCKED"
        ? null
        : (decision.reasoning?.glCode as string | undefined) ?? null;

    // ---------------------------------------------------------------------
    // 2. Resolve the vendor relation (if vendor was matched)
    // ---------------------------------------------------------------------
    const matchedVendorId = (decision.checks as Record<string, unknown> | null)
      ? (((decision.checks as Record<string, unknown>).vendorMatch as Record<string, unknown> | undefined)
          ?.matchedVendorId as number | null | undefined) ?? null
      : null;

    // ---------------------------------------------------------------------
    // 3. Persist Invoice + AuditLog in a single transaction
    // ---------------------------------------------------------------------
    const result = await prisma.$transaction(async (tx) => {
      // Status mapping from action
      const status =
        action === "APPROVED" ? "APPROVED" : action === "EDITED" ? "EDITED" : "BLOCKED";

      // Extract fields from the extraction object (with null safety)
      const ex = (decision.extraction ?? {}) as Record<string, unknown>;
      const reasonObj = (decision.reasoning ?? {}) as Record<string, unknown>;
      const conf = decision.confidence;

      // Parse ISO date strings into Date objects (or null)
      const parseDateOrNull = (v: unknown): Date | null => {
        if (typeof v !== "string" || v.length === 0) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      };

      // Create the Invoice row
      const invoice = await tx.invoice.create({
        data: {
          originalFilename: decision.filename,
          storagePath: `lib/mock-invoices/${decision.filename}`,

          // Extracted by Haiku
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
          lineItems: JSON.stringify(ex.lineItems ?? []),

          // From Sonnet's reasoning (may be overridden by Heikki)
          glCodeSuggestion: finalGlCode,
          glReasoning: (reasonObj.oneLineSummary as string | null) ?? null,

          // Confidence components
          extractionCompleteness: conf?.extractionCompleteness ?? null,
          vendorMatchScore: conf?.vendorMatchScore ?? null,
          duplicateSignal: conf?.duplicateSignal ?? null,
          sanctionsSignal: conf?.sanctionsSignal ?? null,
          confidenceScore: conf?.composite ?? null,

          // Routing
          lane: decision.lane,

          // Decision state
          status,
          decidedAt: new Date(),

          // Vendor relation if matched
          vendorId: matchedVendorId,
        },
      });

      // Create the AuditLog row with full snapshots
      const auditLog = await tx.auditLog.create({
        data: {
          invoiceId: invoice.id,
          action: status,
          userId: "heikki", // hardcoded until auth is added
          aiRecommendation: JSON.stringify({
            extraction: decision.extraction,
            reasoning: decision.reasoning,
            checks: decision.checks,
            confidence: decision.confidence,
            lane: decision.lane,
            hardFailReason: decision.hardFailReason,
          }),
          humanDecision: JSON.stringify({
            action,
            overrideGlCode: overrideGlCode ?? null,
            finalGlCode,
            reasoning: reasoning ?? null,
            decidedAt: new Date().toISOString(),
          }),
          reasoning: reasoning ?? null,
        },
      });

      return { invoice, auditLog };
    });

    // ---------------------------------------------------------------------
    // 4. Return the result
    // ---------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      invoiceId: result.invoice.id,
      auditLogId: result.auditLog.id,
      action,
      finalGlCode,
    });
  } catch (err) {
    console.error("Decide route error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: errorMessage, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}