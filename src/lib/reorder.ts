// Pure reorder math. Reorder point = average daily usage × lead time + safety stock.

export type PartStatus = "OK" | "LOW" | "REORDER" | "OUT" | "ON_ORDER" | "NO_LEADTIME";

export interface ReorderInputs {
  onHand: number;
  adu: number; // average daily usage (units/day)
  leadTimeDays: number | null | undefined;
  safetyStock: number;
  minPackQty: number;
  reviewPeriodDays: number;
  /**
   * Units that planned production runs have already committed this part to.
   *
   * The reorder point is a forecast built from the last thirty days of production. This
   * is the opposite: work somebody has actually decided to do. A run planned for next
   * week is a firmer claim on stock than any average, so it outranks the forecast — a
   * part is short the moment the planned builds need more than is on the shelf, whatever
   * its history says.
   */
  committed?: number;
}

export interface ReorderResult {
  rop: number; // reorder point
  status: PartStatus;
  suggestedOrderQty: number;
  daysOfCover: number | null; // how many days current stock lasts at ADU
  daysUntilReorder: number | null; // days until on-hand reaches the reorder point (forecast)
  /** The level stock has to reach: the reorder point, or committed runs if they want more. */
  requirement: number;
  /** Units planned runs need that aren't on the shelf. */
  shortForRuns: number;
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

  const committed = Math.max(0, i.committed ?? 0);
  const shortForRuns = Math.max(0, committed - i.onHand);
  const requirement = Math.max(rop, committed);

  let status: PartStatus;
  if (i.onHand <= 0) {
    // At or below zero is ALWAYS flagged for reorder — lead time or not.
    status = "OUT";
  } else if (shortForRuns > 0) {
    // A planned build needs more than is on the shelf. That is a decision already taken,
    // so it outranks every forecast below — including the no-lead-time case, which is how
    // a part with no supplier and no history used to end up with no opinion at all.
    status = "REORDER";
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
    // Whatever the forecast asks for, the order has to at least cover the builds that are
    // already planned — otherwise the suggestion is for a quantity that still can't build
    // what is on the board.
    const need = Math.max(target - i.onHand, shortForRuns, i.minPackQty);
    suggestedOrderQty = roundToPack(need, i.minPackQty);
  }

  // Forecast: days until on-hand drops to the reorder point at the current usage rate.
  const daysUntilReorder = i.adu > 0 ? Math.max(0, (i.onHand - rop) / i.adu) : null;

  return { rop, status, suggestedOrderQty, daysOfCover, daysUntilReorder, requirement, shortForRuns };
}

export const STATUS_META: Record<PartStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "info" }> = {
  OK: { label: "OK", tone: "ok" },
  LOW: { label: "Low", tone: "warn" },
  REORDER: { label: "Reorder", tone: "bad" },
  OUT: { label: "Out of stock", tone: "bad" },
  ON_ORDER: { label: "On order", tone: "info" },
  NO_LEADTIME: { label: "No lead time", tone: "muted" },
};
