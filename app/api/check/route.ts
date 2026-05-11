/**
 * POST /api/check
 *
 * The orchestrator route. Composes /api/extract + /api/reasoning + deterministic
 * checks (vendor match, sanctions screening, duplicate detection) into a single
 * routing decision: GREEN, AMBER, or RED.
 *
 * v1.2 calibration (2026-05-11):
 *   - v1.1: GREEN_THRESHOLD raised to 0.92, FUZZY_NAME capped at 0.85
 *   - v1.2: Even on EXACT_YTUNNUS match, if extracted name is significantly
 *     different from canonical master name (similarity < 0.9), apply NAME_MISMATCH
 *     penalty dropping vendorMatchScore to NAME_MISMATCH_FALLBACK_SCORE (0.85).
 *     Rationale: Identity confirmed + name mismatch is a master-data quality
 *     signal worth surfacing to AP review. Real-world cases: vendor rebrand,
 *     ERP system glitch, billing system misconfiguration.
 *
 * Stage 7.3 of the InvoiceLens v2 build.
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

const GREEN_THRESHOLD = 0.92;
const AMBER_THRESHOLD = 0.6;

const WEIGHTS = {
  extractionCompleteness: 0.2,
  vendorMatchScore: 0.3,
  glConfidenceComponent: 0.25,
  duplicateSignal: 0.1,
  sanctionsSignal: 0.15,
};

// Vendor match scoring
const FUZZY_VENDOR_MATCH_CAP = 0.85;
// v1.2: Even on exact Y-tunnus match, if extracted name doesn't closely match
// the canonical master name (similarity < this threshold), apply the fallback score.
const NAME_SIMILARITY_THRESHOLD = 0.9;
const NAME_MISMATCH_FALLBACK_SCORE = 0.85;

const VENDOR_FUZZY_THRESHOLD = 0.4;
const SANCTIONS_FUZZY_THRESHOLD = 0.3;

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
// HELPER: simple string similarity (Sørensen-Dice on bigrams, 0.0 - 1.0)
// =============================================================================

/**
 * Returns a similarity score between two strings, 0.0 (different) to 1.0 (identical).
 * Uses Sørensen-Dice coefficient on bigrams. Industry-standard for short name comparison.
 * Case-insensitive, whitespace-normalised.
 */
function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  const aN = norm(a);
  const bN = norm(b);
  if (aN === bN) return 1.0;
  if (aN.length < 2 || bN.length < 2) return 0.0;

  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.substring(i, i + 2);
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };

  const aBg = bigrams(aN);
  const bBg = bigrams(bN);

  let intersection = 0;
  for (const [bg, count] of aBg) {
    const other = bBg.get(bg) ?? 0;
    intersection += Math.min(count, other);
  }

  const total = [...aBg.values()].reduce((s, n) => s + n, 0) + [...bBg.values()].reduce((s, n) => s + n, 0);
  return (2 * intersection) / total;
}

// =============================================================================
// HELPER: extraction completeness
// =============================================================================

function scoreExtractionCompleteness(extraction: Record<string, unknown>): number {
  const required = ["vendorName", "invoiceNumber", "invoiceDate", "grossAmount"];
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

  const lineItems = extraction.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    score *= 0.9;
  }

  return Math.min(1.0, Math.max(0.0, score));
}

// =============================================================================
// HELPER: vendor fuzzy match
//   v1.1: FUZZY_NAME capped at 0.85
//   v1.2: EXACT_YTUNNUS + name mismatch also capped at 0.85
// =============================================================================

function matchVendor(
  extractedName: string | null,
  extractedYTunnus: string | null,
  vendors: VendorRow[]
): {
  matchedVendorId: number | null;
  matchedVendorName: string | null;
  score: number;
  matchType: "EXACT_YTUNNUS" | "EXACT_YTUNNUS_NAME_MISMATCH" | "FUZZY_NAME" | "NONE";
  nameMismatch?: { extracted: string; canonical: string; similarity: number };
} {
  // First pass: exact Y-tunnus match
  if (extractedYTunnus) {
    const exactMatch = vendors.find((v) => v.yTunnus === extractedYTunnus);
    if (exactMatch) {
      // v1.2: Check name similarity even on exact Y-tunnus match
      if (extractedName) {
        const similarity = nameSimilarity(extractedName, exactMatch.name);
        if (similarity < NAME_SIMILARITY_THRESHOLD) {
          return {
            matchedVendorId: exactMatch.id,
            matchedVendorName: exactMatch.name,
            score: NAME_MISMATCH_FALLBACK_SCORE,
            matchType: "EXACT_YTUNNUS_NAME_MISMATCH",
            nameMismatch: {
              extracted: extractedName,
              canonical: exactMatch.name,
              similarity,
            },
          };
        }
      }
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
  const rawScore = 1.0 - fuseScore;
  const cappedScore = Math.min(rawScore, FUZZY_VENDOR_MATCH_CAP);

  return {
    matchedVendorId: best.item.vendor.id,
    matchedVendorName: best.item.vendor.name,
    score: cappedScore,
    matchType: "FUZZY_NAME",
  };
}

// =============================================================================
// HELPER: sanctions check
// =============================================================================

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

  if (extractedYTunnus) {
    // Future: Y-tunnus exact pass when real sanctions list has tax IDs
  }

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

    const origin = request.nextUrl.origin;

    const extractResp = await fetch(`${origin}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const extractData = await extractResp.json();

    if (!extractData.success) {
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

      return NextResponse.json(
        { success: false, error: `Extraction failed: ${extractData.error}`, code: extractData.code },
        { status: 502 }
      );
    }

    const extraction = extractData.extraction;

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
    const sanctions = await checkSanctions(extraction.vendorName, extraction.vendorYTunnus);
    const duplicate = await checkDuplicate(
      extraction.vendorYTunnus,
      extraction.invoiceNumber,
      extraction.grossAmount
    );

    const reasonResp = await fetch(`${origin}/api/reasoning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction }),
    });
    const reasonData = await reasonResp.json();

    if (!reasonData.success) {
      return NextResponse.json(
        { success: false, error: `Reasoning failed: ${reasonData.error}`, code: reasonData.code },
        { status: 502 }
      );
    }

    const reasoning = reasonData.suggestion;

    const components = {
      extractionCompleteness: scoreExtractionCompleteness(extraction),
      vendorMatchScore: vendorMatch.score,
      glConfidenceComponent: reasoning.glConfidenceComponent,
      duplicateSignal: duplicate.isStrongDuplicate ? 0 : duplicate.isWeakDuplicate ? 0.5 : 1.0,
      sanctionsSignal: sanctions.hit ? 0 : 1.0,
    };

    let hardFailReason: string | null = null;
    if (sanctions.hit) hardFailReason = "SANCTIONS_HIT";
    else if (duplicate.isStrongDuplicate) hardFailReason = "DUPLICATE";

    const { composite, lane } = computeLane(components, hardFailReason);

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