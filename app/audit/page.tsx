/**
 * /audit - the immutable audit log.
 *
 * Server component. Fetches every AuditLog entry joined with its Invoice,
 * renders the table.
 *
 * No filtering, no search, no pagination for v2. Newest decisions first.
 */

import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { AuditTable } from "./_components/audit-table";

export const dynamic = "force-dynamic";

async function fetchAuditEntries() {
  return prisma.auditLog.findMany({
    include: {
      invoice: {
        include: { vendor: true },
      },
    },
    orderBy: { timestamp: "desc" },
  });
}

export default async function AuditPage() {
  const entries = await fetchAuditEntries();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              InvoiceLens v2 — Audit Log
            </h1>
            <p className="text-sm text-neutral-500">
              Saaristo Logistics Oy &middot; Immutable record of every AP decision
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/triage"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              ← Back to triage
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-neutral-600">
            {entries.length} {entries.length === 1 ? "decision" : "decisions"} on record
          </div>
        </div>

        <AuditTable entries={entries} />
      </main>
    </div>
  );
}