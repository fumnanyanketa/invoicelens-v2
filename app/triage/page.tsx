/**
 * /triage - the AP triage queue.
 *
 * Server component. Fetches all PENDING invoices from the database, groups
 * them by lane, renders three columns (GREEN / AMBER / RED).
 *
 * Decided invoices (APPROVED / EDITED / BLOCKED) live on /audit, not here.
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { LaneColumn } from "./_components/lane-column";

export const dynamic = "force-dynamic"; // always fresh, no static caching

type LaneInvoice = Awaited<ReturnType<typeof fetchPendingInvoices>>[number];

async function fetchPendingInvoices() {
  return prisma.invoice.findMany({
    where: { status: "PENDING" },
    include: { vendor: true },
    orderBy: [
      { lane: "asc" }, // GREEN/AMBER/RED alphabetical (AMBER, GREEN, RED) - we override below
      { confidenceScore: "desc" },
    ],
  });
}

export default async function TriagePage() {
  const invoices = await fetchPendingInvoices();

  const green = invoices.filter((i) => i.lane === "GREEN");
  const amber = invoices.filter((i) => i.lane === "AMBER");
  const red = invoices.filter((i) => i.lane === "RED");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">InvoiceLens v2</h1>
            <p className="text-sm text-neutral-500">
              Saaristo Logistics Oy &middot; AP Triage Queue
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/audit"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Audit log →
            </Link>
            <div className="text-sm text-neutral-700">
              <div className="font-medium">Heikki Lindqvist</div>
              <div className="text-neutral-500 text-xs">AP Specialist</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 text-sm text-neutral-600">
          {invoices.length} invoices pending review
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <LaneColumn lane="GREEN" invoices={green} />
          <LaneColumn lane="AMBER" invoices={amber} />
          <LaneColumn lane="RED" invoices={red} />
        </div>
      </main>
    </div>
  );
}