/**
 * Render the purchase-order document to a standalone HTML file with sample data.
 *
 * The document's CSS is print geometry in millimetres, which is not something to write and
 * hope about — this renders the real component and the real stylesheet so the layout can be
 * opened at A4 and looked at, without a database, a login, or a running server.
 *
 *   npx tsx scripts/preview-po-document.ts [outfile.html]
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPoDocument } from "@/lib/po-document";
import { PoDocumentSheet, PO_DOCUMENT_CSS } from "@/components/PoDocument";

const settings = {
  currency: "AUD",
  gstRate: 0.1,
  companyName: "Unite AV Pty Ltd",
  companyAbn: "48 123 456 789",
  companyAddress: "Unit 4, 12 Example Street\nSomewhere VIC 3000\nAustralia",
  companyPhone: "+61 3 9000 0000",
  companyEmail: "orders@uniteav.com",
  deliverTo: "Rear dock, Unit 4, 12 Example Street\nSomewhere VIC 3000\nReceiving hours 9am–4pm Mon–Fri",
  poTerms:
    "Payment 30 days from date of invoice. Please quote the order number on all correspondence, invoices and delivery dockets. Partial deliveries accepted; advise of any shortfall before despatch.",
};

function line(partNumber: string, name: string, mpn: string | null, qty: number, unitCost: number) {
  return { item: { partNumber, name, mpn }, qtyOrdered: qty, unitCost };
}

/** A domestic order with GST, long descriptions, and a sub-cent unit price. */
const domestic = buildPoDocument(
  {
    poNumber: "PO-0007",
    currency: "AUD",
    createdAt: new Date("2026-10-22T00:00:00Z"),
    orderedAt: new Date("2026-10-25T00:00:00Z"),
    expectedAt: new Date("2026-11-08T00:00:00Z"),
    notes: "Deliver to the rear dock and call on arrival. Do not leave with reception.",
    supplier: {
      name: "Dunmark Engineering Pty Ltd",
      contact: "Sales desk",
      address: "3 Industrial Avenue\nCampbellfield VIC 3061",
      email: "sales@dunmark.com.au",
      chargesGst: true,
    },
    lines: [
      line("MECH-00041", "Chassis, 2U rack, powder coated black", "DM-2U-PC-BLK", 25, 84.2),
      line("MECH-00052", "Front panel, 2U, milled and anodised", "DM-FP-2U-ANO", 25, 45.906),
      line("MECH-00061", "Rear panel, 2U, punched for XLR x4", null, 25, 31.4),
      line("MECH-00077", "Rubber foot, M4 threaded, 18mm", "RF-M4-18", 100, 0.885),
      line("MECH-00080", "Screw, M3x8 pan head, stainless, passivated", "SCR-M3-8-SS", 2000, 0.0184),
    ],
  },
  settings,
  "Josh Vaughan",
);

/** An overseas order: no GST line, no supplier address on file, no required-by date. */
const overseas = buildPoDocument(
  {
    poNumber: "PO-0008",
    currency: "AUD",
    createdAt: new Date("2026-10-26T00:00:00Z"),
    orderedAt: null,
    expectedAt: null,
    notes: null,
    supplier: { name: "DLS Global Solutions LLC", contact: null, address: null, email: "sales@dlsglobal.com", chargesGst: false },
    lines: [
      line("ICPS-00012", "Processor, quad core A55, 1.8GHz, BGA-361", "RK3576-BGA361", 50, 18.44),
      line("ICMS-00031", "DDR4 SDRAM 2GB, 16-bit, FBGA-96", "MT41K256M16TW-107", 50, 7.912),
    ],
  },
  settings,
  "Josh Vaughan",
);

/** The same order before the letterhead has been filled in. */
const anonymous = buildPoDocument(
  {
    poNumber: "PO-0009",
    currency: "AUD",
    createdAt: new Date("2026-10-26T00:00:00Z"),
    orderedAt: null,
    expectedAt: null,
    notes: null,
    supplier: { name: "Metalux", contact: null, address: null, email: null, chargesGst: true },
    lines: [line("MECH-00041", "Chassis, 2U rack", null, 5, 84.2)],
  },
  { ...settings, companyName: null, companyAbn: null, companyAddress: null, deliverTo: null, poTerms: null },
  null,
);

const sheets = [
  ["A domestic order — GST, five lines, a sub-cent unit price", domestic],
  ["An overseas order — no GST, no supplier address, no required-by date", overseas],
  ["Before the letterhead is filled in", anonymous],
] as const;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Purchase order document preview</title>
<style>
  body { margin: 0; background: #e5e5e7; font-family: ui-sans-serif, system-ui, sans-serif; }
  .caption {
    max-width: 210mm; margin: 0 auto; padding: 10mm 4mm 2mm; font-size: 13px; font-weight: 600; color: #3f3f46;
  }
  @media print { .caption { display: none; } }
${PO_DOCUMENT_CSS}
</style>
</head>
<body>
${sheets.map(([caption, doc]) => `<p class="caption">${caption}</p>\n<div class="doc-page" style="min-height:auto">${renderToStaticMarkup(PoDocumentSheet({ doc }))}</div>`).join("\n")}
</body>
</html>
`;

const out = path.resolve(process.argv[2] ?? "po-document-preview.html");
fs.writeFileSync(out, html, "utf8");
console.log(`Wrote ${out}`);
console.log(`${sheets.length} sample orders. Open it and print-preview at A4 portrait.`);
