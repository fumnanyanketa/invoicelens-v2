/**
 * POST /api/reasoning
 *
 * Receives extracted invoice data, fetches the vendor master from the database,
 * sends both to Claude Sonnet 4.6, returns a GL code suggestion with structured
 * reasoning and a one-line summary.
 *
 * Request body:
 *   {
 *     "extraction": { ...output from /api/extract... }
 *   }
 *
 * Success response (200):
 *   {
 *     "success": true,
 *     "suggestion": {
 *       "glCode": "5000",
 *       "glCodeName": "Vehicle fuel",
 *       "oneLineSummary": "...",
 *       "vendorMatchEvidence": "...",
 *       "lineItemAnalysis": "...",
 *       "historicalPattern": "...",
 *       "glConfidenceComponent": 0.92,
 *       "reasoningNotes": "..."
 *     },
 *     "modelUsed": "claude-sonnet-4-6",
 *     "usage": { inputTokens, outputTokens }
 *   }
 *
 * Error codes (same convention as /api/extract):
 *   400 INVALID_INPUT, 502 NO_TOOL_USE, 502 AUTH_ERROR,
 *   429 RATE_LIMIT, 500 INTERNAL_ERROR
 *
 * Exam mapping: Domain 4 (Prompt Engineering and Validation Patterns),
 *               Domain 1 (Agentic Architecture - bounded output spaces).
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

const anthropic = new Anthropic();

// =============================================================================
// SAARISTO LOGISTICS CHART OF ACCOUNTS
// =============================================================================

/**
 * The bounded chart of accounts. Sonnet MUST pick from this list.
 * UNCATEGORISED is the escape hatch for invoices that genuinely don't fit anywhere.
 *
 * Codes are organised by Finnish SME convention:
 *   5xxx = direct cost of operations
 *   6xxx = travel and entertainment
 *   7xxx = IT, professional services, admin
 *   9000 = other
 */
const GL_CODES = [
  { code: "5000", name: "Vehicle fuel" },
  { code: "5100", name: "Vehicle maintenance" },
  { code: "5200", name: "Workshop supplies" },
  { code: "5300", name: "Insurance" },
  { code: "5400", name: "Subcontractor freight" },
  { code: "5500", name: "Postage and freight" },
  { code: "5600", name: "Office supplies" },
  { code: "6300", name: "Travel" },
  { code: "7100", name: "IT subscriptions" },
  { code: "7200", name: "Professional services" },
  { code: "9000", name: "Other" },
  { code: "UNCATEGORISED", name: "Could not determine" },
] as const;

const VALID_GL_CODES = GL_CODES.map((c) => c.code);

// =============================================================================
// TOOL SCHEMA
// =============================================================================

const SUGGEST_GL_CODE_TOOL = {
  name: "suggest_gl_code",
  description:
    "Suggest a general ledger (GL) code for this invoice from the bounded " +
    "chart of accounts. Provide structured reasoning across multiple dimensions. " +
    "Return UNCATEGORISED only if no code reasonably fits.",
  input_schema: {
    type: "object" as const,
    properties: {
      glCode: {
        type: "string",
        enum: VALID_GL_CODES,
        description: "The GL code chosen from the chart of accounts.",
      },
      glCodeName: {
        type: "string",
        description: "The human-readable name of the chosen code, exactly as in the chart.",
      },
      oneLineSummary: {
        type: "string",
        description:
          "Single sentence (max 120 chars) explaining the suggestion in plain English. " +
          "This is what Heikki sees on the triage card. " +
          "Example: 'Diesel fuel from Neste, matches your standard 5000 mapping.'",
      },
      vendorMatchEvidence: {
        type: "string",
        description:
          "Did the extracted vendor name match an entry in the vendor master? " +
          "If yes, name the match and how confident. If no, say so plainly.",
      },
      lineItemAnalysis: {
        type: "string",
        description:
          "What do the line items tell us about the nature of the spend? " +
          "Reference specific descriptions and quantities.",
      },
      historicalPattern: {
        type: "string",
        description:
          "If the vendor is in the master, does its expectedGlCategory support " +
          "the suggested code? If new vendor, say 'No prior history.'",
      },
      glConfidenceComponent: {
        type: "number",
        description:
          "How confident is the model in this GL code suggestion, 0.0 to 1.0. " +
          "This is ONE input to the composite confidence score, not the final number.",
      },
      reasoningNotes: {
        type: "string",
        description:
          "Any caveats, ambiguities, or risks worth flagging. Empty string if none.",
      },
    },
    required: [
      "glCode",
      "glCodeName",
      "oneLineSummary",
      "vendorMatchEvidence",
      "lineItemAnalysis",
      "historicalPattern",
      "glConfidenceComponent",
      "reasoningNotes",
    ],
  },
};

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

/**
 * Build the system prompt with the chart of accounts and vendor master baked in.
 * This is the highest-value prompt in InvoiceLens v2 - it encodes Saaristo's
 * accounting rules in a form Sonnet can reason about.
 */
function buildSystemPrompt(vendors: Array<{
  name: string;
  nameVariants: string;
  yTunnus: string | null;
  country: string;
  expectedGlCategory: string | null;
}>): string {
  const chartLines = GL_CODES.map((c) => `  ${c.code}  ${c.name}`).join("\n");

  const vendorLines = vendors
    .map((v) => {
      const variants = (() => {
        try {
          const parsed = JSON.parse(v.nameVariants);
          return Array.isArray(parsed) ? parsed.join(", ") : "";
        } catch {
          return "";
        }
      })();
      return (
        `- ${v.name} (${v.country}, Y-tunnus ${v.yTunnus ?? "n/a"})\n` +
        `    Aliases: ${variants || "none"}\n` +
        `    Expected GL category: ${v.expectedGlCategory ?? "unset"}`
      );
    })
    .join("\n");

  return `You are an AP (Accounts Payable) reasoning assistant for Saaristo Logistics Oy, \
a 180-person Finnish logistics SME based in Turku. Your job is to suggest the correct GL \
(general ledger) code for incoming supplier invoices that Heikki Lindqvist (AP Specialist) \
can then approve, edit, or block.

# Chart of Accounts (BOUNDED — you MUST pick one of these codes)

${chartLines}

# Vendor Master (the suppliers Saaristo regularly pays)

${vendorLines}

# Reasoning Principles

1. **Vendor match first.** Check the extracted vendor name against the vendor master, \
including aliases and Y-tunnus. A confident vendor match anchors the GL code via the \
vendor's expectedGlCategory.

2. **Then line items.** The line item descriptions tell you what the spend actually is. \
A vendor's expected category is a strong prior, but a line item override matters \
(e.g., Neste usually = fuel, but if the line item says "loyalty merchandise" it isn't fuel).

3. **Use UNCATEGORISED honestly.** If the invoice doesn't fit any code in the chart, \
return UNCATEGORISED with reasoning. Do not force a fit. Heikki would rather investigate \
than miscode.

4. **Confidence calibration.** glConfidenceComponent should reflect your actual certainty:
   - 0.9+ : vendor matched, line items consistent with expected category
   - 0.7-0.9 : one signal is uncertain (new vendor with clear line items, or known vendor with off-pattern items)
   - 0.4-0.7 : both signals weak or conflicting
   - <0.4 : returning UNCATEGORISED, or strong indication of misclassification risk

5. **No invention.** Never invent GL codes outside the chart. Never invent vendor matches \
that aren't supported by the master.

# Output

You MUST respond by calling the suggest_gl_code tool. Do not respond in plain text.`;
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // ---------------------------------------------------------------------
    // 1. Parse and validate input
    // ---------------------------------------------------------------------
    const body = await request.json();
    const { extraction } = body;

    if (!extraction || typeof extraction !== "object") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid 'extraction' object in request body.",
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------------------
    // 2. Load vendor master from database
    // ---------------------------------------------------------------------
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      select: {
        name: true,
        nameVariants: true,
        yTunnus: true,
        country: true,
        expectedGlCategory: true,
      },
    });

    // ---------------------------------------------------------------------
    // 3. Build the system prompt with chart + vendor master baked in
    // ---------------------------------------------------------------------
    const systemPrompt = buildSystemPrompt(vendors);

    // ---------------------------------------------------------------------
    // 4. Call Claude Sonnet with the reasoning tool
    // ---------------------------------------------------------------------
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: [SUGGEST_GL_CODE_TOOL],
      tool_choice: { type: "tool", name: "suggest_gl_code" },
      messages: [
        {
          role: "user",
          content:
            "Suggest a GL code for the following invoice. " +
            "The data was extracted from the PDF by an upstream extractor; treat " +
            "null fields as 'genuinely absent', not 'unknown'.\n\n" +
            "Extraction:\n" +
            "```json\n" +
            JSON.stringify(extraction, null, 2) +
            "\n```",
        },
      ],
    });

    // ---------------------------------------------------------------------
    // 5. Extract the tool_use block
    // ---------------------------------------------------------------------
    const toolUseBlock = message.content.find(
      (block) => block.type === "tool_use" && block.name === "suggest_gl_code"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        {
          success: false,
          error: "Sonnet did not return a suggest_gl_code tool call.",
          code: "NO_TOOL_USE",
          rawResponse: message.content,
        },
        { status: 502 }
      );
    }

    const suggestion = toolUseBlock.input;

    // ---------------------------------------------------------------------
    // 6. Return the structured suggestion
    // ---------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      suggestion,
      modelUsed: MODEL,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      stopReason: message.stop_reason,
    });
  } catch (err) {
    console.error("Reasoning route error:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);

    if (errorMessage.includes("401") || errorMessage.includes("authentication_error")) {
      return NextResponse.json(
        {
          success: false,
          error: "Anthropic API key is invalid or revoked.",
          code: "AUTH_ERROR",
        },
        { status: 502 }
      );
    }

    if (errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
      return NextResponse.json(
        {
          success: false,
          error: "Anthropic API rate limit reached. Retry in a few seconds.",
          code: "RATE_LIMIT",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage || "Unknown server error.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}