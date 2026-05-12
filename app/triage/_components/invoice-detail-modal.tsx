"use client";

/**
 * Invoice detail modal. Shows full extraction, AI reasoning, confidence breakdown,
 * and a single-action decision form.
 *
 * Interaction model (v2, after first-pass UX issues):
 *   - User picks ONE action via radio: approve / edit / block
 *   - If edit: dropdown appears for GL code override
 *   - Reasoning text area (required for block, recommended for edit)
 *   - One submit button. One cancel button.
 */

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitDecision } from "@/app/actions/submit-decision";
import { toast } from "sonner";
import type { Invoice, Vendor } from "@/lib/generated/prisma/models";

interface InvoiceDetailModalProps {
  invoice: Invoice & { vendor: Vendor | null };
  snapshot: any;
  open: boolean;
  onClose: () => void;
}

type DecisionMode = "APPROVED" | "EDITED" | "BLOCKED";

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
];

export function InvoiceDetailModal({ invoice, snapshot, open, onClose }: InvoiceDetailModalProps) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<DecisionMode>("APPROVED");
  const [overrideCode, setOverrideCode] = useState<string>(invoice.glCodeSuggestion ?? "9000");
  const [reasoning, setReasoning] = useState("");

  const formatAmount = (n: number | null | undefined) => {
    if (n === null || n === undefined) return "—";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: invoice.currency || "EUR",
      maximumFractionDigits: 2,
    }).format(n);
  };

  const aiSuggestedCode = invoice.glCodeSuggestion;
  const aiSuggestedName =
    GL_CODES.find((c) => c.code === aiSuggestedCode)?.name ?? "(no GL suggested)";

  const handleSubmit = () => {
    // Validation: BLOCKED requires reasoning
    if (mode === "BLOCKED" && reasoning.trim().length === 0) {
      toast.error("Blocking an invoice requires a reasoning note explaining why.");
      return;
    }

    startTransition(async () => {
      const result = await submitDecision({
        invoiceId: invoice.id,
        action: mode,
        overrideGlCode: mode === "EDITED" ? overrideCode : undefined,
        reasoning: reasoning.trim() || undefined,
      });

      if (result.success) {
        const verb =
          mode === "APPROVED" ? "approved" : mode === "EDITED" ? "reclassified" : "blocked";
        toast.success(`Invoice ${verb}. Audit log id ${result.auditLogId}.`);
        onClose();
      } else {
        toast.error(result.error ?? "Decision failed.");
      }
    });
  };

  const handleClose = () => {
    // Reset form state for next time the modal opens
    setMode("APPROVED");
    setOverrideCode(invoice.glCodeSuggestion ?? "9000");
    setReasoning("");
    onClose();
  };

  const ai = snapshot?.reasoning;
  const conf = snapshot?.confidence;
  const checks = snapshot?.checks;
  const hardFail = snapshot?.hardFailReason;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{invoice.vendorName ?? "(unknown vendor)"}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {invoice.invoiceNumber ?? "no number"}
            </Badge>
            <Badge
              className={
                invoice.lane === "GREEN"
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                  : invoice.lane === "AMBER"
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  : "bg-rose-100 text-rose-800 hover:bg-rose-100"
              }
            >
              {invoice.lane}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Headline amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md bg-neutral-50 p-3">
              <div className="text-xs text-neutral-500">Gross</div>
              <div className="font-semibold">{formatAmount(invoice.grossAmount)}</div>
            </div>
            <div className="rounded-md bg-neutral-50 p-3">
              <div className="text-xs text-neutral-500">Net</div>
              <div className="font-semibold">
                {formatAmount(
                  invoice.grossAmount !== null && invoice.vatAmount !== null
                    ? invoice.grossAmount - invoice.vatAmount
                    : null
                )}
              </div>
            </div>
            <div className="rounded-md bg-neutral-50 p-3">
              <div className="text-xs text-neutral-500">VAT</div>
              <div className="font-semibold">
                {formatAmount(invoice.vatAmount)}{" "}
                {invoice.vatRate !== null ? `(${invoice.vatRate}%)` : ""}
              </div>
            </div>
          </div>

          {/* Hard-fail banner */}
          {hardFail && (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-3">
              <div className="text-xs font-semibold text-rose-900 uppercase tracking-wide">
                Hard-fail: {hardFail.replace(/_/g, " ")}
              </div>
              {checks?.sanctions?.matchedEntry && (
                <div className="mt-2 text-xs text-rose-800">
                  Matched sanctions entry{" "}
                  <span className="font-mono">{checks.sanctions.matchedEntry.id}</span>:{" "}
                  {checks.sanctions.matchedEntry.name}
                  <div className="mt-1">{checks.sanctions.matchedEntry.listingReference}</div>
                  <div className="text-rose-700">{checks.sanctions.matchedEntry.rationale}</div>
                </div>
              )}
              {checks?.duplicate?.isStrongDuplicate && (
                <div className="mt-2 text-xs text-rose-800">{checks.duplicate.notes}</div>
              )}
            </div>
          )}

          {/* AI reasoning */}
          {ai && (
            <>
              <Separator />
              <div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  AI Suggestion
                </div>
                <div className="rounded-md border border-neutral-200 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">
                      {ai.glCode}
                    </Badge>
                    <span className="text-sm font-medium">{ai.glCodeName}</span>
                    <span className="text-xs text-neutral-500 ml-auto">
                      Sonnet confidence: {(ai.glConfidenceComponent ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-sm text-neutral-700">{ai.oneLineSummary}</div>
                  <div className="space-y-1 text-xs text-neutral-600 mt-2">
                    {ai.vendorMatchEvidence && (
                      <div>
                        <b>Vendor:</b> {ai.vendorMatchEvidence}
                      </div>
                    )}
                    {ai.lineItemAnalysis && (
                      <div>
                        <b>Line items:</b> {ai.lineItemAnalysis}
                      </div>
                    )}
                    {ai.historicalPattern && (
                      <div>
                        <b>History:</b> {ai.historicalPattern}
                      </div>
                    )}
                    {ai.reasoningNotes && (
                      <div>
                        <b>Notes:</b> {ai.reasoningNotes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Confidence components */}
          {conf && (
            <>
              <Separator />
              <div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  Confidence components
                </div>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div className="rounded bg-neutral-50 p-2">
                    <div className="text-neutral-500">Extraction</div>
                    <div className="font-mono">{(conf.extractionCompleteness ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded bg-neutral-50 p-2">
                    <div className="text-neutral-500">Vendor</div>
                    <div className="font-mono">{(conf.vendorMatchScore ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded bg-neutral-50 p-2">
                    <div className="text-neutral-500">GL</div>
                    <div className="font-mono">{(conf.glConfidenceComponent ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded bg-neutral-50 p-2">
                    <div className="text-neutral-500">Duplicate</div>
                    <div className="font-mono">{(conf.duplicateSignal ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded bg-neutral-50 p-2">
                    <div className="text-neutral-500">Sanctions</div>
                    <div className="font-mono">{(conf.sanctionsSignal ?? 0).toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-neutral-600">
                  Composite:{" "}
                  <span className="font-mono font-semibold">
                    {(conf.composite ?? 0).toFixed(3)}
                  </span>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* DECISION FORM - single action, clear hierarchy */}
          <div>
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
              Your decision
            </div>

            <div className="space-y-3">
              {/* Option 1: Approve */}
              <label
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  mode === "APPROVED"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="APPROVED"
                  checked={mode === "APPROVED"}
                  onChange={() => setMode("APPROVED")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">Approve as suggested</div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    Pay this invoice with GL code{" "}
                    <span className="font-mono">{aiSuggestedCode ?? "—"}</span> ({aiSuggestedName})
                  </div>
                </div>
              </label>

              {/* Option 2: Edit GL code */}
              <label
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  mode === "EDITED"
                    ? "border-blue-500 bg-blue-50"
                    : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="EDITED"
                  checked={mode === "EDITED"}
                  onChange={() => setMode("EDITED")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">Reclassify with a different GL code</div>
                  <div className="text-xs text-neutral-600 mt-0.5 mb-2">
                    Pay this invoice but override the suggested code
                  </div>
                  {mode === "EDITED" && (
                    <Select value={overrideCode} onValueChange={setOverrideCode}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GL_CODES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            <span className="font-mono mr-2">{c.code}</span>— {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </label>

              {/* Option 3: Block */}
              <label
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  mode === "BLOCKED"
                    ? "border-rose-500 bg-rose-50"
                    : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="BLOCKED"
                  checked={mode === "BLOCKED"}
                  onChange={() => setMode("BLOCKED")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">Block this invoice</div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    Do not pay. Requires a reason below.
                  </div>
                </div>
              </label>
            </div>

            {/* Reasoning text area - always visible, label changes by mode */}
            <div className="mt-4">
              <label className="text-xs text-neutral-600">
                {mode === "APPROVED"
                  ? "Reasoning (optional)"
                  : mode === "EDITED"
                  ? "Reasoning (recommended)"
                  : "Reasoning (required)"}
              </label>
              <Textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder={
                  mode === "BLOCKED"
                    ? "Explain why this invoice should not be paid."
                    : "Note for the audit log."
                }
                className="mt-1"
                rows={3}
              />
            </div>

            {/* Submit + Cancel */}
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={handleClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={pending}
                className={
                  mode === "APPROVED"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : mode === "EDITED"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }
              >
                {pending
                  ? "Saving..."
                  : mode === "APPROVED"
                  ? "Submit approval"
                  : mode === "EDITED"
                  ? "Submit reclassification"
                  : "Submit block"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}