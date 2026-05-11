/**
 * POST /api/extract
 *
 * Receives a filename pointing to a PDF in lib/mock-invoices/, sends the PDF
 * to Claude Haiku 4.5 with a strict tool-use schema, returns the structured
 * extraction as JSON.
 *
 * Request body:
 *   { "filename": "INV-001-neste.pdf" }
 *
 * Success response (200):
 *   {
 *     "success": true,
 *     "filename": "INV-001-neste.pdf",
 *     "extraction": { ...invoice fields... },
 *     "modelUsed": "claude-haiku-4-5-20251001",
 *     "usage": { inputTokens, outputTokens }
 *   }
 *
 * Error responses:
 *   400 INVALID_INPUT       - missing or malformed request body
 *   400 INVALID_FILENAME    - filename contains path separators
 *   404 FILE_NOT_FOUND      - PDF does not exist in lib/mock-invoices/
 *   422 INVALID_PDF         - PDF is corrupt, malformed, or unparseable
 *   429 RATE_LIMIT          - Anthropic API rate limit reached
 *   502 NO_TOOL_USE         - Claude refused to call the tool
 *   502 AUTH_ERROR          - Anthropic API key invalid or revoked
 *   500 INTERNAL_ERROR      - anything else
 *
 * This is Stage 7.1 of the InvoiceLens v2 build.
 * Exam mapping: Domain 2 (Tool Design and MCP), Domain 4 (Prompt Engineering and Validation).
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;
const MOCK_INVOICE_DIR = path.join(process.cwd(), "lib", "mock-invoices");

// Single Anthropic client per server process.
// The SDK auto-reads ANTHROPIC_API_KEY from process.env.
const anthropic = new Anthropic();

// =============================================================================
// TOOL SCHEMA - the contract Claude must conform to
// =============================================================================

/**
 * The extract_invoice tool. Defines exactly what Claude must return.
 *
 * Why nullable string types ("string" | "null") on most fields: real invoices
 * are messy. A scanned PDF might be missing a due date. A foreign vendor might
 * not have a Y-tunnus. Forcing Claude to invent values when the data isn't
 * there leads to hallucinations. Letting Claude return null when a field is
 * genuinely missing is the architecturally honest move.
 *
 * The "required" array at the bottom lists fields Claude must always return,
 * even if their value is null. This guarantees a predictable response shape.
 */
const EXTRACT_INVOICE_TOOL = {
  name: "extract_invoice",
  description:
    "Extract structured fields from a supplier invoice PDF. " +
    "Use null for any field that is missing, unreadable, or genuinely absent from the document. " +
    "Do not invent or guess values. Return amounts as numbers, not strings.",
  input_schema: {
    type: "object" as const,
    properties: {
      vendorName: {
        type: ["string", "null"],
        description: "The company issuing the invoice (the 'FROM' party).",
      },
      vendorEmail: {
        type: ["string", "null"],
        description: "Vendor's billing or accounts email if shown on the invoice.",
      },
      vendorAddress: {
        type: ["string", "null"],
        description: "Vendor's full street address as shown on the invoice.",
      },
      vendorYTunnus: {
        type: ["string", "null"],
        description:
          "Finnish business ID (Y-tunnus, format 1234567-8) or equivalent " +
          "tax ID for foreign vendors (e.g. Irish VAT number 'IE8256796U'). " +
          "Return exactly as printed.",
      },
      invoiceNumber: {
        type: ["string", "null"],
        description: "The invoice number as printed by the vendor.",
      },
      invoiceDate: {
        type: ["string", "null"],
        description: "Date the invoice was issued, in ISO 8601 format YYYY-MM-DD.",
      },
      dueDate: {
        type: ["string", "null"],
        description: "Payment due date, in ISO 8601 format YYYY-MM-DD.",
      },
      currency: {
        type: ["string", "null"],
        description: "ISO 4217 currency code, e.g. EUR, USD, SEK.",
      },
      netAmount: {
        type: ["number", "null"],
        description: "The amount before VAT.",
      },
      vatAmount: {
        type: ["number", "null"],
        description: "The VAT amount in the invoice currency.",
      },
      vatRate: {
        type: ["number", "null"],
        description: "VAT rate as a percentage, e.g. 25.5 for 25.5%. Use 0 for zero-rated or reverse-charge invoices.",
      },
      vatCode: {
        type: ["string", "null"],
        description:
          "VAT code or notation as printed (e.g. 'ALV 25.5%', 'ALV 0% (kaanteinen verovelvollisuus)').",
      },
      grossAmount: {
        type: ["number", "null"],
        description: "The total amount due (net + VAT).",
      },
      lineItems: {
        type: "array",
        description: "Itemised charges from the invoice. Empty array if not present or unreadable.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unitPrice: { type: "number" },
          },
          required: ["description", "quantity", "unitPrice"],
        },
      },
      extractionNotes: {
        type: "string",
        description:
          "Short free-text note (max 200 chars) flagging anything unusual: " +
          "fields that were hard to read, ambiguous values, unexpected formats. " +
          "Empty string if extraction was clean.",
      },
    },
    required: [
      "vendorName",
      "invoiceNumber",
      "grossAmount",
      "lineItems",
      "extractionNotes",
    ],
  },
};

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // ---------------------------------------------------------------------
    // 1. Parse and validate input
    // ---------------------------------------------------------------------
    const body = await request.json();
    const { filename } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid 'filename' in request body.",
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // Security: prevent path traversal. Filename must be a bare filename,
    // not a path like '../../../etc/passwd'.
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return NextResponse.json(
        {
          success: false,
          error: "Filename must not contain path separators.",
          code: "INVALID_FILENAME",
        },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------------------
    // 2. Read the PDF from disk
    // ---------------------------------------------------------------------
    const filePath = path.join(MOCK_INVOICE_DIR, filename);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await fs.readFile(filePath);
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not read PDF: ${filename}. File not found in lib/mock-invoices/.`,
          code: "FILE_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    // Base64-encode the PDF. This is the only way to ship a binary file
    // through a JSON payload to Claude's document API.
    const pdfBase64 = pdfBuffer.toString("base64");

    // ---------------------------------------------------------------------
    // 3. Call Claude Haiku with the PDF and the extract_invoice tool
    // ---------------------------------------------------------------------
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [EXTRACT_INVOICE_TOOL],
      // tool_choice forces Claude to call the specific tool.
      // Without this, Claude might return text instead of tool input.
      tool_choice: { type: "tool", name: "extract_invoice" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text:
                "Extract the structured invoice data from this PDF using the " +
                "extract_invoice tool. The invoice is a Finnish supplier invoice. " +
                "Follow the tool's field descriptions precisely. Return null for any " +
                "field that is missing or unreadable - do not invent values.",
            },
          ],
        },
      ],
    });

    // ---------------------------------------------------------------------
    // 4. Extract the tool_use block from Claude's response
    // ---------------------------------------------------------------------
    // Claude's response can contain multiple content blocks (text, tool_use, etc).
    // We're looking for the tool_use block. If Claude refused to call the tool
    // for any reason, this will not be found.
    const toolUseBlock = message.content.find(
      (block) => block.type === "tool_use" && block.name === "extract_invoice"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        {
          success: false,
          error: "Claude did not return a tool_use block. The PDF may be malformed or unreadable.",
          code: "NO_TOOL_USE",
          rawResponse: message.content,
        },
        { status: 502 }
      );
    }

    const extraction = toolUseBlock.input;

    // ---------------------------------------------------------------------
    // 5. Return the structured extraction
    // ---------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      filename,
      extraction,
      modelUsed: MODEL,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      stopReason: message.stop_reason,
    });
  } catch (err) {
    // Distinguish between expected upstream errors (malformed PDF, rate limit,
    // auth) and genuine internal errors so the UI in Stage 8 can show the
    // right message and the right triage lane.
    console.error("Extraction route error:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);

    // Anthropic API returned 400 Bad Request - usually a malformed PDF
    if (
      errorMessage.includes("PDF specified was not valid") ||
      errorMessage.includes("invalid_request_error")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "The PDF could not be parsed. The file may be corrupt, malformed, or password-protected.",
          code: "INVALID_PDF",
        },
        { status: 422 }
      );
    }

    // Anthropic API returned 401 - shouldn't happen at runtime if key is valid,
    // but possible if key gets rotated mid-session
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

    // Anthropic API returned 429 - rate limit
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

    // Genuine internal error - bug in our code, network failure, etc.
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