/** Verify the auto-order engine creates + auto-approves a PO, then clean up fully. */
import { prisma } from "@/lib/prisma";
import { runAutoOrder } from "@/lib/auto-order";

function assert(c: boolean, m: string) {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
}

async function main() {
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const supplier = await prisma.supplier.create({ data: { name: "__TEST_SUPPLIER__" } });
  const part = await prisma.item.create({
    data: {
      partNumber: "__TEST_AUTOORDER_PART__",
      name: "Test auto-order part",
      type: "PART",
      onHand: 0,
      safetyStock: 1000,
      unitCost: 0.05,
      minPackQty: 100,
      supplierId: supplier.id,
    },
  });
  await prisma.settings.update({ where: { id: 1 }, data: { autoOrderEnabled: true, autoApproveLimit: 1_000_000 } });

  const res = await runAutoOrder();
  console.log("runAutoOrder:", JSON.stringify(res));
  const pos = await prisma.purchaseOrder.findMany({ where: { supplierId: supplier.id }, include: { lines: true } });

  console.log("Checks:");
  assert(res.enabled, "engine ran (enabled)");
  assert(pos.length === 1, "one PO created for the supplier");
  assert(pos[0]?.status === "ORDERED", "under-limit PO was auto-ordered (ORDERED)");
  assert(pos[0]?.autoCreated === true, "PO flagged autoCreated");
  assert(pos[0]?.lines.some((l) => l.itemId === part.id) === true, "PO includes the low part");
  assert(pos[0]?.lines[0]?.qtyOrdered === 1000, "suggested qty rounded to pack (1000)");

  // Clean up everything.
  await prisma.purchaseOrder.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.item.delete({ where: { id: part.id } });
  await prisma.supplier.delete({ where: { id: supplier.id } });
  await prisma.settings.update({
    where: { id: 1 },
    data: { autoOrderEnabled: before.autoOrderEnabled, autoApproveLimit: before.autoApproveLimit },
  });
  const gone = await prisma.item.findUnique({ where: { partNumber: "__TEST_AUTOORDER_PART__" } });
  assert(gone === null, "cleaned up test data");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
