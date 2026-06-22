# InvoiceLens v2 — Repository Status Report

_Generated 2026-06-22 from a file-level audit of the repository. Findings are based on reading the code and data, not on commit messages or branch names._

> **Verification note (diagnostic-first):** The authoritative server query
> `git ls-remote --heads origin` returns exactly **2 branches**. The locally
> visible count matches (2). This report covers **all 2** server branches. The
> two branches share history (merge-base = `main`'s HEAD), so neither is an
> orphan, and they are **not** separate projects.

---

## 1. Branches

There are only **two branches**, and their application code is **byte-for-byte identical** — there is no stranded, stale, orphan, or unmerged *code* anywhere in the repo. The only difference between them is this report file.

| Branch | Last code commit | Ahead / behind `main` | What's actually in it |
|---|---|---|---|
| `main` | 2026-05-12 | — (reference) | The entire project. 18 commits, "Stage 1 → Stage 10d". Does **not** contain STATUS.md. |
| `claude/blissful-fermat-rt1cnp` | 2026-05-12 (code); STATUS.md added 2026-06-22 | **+1 / 0** | Identical to `main` plus a single commit that adds **only `STATUS.md`** (this file). No code differences vs `main`. Working branch for this report. |

- **No open or closed pull requests** exist on the remote.
- The whole history is a single linear chain by one author, dated **2026-05-10 → 2026-05-12** (a ~3-day build). As of today (2026-06-22) the repo has been **untouched for ~6 weeks** — paused, not actively abandoned, but stalled.
- Nothing to flag as stranded. The branch picture is clean and boring (in a good way).

---

## 2. What this project actually is

**An AI-assisted Accounts Payable (AP) invoice-triage application** for a *fictional* Finnish logistics SME, "Saaristo Logistics Oy" (Turku, 180 people). The single human user is a hardcoded AP specialist, "Heikki Lindqvist."

The pipeline, as implemented:

1. **Extract** (`/api/extract`) — sends an invoice PDF to **Claude Haiku 4.5** with a forced tool-use schema (`extract_invoice`) and returns structured fields (vendor, amounts, VAT, line items). Nullable-by-design to avoid hallucination.
2. **Reason** (`/api/reasoning`) — sends the extraction + the vendor master to **Claude Sonnet 4.6**, which must pick a GL (general-ledger) code from a **bounded 12-entry chart of accounts** and explain its reasoning.
3. **Check / orchestrate** (`/api/check`) — runs three deterministic checks in code: fuzzy **vendor-master match** (fuse.js + Sørensen–Dice bigram similarity), **EU sanctions screening**, and **duplicate detection**; combines them with the AI confidence into a weighted **composite score** and routes the invoice into a **GREEN / AMBER / RED** lane. Sanctions hit or strong duplicate = hard-fail → RED.
4. **Scan** (`/api/scan`) — batch-processes every PDF in `lib/mock-invoices/` not yet in the DB, persisting each as a `PENDING` invoice.
5. **Decide** (`/api/decide`) + server action — Heikki approves / edits the GL code / blocks via a kanban UI; the decision and a full AI-recommendation snapshot are written to an **immutable audit log** inside a DB transaction.

Stack: **Next.js 16** (App Router, React 19, Turbopack), **Prisma 7** on **PostgreSQL** (Neon in prod) via `@prisma/adapter-pg`, **Anthropic SDK**, **shadcn/Radix** UI, Tailwind v4.

> **Note on intent:** nearly every route carries an `Exam mapping: Domain N …` comment. This is clearly built as a **portfolio / certification-exam demonstration artifact** (it maps to an "agentic AI" exam's domains), *not* as a product headed for real customers. That reframes everything below — judged as a demo it is near-complete; judged as a product it has real gaps.

---

## 3. Genuinely built vs. stubbed

### Genuinely built and substantive
- **Data model** — `prisma/schema.prisma` with `Vendor`, `Invoice`, `AuditLog`, indexes, relations; 2 real migrations.
- **All 5 API routes** — real logic, thorough error mapping (INVALID_PDF / RATE_LIMIT / AUTH_ERROR / NO_TOOL_USE …), path-traversal guard, transactional writes.
- **Confidence/lane engine** — weighted composite, calibrated thresholds (documented to "v1.2"), name-mismatch penalty even on exact Y-tunnus match. This is the cleverest part of the codebase.
- **Full UI** — landing page, 3-lane triage kanban (cards + detail modal + radio decision form with validation), audit log page (table, expandable rows, CSV export). Finnish-locale formatting, v0.dev design tokens.
- **Seed + fixtures** — 8 vendors (incl. a deliberately RU-sanctioned one and a Microsoft-Ireland foreign-VAT case), 12 sanctions entries, **30 mock invoice PDFs** purpose-built to exercise edge cases (typo vendor, unknown vendor, amount anomaly, missing Y-tunnus, sanctions hit, duplicate, malformed, extreme amount…).
- **Tooling** — a 731-line PDF generator and several real maintenance scripts (`rescan-pending`, `backfill-one`, `find-missing`, `lane-summary`).

### Stubbed, placeholder, or missing
- **README** is still the **default `create-next-app` boilerplate** — zero project documentation, setup, or architecture notes.
- **No tests of any kind.** Commit "Stage 10d" explicitly *removed* the test drivers.
- **No authentication.** `userId` is hardcoded `"heikki"` in the schema and `/api/decide`.
- **No real file upload.** The system only operates on PDFs pre-placed in `lib/mock-invoices/`.
- **Sanctions Y-tunnus exact-match pass is a no-op stub** (`// Future:` comment, empty block).
- **Known data-model hack (self-documented):** the full decision snapshot is stuffed into the `Invoice.lineItems` field; `/api/decide` creates a *new* row and the server action then **deletes** the original `PENDING` row to avoid duplicates ("Future refactor: should update-in-place").
- **No `.env.example`** and the generated Prisma client (`lib/generated/prisma`) is gitignored — required secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`) are undocumented.
- **Minor:** `next.config.ts` carries a **UTF-8 BOM** — ironic, since Stage 10b explicitly stripped BOMs from other files. `AGENTS.md` tells contributors to read `node_modules/next/dist/docs/` but `node_modules` isn't present in a fresh clone.

### Rough completeness
- **As an exam/demo artifact: ~85–90% complete.**
- **As a production product: ~55–60%** (no auth, no upload, no tests, no docs, deploy unverified).

---

## 4. What's left to finish + the single biggest blocker

To finish: real PDF upload, authentication, the `/api/decide` in-place-update refactor (kill the create-then-delete dance), a test suite, real project docs, and a verified deploy.

**Single biggest blocker: fresh-clone runnability is unverified and externally gated.** The app cannot start without (a) `npm install`, (b) `prisma generate` (client is gitignored), (c) a live **Neon/Postgres `DATABASE_URL`**, and (d) a valid **`ANTHROPIC_API_KEY`** — none of which are committed or documented anywhere (`.env*` is gitignored, no `.env.example`, README is boilerplate). Until someone confirms it boots and a `/api/scan` run succeeds end-to-end, "it works" is an assumption.

---

## 5. Quick wins (nearly done)
- **Add `.env.example`** listing `DATABASE_URL` + `ANTHROPIC_API_KEY` (≈5 min) — removes most of the blocker's friction.
- **Replace the boilerplate README** with the setup/run steps + the pipeline diagram (the code comments already contain the content).
- **Strip the BOM** from `next.config.ts`.
- **Smoke-test the boot path** (install → generate → seed → scan) and write down what actually happens.

---

## 6. Blunt recommendation: **KEEP / FINISH**

This is **not** throwaway code and should **not** be discarded or archived. For a 3-day build it's coherent, well-commented, architecturally honest (bounded output spaces, nullable extraction, human-in-the-loop audit trail, deterministic checks separated from AI judgment), and the remaining work is **bounded and well-understood**.

Caveats that temper the enthusiasm:
- It's a **single-user, fixed-dataset demo**, explicitly exam-oriented. If the goal was only the exam, it's essentially **done** — finish the docs and call it.
- If the goal is a real product, the gap to production (auth, upload, tests, multi-tenant, deploy) is the larger half of the work, and it's been **idle 6 weeks**.
- Do **not** merge into another project — it's self-contained and there's nothing to merge it *with* (no sibling branches/PRs).

Decision: **keep and finish the thin layer that makes it runnable and credible** (docs + env + boot verification), then decide demo-vs-product before investing in auth/upload/tests.

---

## 7. Next actions (prioritized)

- [ ] Add `.env.example` documenting `DATABASE_URL` and `ANTHROPIC_API_KEY`, and confirm a fresh clone boots (`npm install` → `prisma generate` → `db seed`).
- [ ] Run `/api/scan` end-to-end against the 30 mock PDFs and record the GREEN/AMBER/RED outcome; capture any failures.
- [ ] Replace the boilerplate README with real setup + pipeline/architecture docs.
- [ ] Refactor `/api/decide` to update the `PENDING` row in place; delete the create-then-delete hack in `submit-decision.ts`.
- [ ] Add a minimal test suite (confidence/lane math, vendor & sanctions matching, decide-route validation).
- [ ] Decide scope: **exam demo** (then freeze) **vs. product** (then schedule auth + real PDF upload).
- [ ] Housekeeping: strip the UTF-8 BOM from `next.config.ts`; finish or remove the sanctions Y-tunnus stub.
