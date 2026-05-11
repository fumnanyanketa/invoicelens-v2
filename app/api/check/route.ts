/**
 * POST /api/check
 *
 * The orchestrator route. Composes /api/extract + /api/reasoning + deterministic
 * checks (vendor match, sanctions screening, duplicate detection) into a single
 * routing decision: GREEN, AMBER, or RED.
 *
 * Request body:
 *   { "filename": "INV-001-neste.pdf" }
 *
 * Success response (200) - decision package:
 *   {
 *     "success": true,
 *     "filename": "...",
 *     "extraction": { ...from Haiku... },
 *     "reasoning": { ...from Sonnet... },
 *     "checks": {
 *       "vendorMatch": {...},
 *       "sanctions": {...},
 *       "duplicate": {...}
 *     },
 *     "confidence": {
 *       "extractionCompleteness": 0.92,
 *       "vendorMatchScore": 0.95,
 *       "glConfidenceComponent": 0.97,
 *       "duplicateSignal": 1.0,
 *       "sanctionsSignal": 1.0,
 *       "composite": 0.94
 *     },
 *     "lane": "GREEN",
 *     "hardFailReason": null | "SANCTIONS_HIT" | "DUPLICATE" | "INVALID_PDF"
 *   }
 *
 * This is Stage 7.3 of the InvoiceLens v2 build.
 * Exam mapping: Domain 1 (Agentic Architecture), Domain 2 (Tool Design),
 *               Domain 4 (Prompt Engineering and Validation).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Fuse from "fuse.js";
import fs from "fs/promises";
import path from "path";

// =============================================================================
// CONFIGURATION - thresholds and weights
// =============================================================================

// Lane thresholds (composite score)
const GREEN_THRESHOLD = 0.85;
const AMBER_THRESHOLD = 0.6;

// Composite scoring weights (must sum to 1.0)
const WEIGHTS = {
  extractionCompleteness: 0.2,
  vendorMatchScore: 0.3,
  glConfidenceComponent: 0.25,
  duplicateSignal: 0.1,
  sanctionsSignal: 0.15,
};

// Fuse.js fuzzy match config
const VENDOR_FUZZY_THRESHOLD = 0.4; // moderate strictness
const SANCTIONS_FUZZY_THRESHOLD = 0.3; // stricter (false positives cheaper than false negatives)

const SANCTIONS_FILE = path.join(process.cwd(), "lib", "sanctions", "eu-consolidated.json");

// =============================================================================
// TYPES
// =============================================================================

interface SanctionsEntry {
  id: string;
  name: string;
  nameVariations: string[];
  country: string;
  entityType: string;
  listingReference: string;
  listedOn: string;
  rationale: string;
}

interface VendorRow {
  id: number;
  name: string;
  nameVariants: string;
  yTunnus: string | null;
  country: string;
  expectedGlCategory: string | null;
}

// =============================================================================
// HELPER: extraction completeness
// =============================================================================

/**
 * Score how completely Haiku populated the extraction fields.
 * Required fields (must be non-null/non-empty) get full weight.
 * Optional fields get partial weight.
 * Returns 0.0 - 1.0.
 */
function scoreExtractionCompleteness(extraction: Record<string, unknown>): number {
  const required = [
    "vendorName",
    "invoiceNumber",
    "invoiceDate",
    "grossAmount",
  ];
  const optional = [
    "vendorEmail",
    "vendorAddress",
    "vendorYTunnus",
    "dueDate",
    "currency",
    "netAmount",
    "vatAmount",
    "vatRate",
  ];

  let score = 0;
  const requiredWeight = 0.7 / required.length;
  const optionalWeight = 0.3 / optional.length;

  for (const field of required) {
    if (extraction[field] !== null && extraction[field] !== undefined && extraction[field] !== "") {
      score += requiredWeight;
    }
  }
  for (const field of optional) {
    if (extraction[field] !== null && extraction[field] !== undefined && extraction[field] !== "") {
      score += optionalWeight;
    }
  }

  // Line items also matter
  const lineItems = extraction.lineItems;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    // already counted as part of structure; bonus not needed
  } else {
    score *= 0.9; // penalty for empty line items
  }

  return Math.min(1.0, Math.max(0.0, score));
}

// =============================================================================
// HELPER: vendor fuzzy match
// =============================================================================

/**
 * Find the best vendor match in the master using fuzzy name matching
 * across name and nameVariants. Returns match details + score (0-1, higher better).
 */
function matchVendor(
  extractedName: string | null,
  extractedYTunnus: string | null,
  vendors: VendorRow[]
): {
  matchedVendorId: number | null;
  matchedVendorName: string | null;
  score: number;
  matchType: "EXACT_YTUNNUS" | "FUZZY_NAME" | "NONE";
} {
  // First pass: exact Y-tunnus match (most reliable signal)
  if (extractedYTunnus) {
    const exactMatch = vendors.find((v) => v.yTunnus === extractedYTunnus);
    if (exactMatch) {
      return {
        matchedVendorId: exactMatch.id,
        matchedVendorName: exactMatch.name,
        score: 1.0,
        matchType: "EXACT_YTUNNUS",
      };
    }
  }

  // Second pass: fuzzy name match
  if (!extractedName) {
    return { matchedVendorId: null, matchedVendorName: null, score: 0, matchType: "NONE" };
  }

  // Build the fuse-searchable corpus with each variant as a separate searchable string
  const corpus = vendors.flatMap((v) => {
    let variants: string[] = [];
    try {
      const parsed = JSON.parse(v.nameVariants);
      if (Array.isArray(parsed)) variants = parsed;
    } catch {
      // ignore
    }
    const allNames = [v.name, ...variants];
    return allNames.map((n) => ({ vendor: v, searchableName: n }));
  });

  const fuse = new Fuse(corpus, {
    keys: ["searchableName"],
    threshold: VENDOR_FUZZY_THRESHOLD,
    includeScore: true,
    findAllMatches: false,
  });

  const results = fuse.search(extractedName);

  if (results.length === 0) {
    return { matchedVendorId: null, matchedVendorName: null, score: 0, matchType: "NONE" };
  }

  const best = results[0];
  const fuseScore = best.score ?? 1.0;
  return {
    matchedVendorId: best.item.vendor.id,
    matchedVendorName: best.item.vendor.name,
    score: 1.0 - fuseScore, // invert: fuse 0 = perfect, we want 1.0 = perfect
    matchType: "FUZZY_NAME",
  };
}

// =============================================================================
// HELPER: sanctions check
// =============================================================================

/**
 * Check the extracted vendor against the EU consolidated sanctions list.
 * Two passes: exact Y-tunnus, then fuzzy name. Either hit = sanctions hit.
 */
async function checkSanctions(
  extractedName: string | null,
  extractedYTunnus: string | null
): Promise<{
  hit: boolean;
  matchedEntry: SanctionsEntry | null;
  matchType: "EXACT_YTUNNUS" | "FUZZY_NAME" | "NONE";
}> {
  const sanctionsRaw = await fs.readFile(SANCTIONS_FILE, "utf-8");
  const sanctionsData = JSON.parse(sanctionsRaw);
  const entries: SanctionsEntry[] = sanctionsData.entries;

  // First pass: Y-tunnus exact match
  // (Note: real EU list does carry tax IDs; our mock list doesn't, but the
  // pattern is here for when this connects to the real list.)
  if (extractedYTunnus) {
    // For now, our mock entries don't have yTunnus field. If they did:
    // const ytunnusHit = entries.find((e) => e.yTunnus === extractedYTunnus);
    // Skipping until we add yTunnus to sanctions entries.
  }

  // Second pass: fuzzy name match
  if (!extractedName) {
    return { hit: false, matchedEntry: null, matchType: "NONE" };
  }

  const corpus = entries.flatMap((e) => {
    const allNames = [e.name, ...e.nameVariations];
    return allNames.map((n) => ({ entry: e, searchableName: n }));
  });

  const fuse = new Fuse(corpus, {
    keys: ["searchableName"],
    threshold: SANCTIONS_FUZZY_THRESHOLD,
    includeScore: true,
    findAllMatches: false,
  });

  const results = fuse.search(extractedName);

  if (results.length === 0) {
    return { hit: false, matchedEntry: null, matchType: "NONE" };
  }

  return {
    hit: true,
    matchedEntry: results[0].item.entry,
    matchType: "FUZZY_NAME",
  };
}

// =============================================================================
// HELPER: duplicate detection
// =============================================================================

/**
 * Query the Invoice table for duplicates.
 * Strong duplicate: same vendor Y-tunnus + same invoice number + same gross amount.
 * Weak duplicate: same invoice number from a different vendor, or matching pair but different amount.
 */
async function checkDuplicate(
  extractedYTunnus: string | null,
  extractedInvoiceNumber: string | null,
  extractedGrossAmount: number | null
): Promise<{
  isStrongDuplicate: boolean;
  isWeakDuplicate: boolean;
  duplicateInvoiceId: number | null;
  notes: string;
}> {
  if (!extractedInvoiceNumber) {
    return {
      isStrongDuplicate: false,
      isWeakDuplicate: false,
      duplicateInvoiceId: null,
      notes: "No invoice number extracted; duplicate check skipped.",
    };
  }

  // Find any invoice with the same invoice number
  const candidates = await prisma.invoice.findMany({
    where: { invoiceNumber: extractedInvoiceNumber },
    include: { vendor: true },
  });

  if (candidates.length === 0) {
    return {
      isStrongDuplicate: false,
      isWeakDuplicate: false,
      duplicateInvoiceId: null,
      notes: "No existing invoice with this invoice number.",
    };
  }

  // Look for a strong duplicate
  for (const candidate of candidates) {
    const sameYTunnus = candidate.vendor?.yTunnus === extractedYTunnus;
    const sameAmount =
      extractedGrossAmount !== null &&
      candidate.grossAmount !== null &&
      Math.abs((candidate.grossAmount ?? 0) - extractedGrossAmount) < 0.01;

    if (sameYTunnus && sameAmount) {
      return {
        isStrongDuplicate: true,
        isWeakDuplicate: false,
        duplicateInvoiceId: candidate.id,
        notes: `Exact duplicate of invoice id ${candidate.id} (same vendor, number, and amount).`,
      };
    }
  }

  // Otherwise weak duplicate
  return {
    isStrongDuplicate: false,
    isWeakDuplicate: true,
    duplicateInvoiceId: candidates[0].id,
    notes: `Invoice number collision with existing invoice id ${candidates[0].id} (different vendor or amount).`,
  };
}

// =============================================================================
// HELPER: composite confidence + lane assignment
// =============================================================================

function computeLane(
  components: {
    extractionCompleteness: number;
    vendorMatchScore: number;
    glConfidenceComponent: number;
    duplicateSignal: number;
    sanctionsSignal: number;
  },
  hardFail: string | null
): {
  composite: number;
  lane: "GREEN" | "AMBER" | "RED";
} {
  const composite =
    components.extractionCompleteness * WEIGHTS.extractionCompleteness +
    components.vendorMatchScore * WEIGHTS.vendorMatchScore +
    components.glConfidenceComponent * WEIGHTS.glConfidenceComponent +
    components.duplicateSignal * WEIGHTS.duplicateSignal +
    components.sanctionsSignal * WEIGHTS.sanctionsSignal;

  if (hardFail) {
    return { composite, lane: "RED" };
  }

  let lane: "GREEN" | "AMBER" | "RED" = "RED";
  if (composite >= GREEN_THRESHOLD) lane = "GREEN";
  else if (composite >= AMBER_THRESHOLD) lane = "AMBER";

  return { composite, lane };
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filename } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'filename'.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------------------
    // 1. Extraction (Haiku via /api/extract)
    // ---------------------------------------------------------------------
    const origin = request.nextUrl.origin;

    const extractResp = await fetch(`${origin}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const extractData = await extractResp.json();

    // Hard-fail: PDF could not be parsed at all
    if (!extractData.success) {
      // The extraction route already classified the error. Propagate it.
      const isInvalidPdf = extractData.code === "INVALID_PDF";
      const hardFail = isInvalidPdf ? "INVALID_PDF" : null;

      if (hardFail) {
        return NextResponse.json({
          success: true,
          filename,
          extraction: null,
          reasoning: null,
          checks: null,
          confidence: {
            extractionCompleteness: 0,
            vendorMatchScore: 0,
            glConfidenceComponent: 0,
            duplicateSignal: 0,
            sanctionsSignal: 0,
            composite: 0,
          },
          lane: "RED",
          hardFailReason: "INVALID_PDF",
          extractionError: extractData,
        });
      }

      // Non-hard-fail extraction error: bubble up
      return NextResponse.json(
        {
          success: false,
          error: `Extraction failed: ${extractData.error}`,
          code: extractData.code,
        },
        { status: 502 }
      );
    }

    const extraction = extractData.extraction;

    // ---------------------------------------------------------------------
    // 2. Vendor master fetch + fuzzy match
    // ---------------------------------------------------------------------
    const vendors = (await prisma.vendor.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        nameVariants: true,
        yTunnus: true,
        country: true,
        expectedGlCategory: true,
      },
    })) as VendorRow[];

    const vendorMatch = matchVendor(extraction.vendorName, extraction.vendorYTunnus, vendors);

    // ---------------------------------------------------------------------
    // 3. Sanctions check
    // ---------------------------------------------------------------------
    const sanctions = await checkSanctions(extraction.vendorName, extraction.vendorYTunnus);

    // ---------------------------------------------------------------------
    // 4. Duplicate check
    // ---------------------------------------------------------------------
    const duplicate = await checkDuplicate(
      extraction.vendorYTunnus,
      extraction.invoiceNumber,
      extraction.grossAmount
    );

    // ---------------------------------------------------------------------
    // 5. Reasoning (Sonnet via /api/reasoning)
    // ---------------------------------------------------------------------
    const reasonResp = await fetch(`${origin}/api/reasoning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction }),
    });
    const reasonData = await reasonResp.json();

    if (!reasonData.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Reasoning failed: ${reasonData.error}`,
          code: reasonData.code,
        },
        { status: 502 }
      );
    }

    const reasoning = reasonData.suggestion;

    // ---------------------------------------------------------------------
    // 6. Compute confidence components + lane
    // ---------------------------------------------------------------------
    const components = {
      extractionCompleteness: scoreExtractionCompleteness(extraction),
      vendorMatchScore: vendorMatch.score,
      glConfidenceComponent: reasoning.glConfidenceComponent,
      duplicateSignal: duplicate.isStrongDuplicate ? 0 : duplicate.isWeakDuplicate ? 0.5 : 1.0,
      sanctionsSignal: sanctions.hit ? 0 : 1.0,
    };

    // Hard-fail signals override the composite score
    let hardFailReason: string | null = null;
    if (sanctions.hit) hardFailReason = "SANCTIONS_HIT";
    else if (duplicate.isStrongDuplicate) hardFailReason = "DUPLICATE";

    const { composite, lane } = computeLane(components, hardFailReason);

    // ---------------------------------------------------------------------
    // 7. Return decision package
    // ---------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      filename,
      extraction,
      reasoning,
      checks: {
        vendorMatch,
        sanctions: {
          hit: sanctions.hit,
          matchedEntry: sanctions.matchedEntry,
          matchType: sanctions.matchType,
        },
        duplicate,
      },
      confidence: {
        ...components,
        composite,
      },
      lane,
      hardFailReason,
    });
  } catch (err) {
    console.error("Check route error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: errorMessage, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}