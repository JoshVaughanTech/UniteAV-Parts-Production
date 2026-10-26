import { prisma } from "@/lib/prisma";
import { rateToHome } from "@/lib/fx";

/**
 * The parts of raising a purchase order that four different places need.
 *
 * Orders are created from the To-Order page, from a blank form, from the auto-order sweep
 * and from a production run's shortfall. Each had its own copy of the numbering and its
 * own assumption that every order is in the home currency, and they had already drifted —
 * one of them still numbered orders by counting rows. Not a `"use server"` module on
 * purpose: these are helpers, and exporting them from one would publish them as endpoints.
 */

/**
 * PO-0008, read off the highest number in use rather than the row count: a count skips a
 * number as soon as one order is removed, and then two orders carry the same number.
 */
export async function nextPoNumber(): Promise<string> {
  const last = await prisma.purchaseOrder.findFirst({ orderBy: { poNumber: "desc" }, select: { poNumber: true } });
  const n = last ? Number(last.poNumber.slice(3)) || 0 : 0;
  return `PO-${(n + 1).toString().padStart(4, "0")}`;
}

export interface OrderCurrency {
  /** What the order is placed in — what the supplier quotes and invoices in. */
  currency: string;
  /** Home-currency units per 1 unit of `currency`, frozen on the order. */
  fxToHome: number;
}

/**
 * The currency an order to this supplier is placed in, and the rate back to home.
 *
 * Both are fixed on the order when it is raised. The supplier's currency can change later
 * without rewriting what was already ordered from them.
 *
 * A pair with no rate available falls back to 1 rather than refusing to create the order.
 * That is visibly wrong on screen — a USD order showing the same number in both currencies
 * — which is the right failure: the order can still be placed and the error announces
 * itself, where a blocked order in a workshop just means somebody rings the supplier.
 */
export async function orderCurrencyFor(supplierId: string | null, homeCurrency: string): Promise<OrderCurrency> {
  const supplier = supplierId
    ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { currency: true } })
    : null;
  const currency = supplier?.currency || homeCurrency;
  if (currency === homeCurrency) return { currency, fxToHome: 1 };
  const { rate } = await rateToHome(currency, homeCurrency);
  return { currency, fxToHome: rate ?? 1 };
}

/**
 * A part's cost is held in the home currency; a line on a foreign order is not.
 *
 * Every valuation in the system reads `Item.unitCost` — inventory value, BOM cost, reorder
 * suggestions — so it stays in one currency and the conversion happens at the order.
 */
export function toOrderCurrency(homeCost: number, fxToHome: number): number {
  return fxToHome > 0 ? homeCost / fxToHome : homeCost;
}

/** The reverse: what a price typed on a foreign order is worth to the business. */
export function toHomeCurrency(orderCost: number, fxToHome: number): number {
  return orderCost * fxToHome;
}
