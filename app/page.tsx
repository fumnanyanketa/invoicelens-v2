import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-semibold text-neutral-900">InvoiceLens v2</h1>
        <p className="text-neutral-600">AP triage for Saaristo Logistics Oy</p>
        <div className="pt-4">
          <Link
            href="/triage"
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Open triage queue
          </Link>
        </div>
      </div>
    </div>
  );
}