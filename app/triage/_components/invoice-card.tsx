"use client";

/**
 * Single invoice card in the triage queue. Click to open detail modal.
 *
 * Client component because clicking opens the modal (interactive state).
 */

import { useState } from "react";
import { InvoiceDetailModal } from "./invoice-detail-modal";
import type { Invoice, Vendor } from "@/lib/generated/prisma/models";

interface InvoiceCardProps {
  invoice: Invoice & { vendor: Vendor | null };
  laneAccent: string;
}

export function InvoiceCard({ invoice, laneAccent }: InvoiceCardProps) {
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

  const formatAmount = (n: number | null) => {
    if (n === null || n === undefined) return "—";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: invoice.currency || "EUR",
      maximumFractionDigits: 2,
    }).format(n);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-md border border-neutral-200 bg-white p-3 hover:border-neutral-300 hover:shadow-sm transition-all relative overflow-hidden"
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${laneAccent}`} />

        <div className="pl-2">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="font-medium text-sm text-neutral-900 truncate">
              {invoice.vendorName ?? "(unknown vendor)"}
            </div>
            <div className="text-xs font-mono text-neutral-500 shrink-0">
              {invoice.confidenceScore !== null
                ? invoice.confidenceScore.toFixed(2)
                : "—"}
            </div>
          </div>

          <div className="text-sm font-semibold text-neutral-900 mb-1">
            {formatAmount(invoice.grossAmount)}
          </div>

          <div className="text-xs text-neutral-500 mb-1">
            {invoice.invoiceNumber ?? "(no number)"} &middot; {invoice.glCodeSuggestion ?? "—"}
          </div>

          {hardFail ? (
            <div className="text-xs font-medium text-rose-700 mt-1">
              {hardFail.replace(/_/g, " ")}
            </div>
          ) : oneLine ? (
            <div className="text-xs text-neutral-600 line-clamp-2 mt-1">
              {oneLine}
            </div>
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