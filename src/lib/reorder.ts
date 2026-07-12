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

  if (i.leadTimeDays == null) {
    return { rop: i.safetyStock, status: "NO_LEADTIME", suggestedOrderQty: 0, daysOfCover };
  }

  const rop = reorderPoint(i.adu, i.leadTimeDays, i.safetyStock);
  // Order up to a target level that covers lead time + one review period + safety.
  const targetLevel = rop + i.adu * i.reviewPeriodDays;
  const suggestedOrderQty = roundToPack(Math.max(0, targetLevel - i.onHand), i.minPackQty);

  let status: PartStatus;
  if (i.onHand <= 0) status = "OUT";
  else if (i.onHand <= rop) status = "REORDER";
  else if (i.onHand <= rop * 1.2) status = "LOW";
  else status = "OK";

  return { rop, status, suggestedOrderQty, daysOfCover };
}

export const STATUS_META: Record<PartStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  OK: { label: "OK", tone: "ok" },
  LOW: { label: "Low", tone: "warn" },
  REORDER: { label: "Reorder", tone: "bad" },
  OUT: { label: "Out of stock", tone: "bad" },
  NO_LEADTIME: { label: "No lead time", tone: "muted" },
};
