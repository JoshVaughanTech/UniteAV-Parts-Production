"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { applyTxn } from "@/lib/inventory";
import { setItemCost } from "@/lib/pricing";
import { getToOrderBySupplier, getSettings } from "@/lib/metrics";

async function nextPoNumber(): Promise<string> {
  const count = await prisma.purchaseOrder.count();
  return `PO-${(count + 1).toString().padStart(4, "0")}`;
}

function revalidatePo(id?: string) {
  if (id) revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/parts");
  revalidatePath("/products");
  revalidatePath("/to-order");
  revalidatePath("/");
}

/** Apply cost_<lineId> inputs to PO lines and flow changed prices to the parts
 *  (with a price-history entry naming the PO). */
async function applyLinePrices(
  lines: { id: string; itemId: string; unitCost: number }[],
  formData: FormData,
  note: string,
  userId?: string | null,
): Promise<void> {
  for (const line of lines) {
    const raw = formData.get(`cost_${line.id}`);
    if (raw == null || String(raw).trim() === "") continue;
    const cost = Number(raw);
    if (!Number.isFinite(cost) || cost < 0) continue;
    if (cost !== line.unitCost) {
      await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { unitCost: cost } });
    }
    await setItemCost(line.itemId, cost, note, userId);
  }
}

/** Create a draft PO from the current To-Order suggestions for one supplier group. */
export async function createPoFromReorder(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const supplierKey = String(formData.get("supplierKey") ?? ""); // supplierId or "__none__"
  const [settings, groups] = await Promise.all([getSettings(), getToOrderBySupplier()]);
  const group = groups.find((g) => (g.supplierId ?? "__none__") === supplierKey);
  if (!group || group.parts.length === 0) redirect("/to-order");

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(),
      supplierId: group.supplierId,
      status: "DRAFT",
      currency: settings.currency,
      userId: user.id,
      lines: {
        create: group.parts.map((p) => ({
          itemId: p.id,
          qtyOrdered: p.reorder.suggestedOrderQty,
          unitCost: p.unitCost ?? 0,
        })),
      },
    },
  });
  revalidatePo();
  redirect(`/purchase-orders/${po.id}`);
}

/** Create an empty draft PO for a supplier. */
export async function createBlankPo(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const supplierId = String(formData.get("supplierId") ?? "").trim() || null;
  const settings = await getSettings();
  const po = await prisma.purchaseOrder.create({
    data: { poNumber: await nextPoNumber(), supplierId, status: "DRAFT", currency: settings.currency, userId: user.id },
  });
  revalidatePo();
  redirect(`/purchase-orders/${po.id}`);
}

export async function setPoSupplier(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "").trim() || null;
  await prisma.purchaseOrder.update({ where: { id }, data: { supplierId } });
  revalidatePo(id);
}

/** Save qty_<lineId> + cost_<lineId> inputs on a draft PO's lines in one go. */
export async function updatePoLines(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po || po.status !== "DRAFT") redirect("/purchase-orders");

  for (const line of po.lines) {
    const raw = formData.get(`qty_${line.id}`);
    if (raw == null || String(raw).trim() === "") continue;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0 || qty === line.qtyOrdered) continue;
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyOrdered: qty } });
  }
  await applyLinePrices(po.lines, formData, po.poNumber, user.id);
  revalidatePo(poId);
}

/** Save prices on a sent (ordered/partial) PO without receiving anything. */
export async function savePoLinePrices(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) redirect("/purchase-orders");
  await applyLinePrices(po.lines, formData, po.poNumber, user.id);
  revalidatePo(poId);
}

export async function removePoLine(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  await prisma.purchaseOrderLine.delete({ where: { id: lineId } });
  revalidatePo(poId);
}

export async function addPoLine(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const partNumber = String(formData.get("partNumber") ?? "").trim();
  const qty = Math.max(1, Number(String(formData.get("qty") ?? "1")));
  const costRaw = String(formData.get("unitCost") ?? "").trim();
  const cost = costRaw === "" ? null : Math.max(0, Number(costRaw) || 0);
  const item = await prisma.item.findUnique({ where: { partNumber } });
  if (item) {
    const existing = await prisma.purchaseOrderLine.findFirst({
      where: { purchaseOrderId: poId, itemId: item.id },
    });
    if (existing) {
      await prisma.purchaseOrderLine.update({
        where: { id: existing.id },
        data: { qtyOrdered: { increment: qty }, ...(cost != null ? { unitCost: cost } : {}) },
      });
    } else {
      await prisma.purchaseOrderLine.create({
        data: { purchaseOrderId: poId, itemId: item.id, qtyOrdered: qty, unitCost: cost ?? item.unitCost ?? 0 },
      });
    }
    if (cost != null) {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { poNumber: true } });
      await setItemCost(item.id, cost, po?.poNumber ?? "Purchase order", user.id);
    }
  }
  revalidatePo(poId);
}

export async function markPoOrdered(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "ORDERED", orderedAt: new Date() } });
  revalidatePo(id);
}

export async function cancelPo(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePo(id);
}

interface PoForReceipt {
  id: string;
  poNumber: string;
  status: string;
}

/**
 * Book receipts against a PO: RECEIPT ledger entries, on-hand, per-line received totals,
 * and the resulting status. RECEIVED only once every line is fully in; PARTIAL while some
 * of the order is still outstanding.
 */
async function bookReceipts(
  po: PoForReceipt,
  receipts: { lineId: string; itemId: string; qty: number }[],
  userId: string,
): Promise<void> {
  if (receipts.length === 0) return;
  await prisma.$transaction(
    async (tx) => {
      for (const r of receipts) {
        await applyTxn(tx, {
          itemId: r.itemId,
          qtyDelta: r.qty,
          type: "RECEIPT",
          refType: "PurchaseOrder",
          refId: po.id,
          note: `Received on ${po.poNumber}`,
          userId,
        });
        await tx.purchaseOrderLine.update({ where: { id: r.lineId }, data: { qtyReceived: { increment: r.qty } } });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
      const allReceived = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
      const anyReceived = lines.some((l) => l.qtyReceived > 0);
      const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : po.status;
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
    },
    { timeout: 60000, maxWait: 20000 },
  );
}

/** Parse a recv_<lineId> input. Blank means "nothing arrived for this line" — not zero-fill. */
function receivedQty(formData: FormData, lineId: string): number | null {
  const raw = String(formData.get(`recv_${lineId}`) ?? "").trim();
  if (raw === "") return null;
  const qty = Number(raw);
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

/**
 * Receive whatever quantities were typed in. Lines left blank are untouched, so a delivery
 * covering part of the order leaves the PO PARTIAL.
 */
export async function receivePo(formData: FormData): Promise<void> {
  const user = await requireRole("OPERATOR");
  const poId = String(formData.get("poId") ?? "");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) redirect("/purchase-orders");

  // Managers may have edited prices in the same submit — apply those too.
  if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices(po.lines, formData, po.poNumber, user.id);

  const receipts = po.lines
    .map((line) => ({ lineId: line.id, itemId: line.itemId, qty: receivedQty(formData, line.id) }))
    .filter((r): r is { lineId: string; itemId: string; qty: number } => r.qty !== null);

  await bookReceipts(po, receipts, user.id);
  revalidatePo(poId);
}

/** Receive a single line on its own — the common "one part turned up" case. */
export async function receivePoLine(formData: FormData): Promise<void> {
  const user = await requireRole("OPERATOR");
  const poId = String(formData.get("poId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) redirect("/purchase-orders");

  const line = po.lines.find((l) => l.id === lineId);
  if (line) {
    if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices([line], formData, po.poNumber, user.id);
    // Blank box on the line being received = receive the rest of it.
    const qty = receivedQty(formData, lineId) ?? Math.max(0, line.qtyOrdered - line.qtyReceived);
    if (qty > 0) await bookReceipts(po, [{ lineId, itemId: line.itemId, qty }], user.id);
  }
  revalidatePo(poId);
}

/** Receive every outstanding quantity at once — the whole order turned up together. */
export async function receivePoRemaining(formData: FormData): Promise<void> {
  const user = await requireRole("OPERATOR");
  const poId = String(formData.get("poId") ?? "");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) redirect("/purchase-orders");

  if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices(po.lines, formData, po.poNumber, user.id);

  const receipts = po.lines
    .map((line) => ({ lineId: line.id, itemId: line.itemId, qty: Math.max(0, line.qtyOrdered - line.qtyReceived) }))
    .filter((r) => r.qty > 0);

  await bookReceipts(po, receipts, user.id);
  revalidatePo(poId);
}
