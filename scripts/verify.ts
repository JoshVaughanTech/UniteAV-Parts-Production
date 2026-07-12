/**
 * End-to-end verification of the consumption + reorder engine against seeded data.
 * Creates a production log, checks inventory + reorder status, then rolls the
 * changes back so the demo database is left untouched.
 */
import { prisma } from "@/lib/prisma";
import { applyTxn } from "@/lib/inventory";
import { getPartRows, getSettings } from "@/lib/metrics";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  const settings = await getSettings();
  const product = await prisma.item.findFirstOrThrow({ where: { partNumber: "an3140_c_base(AMP)" } });
  const leaves = await prisma.explodedBom.findMany({ where: { productItemId: product.id } });
  console.log(`Product: ${product.name} — ${leaves.length} exploded parts.`);

  // Observe a shared part with a known BOM quantity.
  const observed = await prisma.item.findFirstOrThrow({ where: { partNumber: "CAPS-00451" } });
  const leaf = leaves.find((l) => l.leafPartId === observed.id);
  if (!leaf) throw new Error("CAPS-00451 not on AMP BOM");
  const qtyPer = leaf.totalQtyPer;
  console.log(`Observed part CAPS-00451: ${qtyPer} per AMP build.\n`);

  // Snapshot for restoration.
  const before = { onHand: observed.onHand, leadTimeDays: observed.leadTimeDays, safetyStock: observed.safetyStock };

  const BUILD = 10;
  // Set planning fields so a reorder should trigger, and a known starting stock.
  await prisma.item.update({
    where: { id: observed.id },
    data: { onHand: 100, leadTimeDays: 20, safetyStock: 50, minPackQty: 10 },
  });

  // Simulate the exact logProduction code path.
  const log = await prisma.$transaction(async (tx) => {
    const l = await tx.productionLog.create({ data: { productItemId: product.id, qtyBuilt: BUILD, date: new Date() } });
    for (const lf of leaves) {
      await applyTxn(tx, {
        itemId: lf.leafPartId,
        qtyDelta: -(BUILD * lf.totalQtyPer),
        type: "BUILD_CONSUMPTION",
        refType: "ProductionLog",
        refId: l.id,
      });
    }
    return l;
  });

  const after = await prisma.item.findUniqueOrThrow({ where: { id: observed.id } });
  console.log("Checks:");
  assert(after.onHand === 100 - BUILD * qtyPer, `on-hand dropped by ${BUILD}×${qtyPer} (100 → ${after.onHand})`);

  const rows = await getPartRows();
  const row = rows.find((r) => r.id === observed.id)!;
  const expectedAdu = (BUILD * qtyPer) / settings.usageWindowDays;
  assert(Math.abs(row.adu - expectedAdu) < 1e-6, `ADU = ${row.adu.toFixed(3)}/day (consumption ÷ ${settings.usageWindowDays}d)`);
  const expectedRop = expectedAdu * 20 + 50;
  assert(Math.abs(row.reorder.rop - expectedRop) < 1e-6, `ROP = ${row.reorder.rop.toFixed(2)} (ADU×20 + 50)`);
  assert(row.reorder.status === "REORDER", `status = REORDER (onHand ${after.onHand} ≤ ROP ${row.reorder.rop.toFixed(1)})`);
  assert(row.reorder.suggestedOrderQty % 10 === 0 && row.reorder.suggestedOrderQty > 0, `suggested order ${row.reorder.suggestedOrderQty} is a multiple of MOQ 10`);

  // Reverse (same path as reverseProduction) + restore snapshot.
  await prisma.$transaction(async (tx) => {
    const txns = await tx.inventoryTxn.findMany({ where: { refType: "ProductionLog", refId: log.id } });
    for (const t of txns) await tx.item.update({ where: { id: t.itemId }, data: { onHand: { increment: -t.qtyDelta } } });
    await tx.inventoryTxn.deleteMany({ where: { refType: "ProductionLog", refId: log.id } });
    await tx.productionLog.delete({ where: { id: log.id } });
  });
  const restored = await prisma.item.findUniqueOrThrow({ where: { id: observed.id } });
  assert(restored.onHand === 100, `reversal restored on-hand to 100 (got ${restored.onHand})`);

  // Put the part's planning fields back to their seeded values.
  await prisma.item.update({ where: { id: observed.id }, data: { ...before, minPackQty: 1 } });

  console.log("\nAll verification checks passed. Demo database restored to pre-test state.");
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
