/**
 * Check the purchase-order decision table against the rules the actions actually use.
 *
 * Imports po-status directly rather than restating the rules, so a change to the rules
 * changes what is tested. No database and no signed-in user: this is the part of the
 * guards that is pure, and it is the part that is easy to get quietly wrong.
 *
 *   npx tsx scripts/verify-po-status.ts
 */
import {
  EDITABLE,
  SENT,
  CANCELLABLE,
  DELETABLE,
  statusRefusal,
  statusAfterReceipts,
  overReceipts,
  readable,
} from "@/lib/po-status";

const STATUSES = ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"];

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

/** Does the guard let this action through in this status? */
function allows(allowed: string[], status: string): boolean {
  return statusRefusal("PO-0001", status, allowed, "Doing it") === null;
}

console.log("\nWho may edit lines, prices and the supplier (draft only)");
for (const s of STATUSES) check(`${s} editable`, allows(EDITABLE, s), s === "DRAFT");

console.log("\nWho may receive goods (sent only)");
for (const s of STATUSES) check(`${s} receivable`, allows(SENT, s), s === "ORDERED" || s === "PARTIAL");

console.log("\nWho may be cancelled (anything short of received)");
for (const s of STATUSES)
  check(`${s} cancellable`, allows(CANCELLABLE, s), s === "DRAFT" || s === "ORDERED" || s === "PARTIAL");

console.log("\nWho may be deleted outright (never a live order — that gets cancelled, not erased)");
for (const s of STATUSES) check(`${s} deletable`, allows(DELETABLE, s), s === "DRAFT" || s === "CANCELLED");
check(
  "deleting a sent order is refused",
  statusRefusal("PO-0007", "ORDERED", DELETABLE, "Deleting"),
  "PO-0007 is ordered. Deleting applies to a draft or cancelled order.",
);
check(
  "deleting a received order is refused",
  statusRefusal("PO-0001", "RECEIVED", DELETABLE, "Deleting"),
  "PO-0001 is received. Deleting applies to a draft or cancelled order.",
);
// Status alone does not clear a cancelled order for deletion — it may have taken a
// delivery first, and those receipts are what the order accounts for. The caller checks
// the lines; this just confirms the status gate lets it through to that check.
check("a cancelled order passes the status gate", statusRefusal("PO-0005", "CANCELLED", DELETABLE, "Deleting"), null);

console.log("\nThe refusals that were previously silent");
check(
  "receiving against a draft is refused",
  statusRefusal("PO-0009", "DRAFT", SENT, "Receiving"),
  "PO-0009 is draft. Receiving applies to an ordered or partial order.",
);
check(
  "cancelling a received order is refused",
  statusRefusal("PO-0001", "RECEIVED", CANCELLABLE, "Cancelling"),
  "PO-0001 is received. Cancelling applies to a draft, ordered or partial order.",
);
check(
  "re-ordering a cancelled order is refused",
  statusRefusal("PO-0005", "CANCELLED", EDITABLE, "Marking as ordered"),
  "PO-0005 is cancelled. Marking as ordered applies to a draft order.",
);
check("editing a draft is allowed", statusRefusal("PO-0008", "DRAFT", EDITABLE, "Editing lines"), null);
check("readable() reads as a sentence", readable(SENT), "ordered or partial");

console.log("\nStatus after a delivery");
const ordered10 = [{ id: "a", qtyOrdered: 10, qtyReceived: 0 }];
check("nothing received stays as it was", statusAfterReceipts(ordered10, "ORDERED"), "ORDERED");
check("some received is partial", statusAfterReceipts([{ id: "a", qtyOrdered: 10, qtyReceived: 4 }], "ORDERED"), "PARTIAL");
check("all received is received", statusAfterReceipts([{ id: "a", qtyOrdered: 10, qtyReceived: 10 }], "ORDERED"), "RECEIVED");
check(
  "one line short keeps the whole order partial",
  statusAfterReceipts(
    [
      { id: "a", qtyOrdered: 10, qtyReceived: 10 },
      { id: "b", qtyOrdered: 5, qtyReceived: 1 },
    ],
    "ORDERED",
  ),
  "PARTIAL",
);
check(
  "over-receipt still counts as received",
  statusAfterReceipts([{ id: "a", qtyOrdered: 10, qtyReceived: 12 }], "ORDERED"),
  "RECEIVED",
);

console.log("\nOver-shipments are reported, not capped");
check("exactly the order is not an over-receipt", overReceipts(ordered10, [{ lineId: "a", qty: 10 }]), []);
check("under the order is not an over-receipt", overReceipts(ordered10, [{ lineId: "a", qty: 3 }]), []);
check("two over the order is reported", overReceipts(ordered10, [{ lineId: "a", qty: 12 }]), [{ excess: 2, ordered: 10 }]);
check(
  "a top-up that crosses the line is reported",
  overReceipts([{ id: "a", qtyOrdered: 10, qtyReceived: 9 }], [{ lineId: "a", qty: 4 }]),
  [{ excess: 3, ordered: 10 }],
);
check("a line not on the order is ignored", overReceipts(ordered10, [{ lineId: "zz", qty: 99 }]), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
