/** Verify the PO receive -> auto-stock flow against the DB, then clean up fully. */
import { prisma } from "@/lib/prisma";
import { applyTxn } from "@/lib/inventory";

function assert(c: boolean, m: string) {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
}

async function main() {
  const item = await prisma.item.findFirstOrThrow({ where: { partNumber: "CAPS-00085" } });
  const before = item.onHand;
  console.log(`CAPS-00085 on-hand before: ${before}`);

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: `PO-TEST-${Math.abs(before)}`,
      status: "ORDERED",
      orderedAt: new Date(),
      lines: { create: [{ itemId: item.id, qtyOrdered: 500, unitCost: item.unitCost ?? 0 }] },
    },
    include: { lines: true },
  });
  const line = po.lines[0];

  // Replicate receivePo core: receive 500.
  await prisma.$transaction(async (tx) => {
    await applyTxn(tx, { itemId: item.id, qtyDelta: 500, type: "RECEIPT", refType: "PurchaseOrder", refId: po.id, note: "test" });
    await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: { increment: 500 } } });
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const status = lines.every((l) => l.qtyReceived >= l.qtyOrdered) ? "RECEIVED" : "PARTIAL";
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
  });

  const after = (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).onHand;
  const recLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
  const poAfter = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
  console.log("Checks:");
  assert(after === before + 500, `on-hand rose by 500 (${before} -> ${after})`);
  assert(recLine.qtyReceived === 500, `line received = 500`);
  assert(poAfter.status === "RECEIVED", `PO status = RECEIVED`);

  // Clean up: restore stock, delete ledger rows + PO (cascades lines).
  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: item.id }, data: { onHand: before } });
    await tx.inventoryTxn.deleteMany({ where: { refType: "PurchaseOrder", refId: po.id } });
    await tx.purchaseOrder.delete({ where: { id: po.id } });
  });
  const restored = (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).onHand;
  assert(restored === before, `cleaned up; on-hand restored to ${before}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
