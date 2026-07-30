/**
 * Throwaway end-to-end check of the PO receiving flow, on temporary items so nothing real
 * is touched. Mirrors the exact expressions in po-actions.bookReceipts / receivedQty.
 * Everything is deleted at the end (InventoryTxn cascades from Item).
 */
import { prisma } from "@/lib/prisma";
import { applyTxn } from "@/lib/inventory";

// --- copies of the parsing + status rules under test ---------------------------------
function receivedQty(form: Map<string, string>, lineId: string): number | null {
  const raw = (form.get(`recv_${lineId}`) ?? "").trim();
  if (raw === "") return null;
  const qty = Number(raw);
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

async function bookReceipts(po: { id: string; poNumber: string; status: string }, receipts: { lineId: string; itemId: string; qty: number }[]) {
  if (receipts.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const r of receipts) {
      await applyTxn(tx, { itemId: r.itemId, qtyDelta: r.qty, type: "RECEIPT", refType: "PurchaseOrder", refId: po.id, note: `Received on ${po.poNumber}` });
      await tx.purchaseOrderLine.update({ where: { id: r.lineId }, data: { qtyReceived: { increment: r.qty } } });
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const allReceived = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
    const anyReceived = lines.some((l) => l.qtyReceived > 0);
    const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : po.status;
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
  }, { timeout: 60000, maxWait: 20000 });
}

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}

async function state(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { lines: { include: { item: { select: { partNumber: true, onHand: true } } }, orderBy: { item: { partNumber: "asc" } } } },
  });
  return {
    status: po.status,
    lines: po.lines.map((l) => ({ pn: l.item.partNumber, ordered: l.qtyOrdered, received: l.qtyReceived, onHand: l.item.onHand })),
  };
}

async function main() {
  const PNS = ["ZZTEST-RECV-A", "ZZTEST-RECV-B", "ZZTEST-RECV-C"];
  const items = [];
  for (const pn of PNS) items.push(await prisma.item.create({ data: { partNumber: pn, name: `test ${pn}`, type: "PART", onHand: 0 } }));

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: `ZZTEST-PO-${items[0].id.slice(-6)}`,
      status: "ORDERED",
      orderedAt: new Date(),
      lines: { create: items.map((it, i) => ({ itemId: it.id, qtyOrdered: (i + 1) * 10, unitCost: 1 })) },
    },
    include: { lines: { include: { item: true } }, },
  });
  const byPn = new Map(po.lines.map((l) => [l.item.partNumber, l]));
  const lineA = byPn.get("ZZTEST-RECV-A")!;
  const lineB = byPn.get("ZZTEST-RECV-B")!;
  const lineC = byPn.get("ZZTEST-RECV-C")!;
  console.log(`\nTest PO ${po.poNumber}: A ordered 10, B ordered 20, C ordered 30 — status ORDERED\n`);

  // --- 1. blank vs typed parsing ----------------------------------------------------
  console.log("1. recv_ input parsing (blank must NOT mean zero-fill)");
  const form = new Map([[`recv_${lineA.id}`, "4"], [`recv_${lineB.id}`, ""], [`recv_${lineC}`, "0"]]);
  check("typed '4'", receivedQty(form, lineA.id), 4);
  check("blank  ''", receivedQty(form, lineB.id), null);
  check("typed '0'", receivedQty(form, lineC.id), null);

  // --- 2. receive ONE line partially -> PARTIAL --------------------------------------
  console.log("\n2. receive 4 of 10 on line A only");
  await bookReceipts(po, [{ lineId: lineA.id, itemId: lineA.itemId, qty: 4 }]);
  let s = await state(po.id);
  check("status", s.status, "PARTIAL");
  check("line qtys", s.lines.map((l) => `${l.pn.slice(-1)}:${l.received}/${l.ordered}`), ["A:4/10", "B:0/20", "C:0/30"]);
  check("on-hand only moved for A", s.lines.map((l) => l.onHand), [4, 0, 0]);

  // --- 3. finish line A, still PARTIAL because B and C are outstanding ---------------
  console.log("\n3. receive remaining 6 on line A (A now complete, B/C not)");
  await bookReceipts(po, [{ lineId: lineA.id, itemId: lineA.itemId, qty: 6 }]);
  s = await state(po.id);
  check("status still PARTIAL", s.status, "PARTIAL");
  check("A fully received", s.lines[0], { pn: "ZZTEST-RECV-A", ordered: 10, received: 10, onHand: 10 });

  // --- 4. receive all outstanding -> RECEIVED ---------------------------------------
  console.log("\n4. receive all outstanding (B 20, C 30)");
  const fresh = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  await bookReceipts(po, fresh.map((l) => ({ lineId: l.id, itemId: l.itemId, qty: Math.max(0, l.qtyOrdered - l.qtyReceived) })).filter((r) => r.qty > 0));
  s = await state(po.id);
  check("status", s.status, "RECEIVED");
  check("all lines complete", s.lines.map((l) => `${l.pn.slice(-1)}:${l.received}/${l.ordered}`), ["A:10/10", "B:20/20", "C:30/30"]);
  check("on-hand", s.lines.map((l) => l.onHand), [10, 20, 30]);

  // --- 5. ledger reconciles ---------------------------------------------------------
  console.log("\n5. ledger reconciles with on-hand");
  for (const it of items) {
    const agg = await prisma.inventoryTxn.aggregate({ where: { itemId: it.id }, _sum: { qtyDelta: true } });
    const cur = await prisma.item.findUniqueOrThrow({ where: { id: it.id }, select: { onHand: true } });
    check(`${it.partNumber} txnSum == onHand`, agg._sum.qtyDelta, cur.onHand);
  }
  const txns = await prisma.inventoryTxn.count({ where: { refType: "PurchaseOrder", refId: po.id } });
  check("receipt ledger rows (4 bookings)", txns, 4);

  // --- cleanup ---------------------------------------------------------------------
  await prisma.purchaseOrder.delete({ where: { id: po.id } }); // cascades lines
  for (const it of items) await prisma.item.delete({ where: { id: it.id } }); // cascades txns
  const leftItems = await prisma.item.count({ where: { partNumber: { in: PNS } } });
  const leftTxn = await prisma.inventoryTxn.count({ where: { refId: po.id } });
  const leftPo = await prisma.purchaseOrder.count({ where: { id: po.id } });
  console.log(`\ncleanup: ${leftItems} items, ${leftTxn} txns, ${leftPo} POs left behind (all must be 0)`);
  check("cleanup complete", [leftItems, leftTxn, leftPo], [0, 0, 0]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
