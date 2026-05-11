/**
 * End-to-end test for the extract -> reasoning pipeline.
 *
 * Posts a filename to /api/extract, takes the extraction, posts it to
 * /api/reasoning, prints both results.
 *
 * Run with:
 *   npx tsx scripts/test-reasoning.ts INV-001-neste.pdf
 *
 * Requires: dev server running on localhost:3000 (npm run dev in another terminal).
 */

const filename = process.argv[2];

if (!filename) {
  console.error("Usage: npx tsx scripts/test-reasoning.ts <filename>");
  console.error("Example: npx tsx scripts/test-reasoning.ts INV-001-neste.pdf");
  process.exit(1);
}

async function main() {
  // -----------------------------------------------------------------------
  // Step 1: extract
  // -----------------------------------------------------------------------
  console.log(`\n========== STEP 1: EXTRACT ==========`);
  console.log(`Posting ${filename} to /api/extract...`);
  const t1 = Date.now();

  const extractResponse = await fetch("http://localhost:3000/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });

  const extractData = await extractResponse.json();
  console.log(`HTTP ${extractResponse.status} - ${Date.now() - t1}ms`);

  if (!extractData.success) {
    console.log("Extraction failed:");
    console.log(JSON.stringify(extractData, null, 2));
    process.exit(1);
  }

  console.log("Extraction succeeded. Key fields:");
  console.log(`  Vendor:    ${extractData.extraction.vendorName}`);
  console.log(`  Invoice #: ${extractData.extraction.invoiceNumber}`);
  console.log(`  Gross:     ${extractData.extraction.grossAmount} ${extractData.extraction.currency}`);
  console.log(`  Lines:     ${extractData.extraction.lineItems.length} item(s)`);

  // -----------------------------------------------------------------------
  // Step 2: reasoning
  // -----------------------------------------------------------------------
  console.log(`\n========== STEP 2: REASONING ==========`);
  console.log(`Posting extraction to /api/reasoning...`);
  const t2 = Date.now();

  const reasonResponse = await fetch("http://localhost:3000/api/reasoning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extraction: extractData.extraction }),
  });

  const reasonData = await reasonResponse.json();
  console.log(`HTTP ${reasonResponse.status} - ${Date.now() - t2}ms\n`);

  if (!reasonData.success) {
    console.log("Reasoning failed:");
    console.log(JSON.stringify(reasonData, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(reasonData, null, 2));

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n========== SUMMARY ==========`);
  console.log(`File:        ${filename}`);
  console.log(`Vendor:      ${extractData.extraction.vendorName}`);
  console.log(`Suggested:   ${reasonData.suggestion.glCode} ${reasonData.suggestion.glCodeName}`);
  console.log(`Confidence:  ${reasonData.suggestion.glConfidenceComponent}`);
  console.log(`Summary:     ${reasonData.suggestion.oneLineSummary}`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});