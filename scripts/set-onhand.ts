/**
 * One-off: set on-hand for parts from a physical count (handwritten on the printed
 * To-Order list). Records each change as a COUNT ledger entry so on-hand stays
 * consistent with the ledger and the adjustment is auditable.
 */
import { prisma } from "@/lib/prisma";
import { applyTxn } from "@/lib/inventory";

const TARGETS: Record<string, number> = {
  "CAPS-00085": 10000,
  "CAPS-00108": 2000,
  "CAPS-00129": 8000,
  "CAPS-00145": 3000,
  "CAPS-00181": 900,
  "CAPS-00351": 10000,
  "CAPS-00352": 0,
  "CAPS-00410": 9000,
  "CAPS-00449": 2000,
  "CAPS-00450": 4,
  "MECH-00038": 1000,
  "RESS-00168": 5000,
  "RESS-00195": 10000,
  "RESS-00217": 5000,
  "RESS-00227": 5000,
  "RESS-00280": 0,
  "RESS-00283": 2000,
  "RESS-00285": 7500,
  "RESS-00571": 15000,
  "RESS-00729": 10000,
  "RESS-00730": 10000,
  "RESS-00734": 5000,
  "RESS-00735": 5000,
};

async function main() {
  let updated = 0;
  const notFound: string[] = [];
  for (const [pn, target] of Object.entries(TARGETS)) {
    const item = await prisma.item.findUnique({ where: { partNumber: pn } });
    if (!item) {
      notFound.push(pn);
      console.log(`  NOT FOUND: ${pn}`);
      continue;
    }
    const delta = target - item.onHand;
    if (delta === 0) {
      console.log(`  ${pn}: already ${target}`);
      continue;
    }
    await prisma.$transaction((tx) =>
      applyTxn(tx, {
        itemId: item.id,
        qtyDelta: delta,
        type: "COUNT",
        note: "Physical count (printed To-Order markup)",
      }),
    );
    console.log(`  ${pn}: ${item.onHand} -> ${target}  (Δ ${delta > 0 ? "+" : ""}${delta})`);
    updated++;
  }
  console.log(`\nUpdated ${updated} parts.` + (notFound.length ? ` Not found: ${notFound.join(", ")}` : ""));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
