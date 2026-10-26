/**
 * What a purchase order will and won't allow in each status.
 *
 * A purchase order runs DRAFT → ORDERED → PARTIAL → RECEIVED, and can be CANCELLED from
 * anywhere short of RECEIVED. The rules live here, apart from the actions that enforce
 * them, so they can be checked without a database or a signed-in user — the decision table
 * is the part that is easy to get quietly wrong.
 *
 * The transitions are not decoration. Removing a line that has already been received would
 * delete the record of a delivery while the stock it added stays on the shelf. Receiving
 * against a draft books goods in against an order nobody has sent. Cancelling a received
 * order would not take the goods back off the shelf.
 */

/** Statuses in which the lines, quantities, prices and supplier can still change. */
export const EDITABLE = ["DRAFT"];
/** Sent to the supplier, so goods can arrive against it. */
export const SENT = ["ORDERED", "PARTIAL"];
/** Anything short of fully received. */
export const CANCELLABLE = ["DRAFT", "ORDERED", "PARTIAL"];

/** "draft", or "ordered or partial", for a sentence. */
export function readable(statuses: string[]): string {
  const words = statuses.map((s) => s.toLowerCase());
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/**
 * The reason an action can't run in this status, or null when it can.
 *
 * `what` names the action from the user's side — "Receiving", "Removing a line" — so the
 * sentence reads as an explanation rather than an error code.
 */
export function statusRefusal(
  poNumber: string,
  status: string,
  allowed: string[],
  what: string,
): string | null {
  if (allowed.includes(status)) return null;
  const list = readable(allowed);
  const article = /^[aeiou]/i.test(list) ? "an" : "a";
  return `${poNumber} is ${status.toLowerCase()}. ${what} applies to ${article} ${list} order.`;
}

export interface ReceivableLine {
  id: string;
  qtyOrdered: number;
  qtyReceived: number;
}

/**
 * Lines where this delivery takes the received total past what was ordered.
 *
 * Over-shipments are booked in rather than capped: the goods are real and on the shelf, and
 * capping would lose stock that exists. But banking more than was ordered without saying so
 * is how a stocktake later turns up a variance nobody can explain, so the caller reports it.
 */
export function overReceipts(
  lines: ReceivableLine[],
  receipts: { lineId: string; qty: number }[],
): { excess: number; ordered: number }[] {
  return receipts
    .map((r) => {
      const line = lines.find((l) => l.id === r.lineId);
      if (!line) return null;
      const excess = line.qtyReceived + r.qty - line.qtyOrdered;
      return excess > 0 ? { excess, ordered: line.qtyOrdered } : null;
    })
    .filter((x): x is { excess: number; ordered: number } => x !== null);
}

export function overMessage(poNumber: string, over: { excess: number; ordered: number }[]): string {
  const units = over.reduce((s, o) => s + o.excess, 0);
  return `Booked in, but ${over.length} line(s) on ${poNumber} came to ${units} more than was ordered. The stock is in — check the delivery against the order.`;
}

/** The status a PO lands in once these lines are what they are. */
export function statusAfterReceipts(lines: ReceivableLine[], current: string): string {
  if (lines.every((l) => l.qtyReceived >= l.qtyOrdered)) return "RECEIVED";
  if (lines.some((l) => l.qtyReceived > 0)) return "PARTIAL";
  return current;
}
