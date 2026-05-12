"use client";

/**
 * Single invoice card in the triage queue. Click to open detail modal.
 *
 * v2 styling ported from v0.dev:
 * - Lane-coloured accent bar on the left edge
 * - Lane-coloured confidence number in top right
 * - Finnish-locale amount formatting (5 294,22 €)
 * - Hard-fail tag as a bordered pill
 */

import { useState } from "react";
import { cn, formatEuro } from "@/lib/utils";
import { InvoiceDetailModal } from "./invoice-detail-modal";
import type { InvoiceModel, VendorModel } from "@/lib/generated/prisma/models";

interface InvoiceCardProps {
  invoice: InvoiceModel & { vendor: VendorModel | null };
  lane: "GREEN" | "AMBER" | "RED";
}

const ACCENT_BAR: Record<"GREEN" | "AMBER" | "RED", string> = {
  GREEN: "bg-status-green",
  AMBER: "bg-status-amber",
  RED: "bg-status-rose",
};

function confidenceColour(score: number | null): string {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 0.9) return "text-status-green";
  if (score >= 0.6) return "text-status-amber";
  return "text-status-rose";
}

export function InvoiceCard({ invoice, lane }: InvoiceCardProps) {
  const [open, setOpen] = useState(false);

  const decisionSnapshot = (() => {
    try {
      return JSON.parse(invoice.lineItems);
    } catch {
      return null;
    }
  })();

  const oneLine = decisionSnapshot?.reasoning?.oneLineSummary ?? null;
  const hardFail = decisionSnapshot?.hardFailReason ?? null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "group relative flex w-full shrink-0 text-left cursor-pointer overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150",
          "hover:border-border/80 hover:shadow-md"
        )}
      >
        {/* Lane accent bar */}
        <div className={cn("w-1 shrink-0", ACCENT_BAR[lane])} />

        <div className="flex flex-1 flex-col gap-2 p-4">
          {/* VendorModel + confidence */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground leading-tight text-pretty">
              {invoice.vendorName ?? "(unknown vendor)"}
            </h3>
            <span
              className={cn(
                "shrink-0 font-mono text-xs font-medium tabular-nums",
                confidenceColour(invoice.confidenceScore)
              )}
            >
              {invoice.confidenceScore !== null
                ? invoice.confidenceScore.toFixed(2)
                : "—"}
            </span>
          </div>

          {/* Gross amount */}
          <p className="text-lg font-semibold tracking-tight text-foreground tabular-nums">
            {formatEuro(invoice.grossAmount, invoice.currency)}
          </p>

          {/* InvoiceModel number + GL code */}
          <p className="text-xs text-muted-foreground">
            {invoice.invoiceNumber ?? "(no number)"} &middot; {invoice.glCodeSuggestion ?? "—"}
          </p>

          {/* Hard-fail pill or AI summary */}
          {hardFail ? (
            <span className="mt-1 inline-flex w-fit items-center rounded-md border border-status-rose-border bg-status-rose-bg px-2 py-0.5 text-xs font-medium text-status-rose">
              {hardFail.replace(/_/g, " ")}
            </span>
          ) : oneLine ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
              {oneLine}
            </p>
          ) : null}
        </div>
      </button>

      <InvoiceDetailModal
        invoice={invoice}
        snapshot={decisionSnapshot}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}