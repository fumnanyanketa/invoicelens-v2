/**
 * End-to-end test for the full pipeline including human decision.
 *
 * Posts a filename to /api/check, then simulates Heikki making a decision
 * (approve/edit/block) and posts that to /api/decide. Prints both results.
 *
 * Run with:
 *   npx tsx scripts/test-decide.ts <filename> <action> [overrideGlCode] [reasoning]
 *
 * Examples:
 *   npx tsx scripts/test-decide.ts INV-001-neste.pdf APPROVED
 *   npx tsx scripts/test-decide.ts INV-019-neste-typo.pdf EDITED 5100 "Reclassified to maintenance"
 *   npx tsx scripts/test-decide.ts INV-027-karelia-sanctions.pdf BLOCKED "" "Sanctions risk confirmed"
 */

const filename = process.argv[2];
const action = process.argv[3];
const overrideGlCode = process.argv[4] || undefined;
const reasoning = process.argv[5] || undefined;

if (!filename || !action) {
  console.error(
    "Usage: npx tsx scripts/test-decide.ts <filename> <APPROVED|EDITED|BLOCKED> [overrideGlCode] [reasoning]"
  );
  process.exit(1);
}

async function main() {
  // -----------------------------------------------------------------------
  // Step 1: run the full check pipeline
  // -----------------------------------------------------------------------
  console.log(`\n========== STEP 1: CHECK ==========`);
  console.log(`Posting ${filename} to /api/check...`);
  const t1 = Date.now();

  const checkResp = await fetch("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  const decisionPackage = await checkResp.json();

  console.log(`HTTP ${checkResp.status} - ${Date.now() - t1}ms`);

  if (!decisionPackage.success) {
    console.log("Check failed:");
    console.log(JSON.stringify(decisionPackage, null, 2));
    process.exit(1);
  }

  console.log(`Lane: ${decisionPackage.lane}   Composite: ${decisionPackage.confidence.composite.toFixed(3)}`);
  if (decisionPackage.hardFailReason) {
    console.log(`Hard-fail: ${decisionPackage.hardFailReason}`);
  }
  console.log(`AI suggested GL code: ${decisionPackage.reasoning?.glCode ?? "(none)"}`);

  // -----------------------------------------------------------------------
  // Step 2: simulate Heikki's decision
  // -----------------------------------------------------------------------
  console.log(`\n========== STEP 2: DECIDE ==========`);
  console.log(`Posting decision (${action}) to /api/decide...`);
  const t2 = Date.now();

  const decideResp = await fetch("http://localhost:3000/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decisionPackage,
      action,
      overrideGlCode,
      reasoning,
    }),
  });
  const decideData = await decideResp.json();

  console.log(`HTTP ${decideResp.status} - ${Date.now() - t2}ms\n`);
  console.log(JSON.stringify(decideData, null, 2));

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  if (decideData.success) {
    console.log(`\n========== SUMMARY ==========`);
    console.log(`Filename:     ${filename}`);
    console.log(`Lane:         ${decisionPackage.lane}`);
    console.log(`Action:       ${decideData.action}`);
    console.log(`Final GL:     ${decideData.finalGlCode ?? "(blocked, no GL committed)"}`);
    console.log(`Invoice ID:   ${decideData.invoiceId}`);
    console.log(`Audit Log ID: ${decideData.auditLogId}`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});