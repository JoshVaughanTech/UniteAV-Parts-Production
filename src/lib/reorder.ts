// Pure reorder math. Reorder point = average daily usage × lead time + safety stock.

export type PartStatus = "OK" | "LOW" | "REORDER" | "OUT" | "NO_LEADTIME";

export interface ReorderInputs {
  onHand: number;
  adu: number; // average daily usage (units/day)
  leadTimeDays: number | null | undefined;
  safetyStock: number;
  minPackQty: number;
  reviewPeriodDays: number;
}

export interface ReorderResult {
  rop: number; // reorder point
  status: PartStatus;
  suggestedOrderQty: number;
  daysOfCover: number | null; // how many days current stock lasts at ADU
}

export function reorderPoint(adu: number, leadTimeDays: number, safetyStock: number): number {
  return adu * leadTimeDays + safetyStock;
}

/** Round an order quantity up to the nearest whole pack of `minPackQty`. */
export function roundToPack(qty: number, minPackQty: number): number {
  const pack = minPackQty && minPackQty > 0 ? minPackQty : 1;
  if (qty <= 0) return 0;
  return Math.ceil(qty / pack) * pack;
}

export function computeReorder(i: ReorderInputs): ReorderResult {
  const daysOfCover = i.adu > 0 ? i.onHand / i.adu : null;
  const hasLeadTime = i.leadTimeDays != null;
  const rop = hasLeadTime ? reorderPoint(i.adu, i.leadTimeDays as number, i.safetyStock) : i.safetyStock;

  let status: PartStatus;
  if (i.onHand <= 0) {
    // At or below zero is ALWAYS flagged for reorder — lead time or not.
    status = "OUT";
  } else if (hasLeadTime) {
    if (i.onHand <= rop) status = "REORDER";
    else if (i.onHand <= rop * 1.2) status = "LOW";
    else status = "OK";
  } else if (i.safetyStock > 0) {
    // No lead time, but a reorder point (safety stock) is set — judge against it.
    if (i.onHand <= i.safetyStock) status = "REORDER";
    else if (i.onHand <= i.safetyStock * 1.2) status = "LOW";
    else status = "OK";
  } else {
    status = "NO_LEADTIME";
  }

  // Suggested order quantity for anything that needs ordering.
  let suggestedOrderQty = 0;
  if (status === "OUT" || status === "REORDER") {
    // With lead time: cover lead time + one review period + safety. Without it:
    // at least reach safety stock, and never suggest less than one pack/MOQ.
    const target = hasLeadTime ? rop + i.adu * i.reviewPeriodDays : Math.max(i.safetyStock, i.minPackQty);
    suggestedOrderQty = roundToPack(Math.max(target - i.onHand, i.minPackQty), i.minPackQty);
  }

  return { rop, status, suggestedOrderQty, daysOfCover };
}

export const STATUS_META: Record<PartStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  OK: { label: "OK", tone: "ok" },
  LOW: { label: "Low", tone: "warn" },
  REORDER: { label: "Reorder", tone: "bad" },
  OUT: { label: "Out of stock", tone: "bad" },
  NO_LEADTIME: { label: "No lead time", tone: "muted" },
};
