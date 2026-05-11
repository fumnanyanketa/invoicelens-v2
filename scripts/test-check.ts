/**
 * Test driver for the orchestrator route.
 *
 * Posts a filename to /api/check, prints the full decision package with
 * lane assignment, composite confidence, and all signal components.
 *
 * Run with:
 *   npx tsx scripts/test-check.ts INV-001-neste.pdf
 *
 * Requires: dev server running on localhost:3000.
 */

const filename = process.argv[2];

if (!filename) {
  console.error("Usage: npx tsx scripts/test-check.ts <filename>");
  process.exit(1);
}

async function main() {
  console.log(`\nPosting ${filename} to /api/check...`);
  const start = Date.now();

  const resp = await fetch("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });

  const data = await resp.json();
  const elapsedMs = Date.now() - start;
  console.log(`HTTP ${resp.status} - ${elapsedMs}ms\n`);

  if (!data.success) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Summary banner
  // -----------------------------------------------------------------------
  const laneColour = data.lane === "GREEN" ? "\x1b[32m" : data.lane === "AMBER" ? "\x1b[33m" : "\x1b[31m";
  const reset = "\x1b[0m";
  console.log(`========================================`);
  console.log(`  LANE: ${laneColour}${data.lane}${reset}`);
  console.log(`  Composite confidence: ${data.confidence.composite.toFixed(3)}`);
  if (data.hardFailReason) {
    console.log(`  Hard-fail: ${data.hardFailReason}`);
  }
  console.log(`========================================\n`);

  // -----------------------------------------------------------------------
  // Vendor match
  // -----------------------------------------------------------------------
  if (data.checks?.vendorMatch) {
    const v = data.checks.vendorMatch;
    console.log(`Vendor match:`);
    console.log(`  Extracted name: ${data.extraction?.vendorName ?? "(none)"}`);
    console.log(`  Match: ${v.matchedVendorName ?? "(no match)"}`);
    console.log(`  Match type: ${v.matchType}`);
    console.log(`  Score: ${v.score.toFixed(3)}\n`);
  }

  // -----------------------------------------------------------------------
  // Sanctions
  // -----------------------------------------------------------------------
  if (data.checks?.sanctions) {
    const s = data.checks.sanctions;
    console.log(`Sanctions check:`);
    console.log(`  Hit: ${s.hit ? "YES" : "no"}`);
    if (s.hit && s.matchedEntry) {
      console.log(`  Matched entry: ${s.matchedEntry.name} (${s.matchedEntry.id})`);
      console.log(`  Listing: ${s.matchedEntry.listingReference}`);
      console.log(`  Rationale: ${s.matchedEntry.rationale}`);
    }
    console.log();
  }

  // -----------------------------------------------------------------------
  // Duplicate
  // -----------------------------------------------------------------------
  if (data.checks?.duplicate) {
    const d = data.checks.duplicate;
    console.log(`Duplicate check:`);
    console.log(`  Strong duplicate: ${d.isStrongDuplicate ? "YES" : "no"}`);
    console.log(`  Weak duplicate: ${d.isWeakDuplicate ? "yes" : "no"}`);
    console.log(`  Notes: ${d.notes}\n`);
  }

  // -----------------------------------------------------------------------
  // Reasoning
  // -----------------------------------------------------------------------
  if (data.reasoning) {
    console.log(`Reasoning (Sonnet):`);
    console.log(`  GL code: ${data.reasoning.glCode} ${data.reasoning.glCodeName}`);
    console.log(`  Confidence: ${data.reasoning.glConfidenceComponent}`);
    console.log(`  Summary: ${data.reasoning.oneLineSummary}\n`);
  }

  // -----------------------------------------------------------------------
  // Confidence breakdown
  // -----------------------------------------------------------------------
  console.log(`Confidence components:`);
  console.log(`  Extraction completeness:  ${data.confidence.extractionCompleteness.toFixed(3)}  (weight 0.20)`);
  console.log(`  Vendor match score:       ${data.confidence.vendorMatchScore.toFixed(3)}  (weight 0.30)`);
  console.log(`  GL confidence (Sonnet):   ${data.confidence.glConfidenceComponent.toFixed(3)}  (weight 0.25)`);
  console.log(`  Duplicate signal:         ${data.confidence.duplicateSignal.toFixed(3)}  (weight 0.10)`);
  console.log(`  Sanctions signal:         ${data.confidence.sanctionsSignal.toFixed(3)}  (weight 0.15)`);
  console.log(`  -------------------------`);
  console.log(`  Composite:                ${data.confidence.composite.toFixed(3)}`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});