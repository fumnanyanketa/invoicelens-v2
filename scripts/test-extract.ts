/**
 * Test driver for POST /api/extract.
 *
 * Posts a filename to the running dev server, prints the structured response.
 *
 * Run with:
 *   npx tsx scripts/test-extract.ts INV-001-neste.pdf
 *
 * Requires: dev server running on localhost:3000 (npm run dev in another terminal).
 */

const filename = process.argv[2];

if (!filename) {
  console.error("Usage: npx tsx scripts/test-extract.ts <filename>");
  console.error("Example: npx tsx scripts/test-extract.ts INV-001-neste.pdf");
  process.exit(1);
}

async function main() {
  console.log(`Posting ${filename} to /api/extract...\n`);
  const start = Date.now();

  const response = await fetch("http://localhost:3000/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });

  const elapsedMs = Date.now() - start;
  const data = await response.json();

  console.log(`HTTP ${response.status} - ${elapsedMs}ms\n`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});