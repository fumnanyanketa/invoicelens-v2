"use client";

/**
 * Single audit log row, plus its expanded detail panel.
 * Click anywhere on the row to expand; click again to collapse.
 */

import type { AuditLog, Invoice, Vendor } from "@/lib/generated/prisma/models";

type AuditEntry = AuditLog & {
  invoice: Invoice & { vendor: Vendor | null };
};

interface AuditRowProps {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}

const ACTION_STYLES = {
  APPROVED: "bg-emerald-100 text-emerald-800",
  EDITED: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-rose-100 text-rose-800",
  UPLOADED: "bg-neutral-100 text-neutral-700",
  EXTRACTED: "bg-neutral-100 text-neutral-700",
  REASONED: "bg-neutral-100 text-neutral-700",
};

const LANE_STYLES = {
  GREEN: "bg-emerald-50 text-emerald-800 border-emerald-200",
  AMBER: "bg-amber-50 text-amber-800 border-amber-200",
  RED: "bg-rose-50 text-rose-800 border-rose-200",
};

function formatAmount(n: number | null, currency: string | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

function parseJsonSafe(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function AuditRow({ entry, expanded, onToggle }: AuditRowProps) {
  const invoice = entry.invoice;
  const actionStyle = ACTION_STYLES[entry.action as keyof typeof ACTION_STYLES] ?? "bg-neutral-100 text-neutral-700";
  const laneStyle = invoice.lane
    ? LANE_STYLES[invoice.lane as keyof typeof LANE_STYLES]
    : "bg-neutral-50 text-neutral-700 border-neutral-200";

  const humanDecision = parseJsonSafe(entry.humanDecision);
  const aiSnapshot = parseJsonSafe(entry.aiRecommendation);

  const finalGlCode = (humanDecision?.finalGlCode as string | null) ?? null;
  const overrideGlCode = (humanDecision?.overrideGlCode as string | null) ?? null;

  return (
    <>
      <tr
        className="hover:bg-neutral-50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-neutral-700 whitespace-nowrap">
          {formatDate(entry.timestamp)}
        </td>
        <td className="px-4 py-3 text-neutral-700">{entry.userId}</td>
        <td className="px-4 py-3">
          <div className="font-medium text-neutral-900">{invoice.invoiceNumber ?? "—"}</div>
          <div className="text-xs text-neutral-500 font-mono">
            {invoice.originalFilename}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="text-neutral-900">{invoice.vendorName ?? "(unknown)"}</div>
          <div className="text-xs text-neutral-500">
            {formatAmount(invoice.grossAmount, invoice.currency)}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${laneStyle}`}
            >
              {invoice.lane ?? "—"}
            </span>
            <span className="font-mono text-xs text-neutral-700">
              {invoice.glCodeSuggestion ?? "—"}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${actionStyle}`}
            >
              {entry.action}
            </span>
            {finalGlCode && (
              <span className="font-mono text-xs text-neutral-700">{finalGlCode}</span>
            )}
            {overrideGlCode && overrideGlCode !== invoice.glCodeSuggestion && (
              <span className="text-xs text-neutral-500">
                (was {invoice.glCodeSuggestion})
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-neutral-400">
          {expanded ? "▾" : "▸"}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-neutral-50">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* AI recommendation snapshot */}
              <div className="rounded-md bg-white border border-neutral-200 p-3">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  AI recommendation snapshot
                </div>
                {aiSnapshot ? (
                  <div className="space-y-1.5 text-neutral-700">
                    {(() => {
                      const reasoning = aiSnapshot.reasoning as Record<string, unknown> | undefined;
                      const confidence = aiSnapshot.confidence as Record<string, number> | undefined;
                      const checks = aiSnapshot.checks as Record<string, unknown> | undefined;
                      const sanctions = checks?.sanctions as { hit?: boolean; matchedEntry?: { name?: string; id?: string } } | undefined;
                      return (
                        <>
                          {reasoning && (
                            <>
                              <div>
                                <b>Suggestion:</b>{" "}
                                <span className="font-mono">{reasoning.glCode as string}</span>{" "}
                                {reasoning.glCodeName as string}
                              </div>
                              <div>
                                <b>One-line:</b> {reasoning.oneLineSummary as string}
                              </div>
                              <div>
                                <b>Sonnet confidence:</b>{" "}
                                <span className="font-mono">
                                  {(reasoning.glConfidenceComponent as number)?.toFixed(2) ?? "—"}
                                </span>
                              </div>
                            </>
                          )}
                          {confidence && (
                            <div>
                              <b>Composite:</b>{" "}
                              <span className="font-mono">
                                {confidence.composite?.toFixed(3) ?? "—"}
                              </span>
                            </div>
                          )}
                          {sanctions?.hit && sanctions.matchedEntry && (
                            <div className="text-rose-700">
                              <b>Sanctions match:</b> {sanctions.matchedEntry.name} (
                              <span className="font-mono">{sanctions.matchedEntry.id}</span>)
                            </div>
                          )}
                          {(aiSnapshot.hardFailReason as string | null) && (
                            <div className="text-rose-700">
                              <b>Hard-fail:</b>{" "}
                              {(aiSnapshot.hardFailReason as string).replace(/_/g, " ")}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-neutral-500">No AI snapshot recorded.</div>
                )}
              </div>

              {/* Human decision detail */}
              <div className="rounded-md bg-white border border-neutral-200 p-3">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  Human decision
                </div>
                {humanDecision ? (
                  <div className="space-y-1.5 text-neutral-700">
                    <div>
                      <b>Action:</b> {humanDecision.action as string}
                    </div>
                    {overrideGlCode && (
                      <div>
                        <b>Override GL:</b>{" "}
                        <span className="font-mono">{overrideGlCode}</span>
                      </div>
                    )}
                    {finalGlCode && (
                      <div>
                        <b>Final GL:</b> <span className="font-mono">{finalGlCode}</span>
                      </div>
                    )}
                    {(humanDecision.reasoning as string | null) && (
                      <div>
                        <b>Reasoning:</b>{" "}
                        <span className="italic">{humanDecision.reasoning as string}</span>
                      </div>
                    )}
                    {(humanDecision.decidedAt as string | null) && (
                      <div>
                        <b>Decided at:</b> {humanDecision.decidedAt as string}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-neutral-500">No human decision recorded.</div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}