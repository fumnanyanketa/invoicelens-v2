/**
 * One column of the triage queue (GREEN, AMBER, or RED).
 *
 * Server component. v2 styling ported from v0.dev:
 * - Single-line header with descriptive label
 * - Solid-fill count pill in lane colour
 * - Soft tinted column header background
 */

import { cn } from "@/lib/utils";
import { InvoiceCard } from "./invoice-card";
import type { InvoiceModel, VendorModel } from "@/lib/generated/prisma/models";

type Lane = "GREEN" | "AMBER" | "RED";

interface LaneConfig {
  title: string;
  headerBg: string;
  countBg: string;
}

interface LaneColumnProps {
  lane: Lane;
  invoices: Array<InvoiceModel & { vendor: VendorModel | null }>;
}

const LANE_CONFIG: Record<Lane, LaneConfig> = {
  GREEN: {
    title: "Auto-suggest",
    headerBg: "bg-status-green-bg",
    countBg: "bg-status-green",
  },
  AMBER: {
    title: "Review",
    headerBg: "bg-status-amber-bg",
    countBg: "bg-status-amber",
  },
  RED: {
    title: "Block",
    headerBg: "bg-status-rose-bg",
    countBg: "bg-status-rose",
  },
};

export function LaneColumn({ lane, invoices }: LaneColumnProps) {
  const config = LANE_CONFIG[lane];

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card/50 overflow-hidden">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 border-b border-border",
          config.headerBg
        )}
      >
        <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
        <span
          className={cn(
            "flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums text-white",
            config.countBg
          )}
        >
          {invoices.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 p-3 overflow-y-auto max-h-[calc(100vh-220px)]">
        {invoices.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No invoices in this lane.
          </p>
        ) : (
          invoices.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} lane={lane} />
          ))
        )}
      </div>
    </div>
  );
}