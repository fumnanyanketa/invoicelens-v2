"use client";

/**
 * CSV export button. Generates a CSV file client-side from the audit entries
 * already on the page and triggers a download.
 */

import { Button } from "@/components/ui/button";
import type { AuditLog, Invoice, Vendor } from "@/lib/generated/prisma/models";

type AuditEntry = AuditLog & {
  invoice: Invoice & { vendor: Vendor | null };
};

interface CsvExportButtonProps {
  entries: AuditEntry[];
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // If contains quote, comma, or newline, wrap in quotes and escape existing quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseJsonSafe(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function generateCsv(entries: AuditEntry[]): string {
  const headers = [
    "audit_log_id",
    "decided_at",
    "decided_by",
    "invoice_id",
    "invoice_filename",
    "invoice_number",
    "vendor_name",
    "vendor_y_tunnus",
    "gross_amount",
    "currency",
    "ai_lane",
    "ai_suggested_gl",
    "ai_composite_confidence",
    "human_action",
    "final_gl_code",
    "reasoning",
  ];

  const rows = entries.map((entry) => {
    const humanDecision = parseJsonSafe(entry.humanDecision);
    const aiSnapshot = parseJsonSafe(entry.aiRecommendation);
    const confidence = aiSnapshot?.confidence as Record<string, number> | undefined;

    return [
      entry.id,
      entry.timestamp.toISOString(),
      entry.userId,
      entry.invoice.id,
      entry.invoice.originalFilename,
      entry.invoice.invoiceNumber ?? "",
      entry.invoice.vendorName ?? "",
      entry.invoice.vendor?.yTunnus ?? "",
      entry.invoice.grossAmount ?? "",
      entry.invoice.currency ?? "",
      entry.invoice.lane ?? "",
      entry.invoice.glCodeSuggestion ?? "",
      confidence?.composite?.toFixed(3) ?? "",
      entry.action,
      (humanDecision?.finalGlCode as string | null) ?? "",
      (humanDecision?.reasoning as string | null) ?? entry.reasoning ?? "",
    ];
  });

  const lines = [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ];

  return lines.join("\n");
}

export function CsvExportButton({ entries }: CsvExportButtonProps) {
  const handleExport = () => {
    const csv = generateCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `invoicelens-audit-${timestamp}.csv`;

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Button onClick={handleExport} variant="outline" size="sm" disabled={entries.length === 0}>
      Export CSV ({entries.length})
    </Button>
  );
}