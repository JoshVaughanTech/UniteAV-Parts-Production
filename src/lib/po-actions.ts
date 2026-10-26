"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { applyTxn } from "@/lib/inventory";
import { setItemCost } from "@/lib/pricing";
import { getToOrderBySupplier, getSettings } from "@/lib/metrics";
import { nextPoNumber, orderCurrencyFor, toOrderCurrency, toHomeCurrency } from "@/lib/po-create";
import type { ActionResult } from "@/lib/actions";
import {
  EDITABLE,
  SENT,
  CANCELLABLE,
  DELETABLE,
  statusRefusal,
  statusAfterReceipts,
  overReceipts,
  overMessage,
} from "@/lib/po-status";

/** Same shape as every other action result, so the delete button can show the reason. */
export type PoDeleteResult = ActionResult;

/**
 * Every action below names the statuses it is valid in, and checks. Each one is a POST
 * endpoint that anyone signed in can reach whatever buttons the page happens to render, so
 * hiding a button is not the same as refusing the request. The rules themselves are in
 * `po-status.ts`, where they can be checked without a database.
 */

/**
 * Refuse an action and say why, on the order itself.
 *
 * These are plain form actions returning void, so there is no return value the page can
 * read. The reason travels in the query string and the PO page renders it — a refusal the
 * user cannot see is indistinguishable from the button not working, which is how a guard
 * ends up being reported as a bug of its own.
 */
function refuse(poId: string, reason: string): never {
  redirect(`/purchase-orders/${poId}?problem=${encodeURIComponent(reason)}`);
}

/** The same channel for something that went through but is worth saying out loud. */
function notify(poId: string, message: string): never {
  redirect(`/purchase-orders/${poId}?note=${encodeURIComponent(message)}`);
}

/** Load a PO and refuse the action unless it is in one of `allowed`. */
async function poForAction(poId: string, allowed: string[], what: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) redirect("/purchase-orders");
  const reason = statusRefusal(po.poNumber, po.status, allowed, what);
  if (reason) refuse(po.id, reason);
  return po;
}

function revalidatePo(id?: string) {
  if (id) revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/parts");
  revalidatePath("/products");
  revalidatePath("/to-order");
  revalidatePath("/");
}

/**
 * Apply cost_<lineId> inputs to PO lines and flow changed prices back to the parts.
 *
 * The price typed on a line is in the order's currency — a Digikey line is in US dollars.
 * A part's `unitCost` is in the home currency, because every valuation in the system reads
 * it: inventory value, BOM cost, reorder suggestions. Writing a USD figure straight into
 * that field would quietly mark the whole BOM down by about a third.
 */
async function applyLinePrices(
  lines: { id: string; itemId: string; unitCost: number }[],
  formData: FormData,
  note: string,
  fxToHome: number,
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
    await setItemCost(line.itemId, toHomeCurrency(cost, fxToHome), note, userId);
  }
}

/** Create a draft PO from the current To-Order suggestions for one supplier group. */
export async function createPoFromReorder(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const supplierKey = String(formData.get("supplierKey") ?? ""); // supplierId or "__none__"
  const [settings, groups] = await Promise.all([getSettings(), getToOrderBySupplier()]);
  const group = groups.find((g) => (g.supplierId ?? "__none__") === supplierKey);
  if (!group || group.parts.length === 0) redirect("/to-order");

  const { currency, fxToHome } = await orderCurrencyFor(group.supplierId, settings.currency);
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(),
      supplierId: group.supplierId,
      status: "DRAFT",
      currency,
      fxToHome,
      userId: user.id,
      lines: {
        create: group.parts.map((p) => ({
          itemId: p.id,
          qtyOrdered: p.reorder.suggestedOrderQty,
          // The part's cost is in the home currency; the line is in the order's.
          unitCost: toOrderCurrency(p.unitCost ?? 0, fxToHome),
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
  const { currency, fxToHome } = await orderCurrencyFor(supplierId, settings.currency);
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(),
      supplierId,
      status: "DRAFT",
      currency,
      fxToHome,
      userId: user.id,
    },
  });
  revalidatePo();
  redirect(`/purchase-orders/${po.id}`);
}

/** Assign the supplier. Draft only — the supplier is part of what gets sent. */
export async function setPoSupplier(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  const po = await poForAction(id, EDITABLE, "Changing the supplier");
  const supplierId = String(formData.get("supplierId") ?? "").trim() || null;
  const settings = await getSettings();
  const { currency, fxToHome } = await orderCurrencyFor(supplierId, settings.currency);

  // Moving a draft from an Australian supplier to an American one changes what currency
  // the order is placed in, so the prices already on it have to move with it — otherwise
  // AUD figures silently become USD ones and the order is out by about a third.
  if (currency !== po.currency) {
    for (const line of po.lines) {
      const home = toHomeCurrency(line.unitCost, po.fxToHome);
      await prisma.purchaseOrderLine.update({
        where: { id: line.id },
        data: { unitCost: toOrderCurrency(home, fxToHome) },
      });
    }
  }

  await prisma.purchaseOrder.update({ where: { id }, data: { supplierId, currency, fxToHome } });
  revalidatePo(id);
  if (currency !== po.currency)
    notify(id, `${po.poNumber} is now a ${currency} order — line prices were converted from ${po.currency}.`);
}

/**
 * The date the order is needed by, and the note the supplier reads.
 *
 * Both already existed on the row and neither had anywhere to be entered, so the "Required
 * by" and "Notes" rows of the printed order were always blank.
 */
export async function setPoDetails(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  await poForAction(id, EDITABLE, "Changing the order details");

  const raw = String(formData.get("expectedAt") ?? "").trim();
  const expectedAt = raw === "" ? null : new Date(`${raw}T00:00:00Z`);
  if (expectedAt && Number.isNaN(expectedAt.getTime())) refuse(id, "That required-by date could not be read.");

  await prisma.purchaseOrder.update({
    where: { id },
    data: { expectedAt, notes: String(formData.get("notes") ?? "").trim() || null },
  });
  revalidatePo(id);
}

/** Save qty_<lineId> + cost_<lineId> inputs on a draft PO's lines in one go. */
export async function updatePoLines(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const po = await poForAction(poId, EDITABLE, "Editing lines");

  for (const line of po.lines) {
    const raw = formData.get(`qty_${line.id}`);
    if (raw == null || String(raw).trim() === "") continue;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0 || qty === line.qtyOrdered) continue;
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyOrdered: qty } });
  }
  await applyLinePrices(po.lines, formData, po.poNumber, po.fxToHome, user.id);
  revalidatePo(poId);
}

/** Save prices on a sent (ordered/partial) PO without receiving anything. */
export async function savePoLinePrices(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const po = await poForAction(poId, SENT, "Saving prices on a sent order");
  await applyLinePrices(po.lines, formData, po.poNumber, po.fxToHome, user.id);
  revalidatePo(poId);
}

/**
 * Drop a line from a draft.
 *
 * Draft only, and the line has to belong to this order: deleting a received line would
 * erase the record of a delivery while the stock it booked in stays on the shelf, leaving
 * a movement in the ledger with nothing to explain it.
 */
export async function removePoLine(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const po = await poForAction(poId, EDITABLE, "Removing a line");

  const line = po.lines.find((l) => l.id === lineId);
  if (!line) refuse(po.id, "That line is not on this order.");
  if (line.qtyReceived > 0)
    refuse(po.id, `${line.qtyReceived} of that line has already been received, so it can't be removed.`);

  await prisma.purchaseOrderLine.delete({ where: { id: lineId } });
  revalidatePo(poId);
}

export async function addPoLine(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const poId = String(formData.get("poId") ?? "");
  const po = await poForAction(poId, EDITABLE, "Adding a line");
  const partNumber = String(formData.get("partNumber") ?? "").trim();
  const qty = Math.max(1, Number(String(formData.get("qty") ?? "1")));
  const costRaw = String(formData.get("unitCost") ?? "").trim();
  const cost = costRaw === "" ? null : Math.max(0, Number(costRaw) || 0);
  const item = await prisma.item.findUnique({ where: { partNumber } });
  // Previously an item number that matched nothing did nothing at all: the form cleared
  // and the line never appeared, which reads exactly like a broken button.
  if (!item) refuse(poId, `No part has the item number "${partNumber}". Check it on the Parts page.`);
  {
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
        data: {
          purchaseOrderId: poId,
          itemId: item.id,
          qtyOrdered: qty,
          // Typed prices are already in the order's currency; the part's stored cost is
          // in the home one and has to be converted before it seeds a foreign order.
          unitCost: cost ?? toOrderCurrency(item.unitCost ?? 0, po.fxToHome),
        },
      });
    }
    if (cost != null) await setItemCost(item.id, toHomeCurrency(cost, po.fxToHome), po.poNumber, user.id);
  }
  revalidatePo(poId);
}

/**
 * Delete an order outright.
 *
 * A draft nobody was ever sent, or a cancelled order nobody is still acting on. A live
 * order is cancelled rather than erased, which keeps it and its history visible, because
 * somebody holds it and may yet deliver against it.
 *
 * Its lines go with it: the relation cascades. The one thing that outlives an order is the
 * inventory movement a receipt creates, which is why an order that ever took a delivery
 * stays — it is the only record of where that stock came from.
 */
export async function deletePo(poId: string): Promise<PoDeleteResult> {
  try {
    await requireRole("MANAGER");
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { poNumber: true, status: true, lines: { select: { qtyReceived: true } } },
    });
    if (!po) return { ok: false, error: "Purchase order not found." };
    const refusal = statusRefusal(po.poNumber, po.status, DELETABLE, "Deleting");
    if (refusal)
      return {
        ok: false,
        error: CANCELLABLE.includes(po.status) ? `${refusal} Cancel it instead.` : refusal,
      };

    // The real test for a cancelled order: it may have taken a delivery before it was
    // abandoned. Those receipts are stock movements that name this order, and deleting it
    // would leave them pointing at nothing — stock on the shelf with no account of where
    // it came from.
    const received = po.lines.filter((l) => l.qtyReceived > 0);
    if (received.length > 0)
      return {
        ok: false,
        error: `${po.poNumber} took delivery of ${received.length} line(s) before it was closed, so it is the record of where that stock came from and can't be deleted.`,
      };

    await prisma.purchaseOrder.delete({ where: { id: poId } });
    revalidatePo();
    return { ok: true, message: `${po.poNumber} deleted.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete the purchase order." };
  }
}

/** Send the order. Draft only, and not an empty one. */
export async function markPoOrdered(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  const po = await poForAction(id, EDITABLE, "Marking as ordered");
  if (po.lines.length === 0) refuse(po.id, `${po.poNumber} has no lines to order.`);

  await prisma.purchaseOrder.update({ where: { id }, data: { status: "ORDERED", orderedAt: new Date() } });
  revalidatePo(id);
}

/**
 * Put a sent order back to draft so its lines can be edited again.
 *
 * The missing transition: marking as ordered locked the lines permanently, so a PO sent by
 * mistake — or one the supplier came back on with different quantities — could only be
 * cancelled and rebuilt from nothing. Only while nothing has been received, because a
 * receipt is a real movement of stock and reopening the order it was booked against would
 * leave that movement explaining itself.
 */
export async function returnPoToDraft(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  const po = await poForAction(id, SENT, "Reopening");

  const received = po.lines.filter((l) => l.qtyReceived > 0);
  if (received.length > 0)
    refuse(
      po.id,
      `${received.length} line(s) on ${po.poNumber} have already been received, so it can't go back to draft. Receive the rest, or cancel it.`,
    );

  await prisma.purchaseOrder.update({ where: { id }, data: { status: "DRAFT", orderedAt: null } });
  revalidatePo(id);
}

/**
 * Cancel the order. Anything short of fully received, because a received order is a record
 * of goods that are on the shelf — cancelling it would not take them back off.
 *
 * A partly-received order can be cancelled: that is giving up on the outstanding balance.
 * What arrived stays received, and its ledger entries stand.
 */
export async function cancelPo(formData: FormData): Promise<void> {
  await requireRole("MANAGER");
  const id = String(formData.get("poId") ?? "");
  const po = await poForAction(id, CANCELLABLE, "Cancelling");

  await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePo(id);
  if (po.status === "PARTIAL") notify(po.id, `${po.poNumber} cancelled — what had already arrived stays received.`);
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
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: statusAfterReceipts(lines, po.status) },
      });
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
  const po = await poForAction(poId, SENT, "Receiving");

  // Managers may have edited prices in the same submit — apply those too.
  if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices(po.lines, formData, po.poNumber, po.fxToHome, user.id);

  const receipts = po.lines
    .map((line) => ({ lineId: line.id, itemId: line.itemId, qty: receivedQty(formData, line.id) }))
    .filter((r): r is { lineId: string; itemId: string; qty: number } => r.qty !== null);
  if (receipts.length === 0) refuse(po.id, "Nothing was entered to receive. Type a quantity against the lines that arrived.");

  await bookReceipts(po, receipts, user.id);
  revalidatePo(poId);

  // Over-shipments happen and the goods are real, so they are booked in rather than
  // capped — but silently banking more than was ordered is how a count goes wrong later.
  const over = overReceipts(po.lines, receipts);
  if (over.length > 0) notify(po.id, overMessage(po.poNumber, over));
}

/** Receive a single line on its own — the common "one part turned up" case. */
export async function receivePoLine(formData: FormData): Promise<void> {
  const user = await requireRole("OPERATOR");
  const poId = String(formData.get("poId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const po = await poForAction(poId, SENT, "Receiving");

  const line = po.lines.find((l) => l.id === lineId);
  if (!line) refuse(po.id, "That line is not on this order.");
  if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices([line], formData, po.poNumber, po.fxToHome, user.id);

  // Blank box on the line being received = receive the rest of it.
  const qty = receivedQty(formData, lineId) ?? Math.max(0, line.qtyOrdered - line.qtyReceived);
  if (qty <= 0) refuse(po.id, "That line is already fully received.");

  await bookReceipts(po, [{ lineId, itemId: line.itemId, qty }], user.id);
  revalidatePo(poId);

  const over = overReceipts(po.lines, [{ lineId, qty }]);
  if (over.length > 0) notify(po.id, overMessage(po.poNumber, over));
}

/** Receive every outstanding quantity at once — the whole order turned up together. */
export async function receivePoRemaining(formData: FormData): Promise<void> {
  const user = await requireRole("OPERATOR");
  const poId = String(formData.get("poId") ?? "");
  const po = await poForAction(poId, SENT, "Receiving");

  if (roleAtLeast(user.role, "MANAGER")) await applyLinePrices(po.lines, formData, po.poNumber, po.fxToHome, user.id);

  const receipts = po.lines
    .map((line) => ({ lineId: line.id, itemId: line.itemId, qty: Math.max(0, line.qtyOrdered - line.qtyReceived) }))
    .filter((r) => r.qty > 0);
  if (receipts.length === 0) refuse(po.id, `Every line on ${po.poNumber} is already received.`);

  await bookReceipts(po, receipts, user.id);
  revalidatePo(poId);
}
