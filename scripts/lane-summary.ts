/**
 * Quick analytics: lane distribution + sanity check on hard-fails.
 */
import { prisma } from "./_prisma";

async function main() {
  const all = await prisma.invoice.findMany({
    select: {
      id: true,
      originalFilename: true,
      lane: true,
      status: true,
      confidenceScore: true,
      vendorName: true,
      glCodeSuggestion: true,
    },
    orderBy: { id: "asc" },
  });

  const lanes = { GREEN: 0, AMBER: 0, RED: 0, OTHER: 0 };
  const statuses = { PENDING: 0, APPROVED: 0, EDITED: 0, BLOCKED: 0, OTHER: 0 };

  console.log(`Total invoices in DB: ${all.length}\n`);

  console.log(`Per-invoice:`);
  console.log(`  id  lane    status     conf    GL    filename`);
  for (const inv of all) {
    const lane = inv.lane ?? "?";
    const status = inv.status ?? "?";
    const conf = inv.confidenceScore?.toFixed(3) ?? "n/a";
    const gl = inv.glCodeSuggestion ?? "—";

    if (lane === "GREEN") lanes.GREEN++;
    else if (lane === "AMBER") lanes.AMBER++;
    else if (lane === "RED") lanes.RED++;
    else lanes.OTHER++;

    if (status === "PENDING") statuses.PENDING++;
    else if (status === "APPROVED") statuses.APPROVED++;
    else if (status === "EDITED") statuses.EDITED++;
    else if (status === "BLOCKED") statuses.BLOCKED++;
    else statuses.OTHER++;

    console.log(`  ${String(inv.id).padStart(2)}  ${lane.padEnd(6)}  ${status.padEnd(9)}  ${conf.padStart(6)}  ${gl.padEnd(5)} ${inv.originalFilename}`);
  }

  console.log(`\nLane distribution:`);
  console.log(`  GREEN: ${lanes.GREEN}`);
  console.log(`  AMBER: ${lanes.AMBER}`);
  console.log(`  RED:   ${lanes.RED}`);
  if (lanes.OTHER > 0) console.log(`  OTHER: ${lanes.OTHER}`);

  console.log(`\nStatus distribution:`);
  console.log(`  PENDING:  ${statuses.PENDING}`);
  console.log(`  APPROVED: ${statuses.APPROVED}`);
  console.log(`  EDITED:   ${statuses.EDITED}`);
  console.log(`  BLOCKED:  ${statuses.BLOCKED}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});