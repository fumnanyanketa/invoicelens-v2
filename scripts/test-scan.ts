/**
 * Test driver for /api/scan. Runs the batch scan of mock-invoices/ and prints summary.
 *
 * Run with:
 *   npx tsx scripts/test-scan.ts            (incremental - only new files)
 *   npx tsx scripts/test-scan.ts --force    (re-scan everything)
 */

const force = process.argv.includes("--force");

async function main() {
  console.log(`\nPosting to /api/scan${force ? " (force=true)" : ""}...`);
  const start = Date.now();

  const resp = await fetch("http://localhost:3000/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  const data = await resp.json();
  console.log(`HTTP ${resp.status} - ${Date.now() - start}ms\n`);

  if (!data.success) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`Summary:`);
  console.log(`  Scanned:   ${data.scanned}`);
  console.log(`  Processed: ${data.processed}`);
  console.log(`  Skipped:   ${data.skipped}`);
  console.log(`  Errors:    ${data.errors}`);
  console.log();

  // Lane distribution
  const lanes = { GREEN: 0, AMBER: 0, RED: 0, NONE: 0 };
  for (const r of data.results) {
    if (r.lane === "GREEN") lanes.GREEN++;
    else if (r.lane === "AMBER") lanes.AMBER++;
    else if (r.lane === "RED") lanes.RED++;
    else lanes.NONE++;
  }
  console.log(`Lane distribution (this run):`);
  console.log(`  GREEN: ${lanes.GREEN}`);
  console.log(`  AMBER: ${lanes.AMBER}`);
  console.log(`  RED:   ${lanes.RED}`);
  if (lanes.NONE > 0) console.log(`  NONE (errored): ${lanes.NONE}`);
  console.log();

  console.log(`Per-file results:`);
  for (const r of data.results) {
    const tag = r.error ? "ERROR" : r.lane ?? "—";
    console.log(`  [${tag.padEnd(6)}] ${r.filename}${r.error ? "  — " + r.error : ""}`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});