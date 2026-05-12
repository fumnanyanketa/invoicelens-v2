"use client";

/**
 * Audit table - lists all audit log entries with expandable detail rows.
 * Client component because rows manage expand/collapse state.
 */

import { useState } from "react";
import { AuditRow } from "./audit-row";
import { CsvExportButton } from "./csv-export-button";
import type { AuditLog, Invoice, Vendor } from "@/lib/generated/prisma/models";

type AuditEntry = AuditLog & {
  invoice: Invoice & { vendor: Vendor | null };
};

interface AuditTableProps {
  entries: AuditEntry[];
}

export function AuditTable({ entries }: AuditTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg bg-white border border-neutral-200 p-12 text-center">
        <p className="text-neutral-600">No decisions have been made yet.</p>
        <p className="text-sm text-neutral-500 mt-1">
          Approve, edit, or block invoices on the triage queue to populate this log.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white border border-neutral-200 overflow-hidden">
      <div className="border-b border-neutral-200 px-4 py-3 flex items-center justify-end">
        <CsvExportButton entries={entries} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-medium">Decided</th>
              <th className="px-4 py-3 font-medium">By</th>
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">AI suggested</th>
              <th className="px-4 py-3 font-medium">Human action</th>
              <th className="px-4 py-3 font-medium w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}