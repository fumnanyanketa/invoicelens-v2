/**
 * One column of the triage queue (GREEN, AMBER, or RED).
 *
 * Server component. Renders a header with lane label + count, then the cards.
 */

import { InvoiceCard } from "./invoice-card";
import type { Invoice, Vendor } from "@/lib/generated/prisma/models";

interface LaneColumnProps {
  lane: "GREEN" | "AMBER" | "RED";
  invoices: Array<Invoice & { vendor: Vendor | null }>;
}

const LANE_STYLES = {
  GREEN: {
    headerBg: "bg-emerald-50",
    headerText: "text-emerald-900",
    badge: "bg-emerald-100 text-emerald-800",
    accentBar: "bg-emerald-500",
    label: "Auto-suggest",
  },
  AMBER: {
    headerBg: "bg-amber-50",
    headerText: "text-amber-900",
    badge: "bg-amber-100 text-amber-800",
    accentBar: "bg-amber-500",
    label: "Review",
  },
  RED: {
    headerBg: "bg-rose-50",
    headerText: "text-rose-900",
    badge: "bg-rose-100 text-rose-800",
    accentBar: "bg-rose-500",
    label: "Block",
  },
};

export function LaneColumn({ lane, invoices }: LaneColumnProps) {
  const style = LANE_STYLES[lane];

  return (
    <div className="rounded-lg bg-white border border-neutral-200 overflow-hidden">
      <div className={`${style.headerBg} px-4 py-3 border-b border-neutral-200 flex items-center justify-between`}>
        <div>
          <div className={`text-sm font-semibold ${style.headerText}`}>
            {lane}
          </div>
          <div className="text-xs text-neutral-500">{style.label}</div>
        </div>
        <div className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
          {invoices.length}
        </div>
      </div>

      <div className="p-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        {invoices.length === 0 ? (
          <div className="text-center py-8 text-sm text-neutral-400">
            No invoices in this lane.
          </div>
        ) : (
          invoices.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} laneAccent={style.accentBar} />
          ))
        )}
      </div>
    </div>
  );
}