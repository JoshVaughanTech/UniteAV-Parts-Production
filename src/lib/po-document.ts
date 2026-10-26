/**
 * The purchase order as a supplier receives it.
 *
 * Assembling the document is kept apart from rendering it for two reasons. The money has
 * to be right — a GST line on an order that carries no GST, or a total that disagrees with
 * its own subtotal, is the kind of mistake a supplier's accounts department notices before
 * you do — and it has to be checkable without a browser. And deciding *here* what appears
 * on the page means the internal figures the app screen shows (on-hand, received,
 * the USD conversion, the approval state) have no route onto a document that leaves the
 * building: they are simply not in this shape.
 */

export interface DocumentCompany {
  name: string | null;
  abn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface DocumentSupplier {
  name: string;
  contact: string | null;
  address: string | null;
  email: string | null;
  chargesGst: boolean;
}

export interface DocumentLine {
  /** 1-based, printed, so a supplier can refer to "line 3". */
  n: number;
  partNumber: string;
  description: string;
  mpn: string | null;
  qty: number;
  unitCost: number;
  amount: number;
}

export interface PoDocument {
  poNumber: string;
  currency: string;
  raisedOn: Date;
  requiredBy: Date | null;
  company: DocumentCompany;
  supplier: DocumentSupplier;
  deliverTo: string | null;
  lines: DocumentLine[];
  subtotal: number;
  /** Null when this supplier charges no GST, which prints as a stated exemption. */
  gst: number | null;
  gstRate: number;
  total: number;
  notes: string | null;
  terms: string | null;
  raisedBy: string | null;
  /** Letterhead fields still unset, so the document would go out anonymous. */
  missingCompanyDetails: string[];
}

interface SourceLine {
  item: { partNumber: string; name: string; mpn: string | null };
  qtyOrdered: number;
  unitCost: number;
}

interface SourceSettings {
  currency: string;
  gstRate: number;
  companyName: string | null;
  companyAbn: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  deliverTo: string | null;
  poTerms: string | null;
}

interface SourcePo {
  poNumber: string;
  currency: string;
  createdAt: Date;
  orderedAt: Date | null;
  expectedAt: Date | null;
  notes: string | null;
  supplier: { name: string; contact: string | null; address: string | null; email: string | null; chargesGst: boolean } | null;
  lines: SourceLine[];
}

/** Round to cents. Float arithmetic on a line total is how a PO ends up a cent out. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildPoDocument(po: SourcePo, settings: SourceSettings, raisedBy: string | null): PoDocument {
  const lines: DocumentLine[] = po.lines.map((l, i) => ({
    n: i + 1,
    partNumber: l.item.partNumber,
    description: l.item.name,
    // Only when it differs from the description, so the line doesn't repeat itself.
    mpn: l.item.mpn && l.item.mpn !== l.item.name ? l.item.mpn : null,
    qty: l.qtyOrdered,
    unitCost: l.unitCost,
    amount: money(l.qtyOrdered * l.unitCost),
  }));

  // Summed from the rounded line amounts, so the column adds up to the subtotal printed
  // beneath it. Summing the unrounded products instead leaves a total that is right to the
  // cent but visibly disagrees with the figures above it.
  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const chargesGst = po.supplier?.chargesGst ?? true;
  const gst = chargesGst ? money(subtotal * settings.gstRate) : null;

  const missing: string[] = [];
  if (!settings.companyName?.trim()) missing.push("business name");
  if (!settings.companyAbn?.trim()) missing.push("ABN");
  if (!settings.companyAddress?.trim()) missing.push("address");

  return {
    poNumber: po.poNumber,
    currency: po.currency || settings.currency,
    // The date the order was sent is what a supplier is owed; before it is sent, the date
    // it was raised is the only date there is.
    raisedOn: po.orderedAt ?? po.createdAt,
    requiredBy: po.expectedAt,
    company: {
      name: settings.companyName,
      abn: settings.companyAbn,
      address: settings.companyAddress,
      phone: settings.companyPhone,
      email: settings.companyEmail,
    },
    supplier: {
      name: po.supplier?.name ?? "Unassigned supplier",
      contact: po.supplier?.contact ?? null,
      address: po.supplier?.address ?? null,
      email: po.supplier?.email ?? null,
      chargesGst,
    },
    deliverTo: settings.deliverTo?.trim() || settings.companyAddress,
    lines,
    subtotal,
    gst,
    gstRate: settings.gstRate,
    total: money(subtotal + (gst ?? 0)),
    notes: po.notes?.trim() || null,
    terms: settings.poTerms?.trim() || null,
    raisedBy,
    missingCompanyDetails: missing,
  };
}
