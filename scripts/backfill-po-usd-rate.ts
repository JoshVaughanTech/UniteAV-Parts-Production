import { prisma } from "../src/lib/prisma";
import { fetchUsdRateOn } from "../src/lib/fx";

/**
 * Stamp a USD rate onto purchase orders raised before the rate was recorded.
 *
 * Those orders show "no USD rate was recorded" instead of USD figures. The rate is meant
 * to be the one that held on the day the order was raised, so each is fetched for its own
 * createdAt rather than today's rate being smeared across all of them — a July order
 * valued at October's rate would be a quietly wrong number, which is worse than a blank.
 *
 * Only fills nulls. An order that already carries a rate is left exactly as it is.
 *
 *   npx tsx scripts/backfill-po-usd-rate.ts          # report what it would do
 *   npx tsx scripts/backfill-po-usd-rate.ts --write  # write it
 */
async function main() {
  const write = process.argv.includes("--write");

  const pos = await prisma.purchaseOrder.findMany({
    where: { usdRate: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, poNumber: true, currency: true, status: true, createdAt: true },
  });

  if (pos.length === 0) {
    console.log("Every purchase order already carries a USD rate.");
    return;
  }
  console.log(`${pos.length} order(s) without a rate${write ? "" : " — dry run, pass --write to apply"}:\n`);

  let filled = 0;
  for (const po of pos) {
    const day = po.createdAt.toISOString().slice(0, 10);
    const rate = await fetchUsdRateOn(po.currency, po.createdAt);
    if (rate == null) {
      console.log(`  ${po.poNumber}  ${day}  ${po.currency}→USD  NO RATE AVAILABLE — left blank`);
      continue;
    }
    console.log(`  ${po.poNumber}  ${day}  ${po.currency}→USD  ${rate.toFixed(5)}${write ? "  written" : ""}`);
    if (write) {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { usdRate: rate } });
      filled++;
    }
  }

  console.log(write ? `\n${filled} order(s) updated.` : `\nNothing written. Re-run with --write to apply.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
