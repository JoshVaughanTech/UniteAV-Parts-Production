/**
 * Check the money on a purchase order document.
 *
 * The column a supplier adds up has to equal the subtotal printed under it, GST has to
 * appear only where it is actually charged, and the total has to equal its own parts. None
 * of that needs a database, so none of it is checked by hand.
 *
 *   npx tsx scripts/verify-po-document.ts
 */
import { buildPoDocument } from "@/lib/po-document";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

const settings = {
  currency: "AUD",
  gstRate: 0.1,
  companyName: "Unite AV Pty Ltd",
  companyAbn: "00 000 000 000",
  companyAddress: "12 Example St\nSuburb VIC 3000",
  companyPhone: "+61 3 0000 0000",
  companyEmail: "orders@uniteav.com",
  deliverTo: null,
  poTerms: "30 days from invoice.",
};

interface TestSupplier {
  name: string;
  contact: string | null;
  address: string | null;
  email: string | null;
  chargesGst: boolean;
}

const domestic: TestSupplier = { name: "Dunmark", contact: "Sales", address: "3 Industrial Ave", email: "s@d.com", chargesGst: true };
const overseas: TestSupplier = { name: "DLS Global Solutions LLC", contact: null, address: null, email: null, chargesGst: false };

function line(partNumber: string, name: string, qty: number, unitCost: number, mpn: string | null = null) {
  return { item: { partNumber, name, mpn }, qtyOrdered: qty, unitCost };
}

function po(supplier: TestSupplier | null, lines: ReturnType<typeof line>[], extra: Partial<{ expectedAt: Date | null; orderedAt: Date | null; notes: string | null }> = {}) {
  return {
    poNumber: "PO-0007",
    currency: "AUD",
    createdAt: new Date("2026-10-20T00:00:00Z"),
    orderedAt: extra.orderedAt ?? null,
    expectedAt: extra.expectedAt ?? null,
    notes: extra.notes ?? null,
    supplier,
    lines,
  };
}

console.log("\nGST appears only where it is charged");
const dom = buildPoDocument(po(domestic, [line("MECH-1", "Chassis", 25, 84.2)]), settings, "Josh");
check("domestic subtotal", dom.subtotal, 2105);
check("domestic GST at 10%", dom.gst, 210.5);
check("domestic total", dom.total, 2315.5);

const ovs = buildPoDocument(po(overseas, [line("MECH-1", "Chassis", 25, 84.2)]), settings, "Josh");
check("overseas has no GST line", ovs.gst, null);
check("overseas total equals its subtotal", ovs.total, ovs.subtotal);

console.log("\nThe printed column adds up to the printed subtotal");
// 3 x 0.335 is 1.005: rounded per line it is 1.01, and a subtotal computed from the
// unrounded products would print 1.00 under a column of figures adding to 1.01.
const awkward = buildPoDocument(
  po(domestic, [line("CAPS-1", "Cap", 3, 0.335), line("CAPS-2", "Cap", 7, 0.1234)]),
  settings,
  null,
);
check("line amounts are rounded to cents", awkward.lines.map((l) => l.amount), [1.01, 0.86]);
check("subtotal equals the sum of the printed amounts", awkward.subtotal, 1.87);
check(
  "subtotal is exactly what the column adds to",
  awkward.subtotal,
  awkward.lines.reduce((s, l) => s + l.amount, 0),
);
check("total equals subtotal plus GST", awkward.total, Math.round((awkward.subtotal + (awkward.gst ?? 0)) * 100) / 100);

console.log("\nLine numbering and MPN");
const numbered = buildPoDocument(
  po(domestic, [line("A-1", "Part A", 1, 1, "MPN-A"), line("B-1", "Part B", 1, 1, "Part B")]),
  settings,
  null,
);
check("lines are numbered from 1", numbered.lines.map((l) => l.n), [1, 2]);
check("an MPN that differs is shown", numbered.lines[0].mpn, "MPN-A");
check("an MPN identical to the description is dropped", numbered.lines[1].mpn, null);

console.log("\nDates and addresses");
check(
  "the order date is the day it was sent, not raised",
  buildPoDocument(po(domestic, [], { orderedAt: new Date("2026-10-25T00:00:00Z") }), settings, null).raisedOn.toISOString().slice(0, 10),
  "2026-10-25",
);
check(
  "an unsent order falls back to the day it was raised",
  buildPoDocument(po(domestic, []), settings, null).raisedOn.toISOString().slice(0, 10),
  "2026-10-20",
);
check("deliver-to falls back to the business address", dom.deliverTo, "12 Example St\nSuburb VIC 3000");
check(
  "an explicit deliver-to wins",
  buildPoDocument(po(domestic, []), { ...settings, deliverTo: "Rear dock" }, null).deliverTo,
  "Rear dock",
);
check("a PO with no supplier says so rather than printing blank", buildPoDocument(po(null, []), settings, null).supplier.name, "Unassigned supplier");
check("a PO with no supplier still assumes GST", buildPoDocument(po(null, []), settings, null).gst, 0);

console.log("\nAn unfilled letterhead is reported, not printed blank");
check(
  "every missing field is named",
  buildPoDocument(po(domestic, []), { ...settings, companyName: null, companyAbn: null, companyAddress: "  " }, null)
    .missingCompanyDetails,
  ["business name", "ABN", "address"],
);
check("a complete letterhead reports nothing", dom.missingCompanyDetails, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
