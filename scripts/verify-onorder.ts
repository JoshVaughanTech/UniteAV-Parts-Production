import { prisma } from "@/lib/prisma";
import { getPartRows } from "@/lib/metrics";

async function main() {
  const supplier = await prisma.supplier.create({ data: { name: "__TEST_S__" } });
  const part = await prisma.item.create({
    data: { partNumber: "__TEST_ONORDER__", name: "t", type: "PART", onHand: 5000, safetyStock: 1000 },
  });
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-TESTOO",
      status: "ORDERED",
      orderedAt: new Date(),
      supplierId: supplier.id,
      lines: { create: [{ itemId: part.id, qtyOrdered: 100, unitCost: 1 }] },
    },
  });

  const rows = await getPartRows();
  const row = rows.find((r) => r.id === part.id);
  const ok = row?.reorder.status === "ON_ORDER";
  console.log(`  ${ok ? "PASS" : "FAIL"}  part on a sent PO shows status = ${row?.reorder.status} (expected ON_ORDER)`);

  await prisma.purchaseOrder.delete({ where: { id: po.id } });
  await prisma.item.delete({ where: { id: part.id } });
  await prisma.supplier.delete({ where: { id: supplier.id } });
  console.log("  cleaned up");
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
