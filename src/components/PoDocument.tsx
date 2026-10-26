import type { PoDocument } from "@/lib/po-document";

/**
 * The sheet of paper a supplier receives, and the only place its appearance is defined.
 *
 * Separate from the route that fetches it so the layout can be rendered on its own — the
 * CSS here is print geometry in millimetres, which is not something to write blind and
 * hope about. `scripts/preview-po-document.ts` renders this exact markup and stylesheet to
 * a file you can open at A4 and look at.
 *
 * Colours are fixed black-on-white rather than the app's theme tokens. This is ink on
 * paper: a document that honoured dark mode would print as a black rectangle.
 */

export const PO_DOCUMENT_CSS = `
  /* Portrait A4, overriding the landscape size the dashboard pages print at. */
  @page { size: A4 portrait; margin: 14mm 14mm 16mm; }

  .doc {
    width: 182mm;
    margin: 0 auto;
    color: #000;
    background: #fff;
    font-family: ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.45;
  }
  .doc h1, .doc h2, .doc h3 { margin: 0; font-weight: 600; }
  .doc-pre { white-space: pre-line; }

  /* Letterhead */
  .doc-head { display: flex; justify-content: space-between; gap: 12mm; align-items: flex-start; }
  .doc-company-name {
    font-size: 15pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.15;
  }
  .doc-company-meta { margin-top: 1.5mm; font-size: 8.5pt; line-height: 1.5; color: #333; }
  .doc-title { text-align: right; }
  .doc-title-word {
    font-size: 13pt; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; white-space: nowrap;
  }
  .doc-ref { margin-top: 2.5mm; font-size: 8.5pt; }
  .doc-ref table { margin-left: auto; border-collapse: collapse; }
  .doc-ref th {
    text-align: left; font-weight: 400; color: #555; padding: 0.4mm 4mm 0.4mm 0; white-space: nowrap;
  }
  .doc-ref td { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc-ref .doc-ref-no td { font-weight: 700; font-size: 11pt; }

  .doc-rule { border: 0; border-top: 1.2pt solid #000; margin: 4mm 0 0; }

  /* Addresses */
  .doc-parties { display: grid; grid-template-columns: 1fr 1fr; margin-top: 4mm; }
  .doc-party { padding: 3mm 4mm 3.5mm 0; }
  .doc-party + .doc-party { padding-left: 8mm; border-left: 0.5pt solid #bbb; }
  .doc-party-label {
    font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #555;
    margin-bottom: 1.5mm;
  }
  .doc-party-name { font-weight: 600; font-size: 10pt; }
  .doc-faint { color: #777; }

  /* Order table */
  .doc-table { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: 9pt; }
  .doc-table thead th {
    border-top: 0.5pt solid #000; border-bottom: 0.5pt solid #000;
    padding: 2mm; text-align: left;
    font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .doc-table tbody td { padding: 2mm; border-bottom: 0.4pt solid #ddd; vertical-align: top; }
  .doc-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc-n { width: 7mm; color: #666; }
  .doc-code { width: 32mm; font-weight: 600; }
  .doc-qty { width: 16mm; }
  .doc-unit { width: 24mm; }
  .doc-amt { width: 26mm; }
  .doc-mpn { font-size: 8pt; color: #555; }
  /* A long order repeats its headings on every sheet, and no row splits across a page. */
  .doc-table thead { display: table-header-group; }
  .doc-table tr { break-inside: avoid; }

  /* Totals */
  .doc-totals { margin-top: 4mm; }
  .doc-totals table { margin-left: auto; border-collapse: collapse; min-width: 76mm; }
  .doc-totals th { text-align: right; font-weight: 400; padding: 1mm 6mm 1mm 0; white-space: nowrap; }
  .doc-totals td { text-align: right; font-variant-numeric: tabular-nums; width: 32mm; padding: 1mm 0; }
  .doc-totals .doc-total-row th, .doc-totals .doc-total-row td {
    border-top: 1.2pt solid #000; padding-top: 1.6mm; font-weight: 700; font-size: 11pt;
  }
  .doc-gst-note { margin-top: 1.5mm; font-size: 8pt; color: #555; text-align: right; }

  /* Foot */
  .doc-foot { margin-top: 7mm; border-top: 0.5pt solid #bbb; padding-top: 3.5mm; font-size: 8.5pt; }
  .doc-foot table { border-collapse: collapse; width: 100%; }
  .doc-foot th {
    width: 20mm; text-align: left; vertical-align: top; padding: 0 4mm 2mm 0;
    font-size: 7.5pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #555;
  }
  .doc-foot td { vertical-align: top; padding: 0 0 2mm; }
  .doc-sign {
    margin-top: 8mm; padding-top: 2mm; border-top: 0.4pt solid #ddd;
    font-size: 8pt; color: #444; display: flex; justify-content: space-between; gap: 8mm;
  }

  @media screen {
    .doc-page { padding: 8mm 4mm 16mm; background: #f4f4f5; min-height: 100vh; }
    .doc { box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 10px 30px rgba(0,0,0,0.12); padding: 14mm 14mm 16mm; }
  }
  @media print {
    .doc-page { padding: 0; background: #fff; }
    .doc { box-shadow: none; width: auto; padding: 0; }
    .no-print { display: none !important; }
  }
`;

/** Unambiguous for a supplier in any country: "25 Oct 2026", never 10/25 or 25/10. */
export function docDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Grouped figures. The currency is stated in the column heads and on the total, once each. */
function amount(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Unit prices run to four places — plenty of these parts cost a fraction of a cent. */
function unit(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function PoDocumentSheet({ doc }: { doc: PoDocument }) {
  const cur = doc.currency;

  return (
    <article className="doc">
      <header className="doc-head">
        <div>
          <div className="doc-company-name">{doc.company.name ?? "Your business name"}</div>
          <div className="doc-company-meta">
            {doc.company.abn && <div>ABN {doc.company.abn}</div>}
            {doc.company.address && <div className="doc-pre">{doc.company.address}</div>}
            {(doc.company.phone || doc.company.email) && (
              <div>{[doc.company.phone, doc.company.email].filter(Boolean).join("  ·  ")}</div>
            )}
          </div>
        </div>
        <div className="doc-title">
          <div className="doc-title-word">Purchase Order</div>
          <div className="doc-ref">
            <table>
              <tbody>
                <tr className="doc-ref-no">
                  <th>Order no.</th>
                  <td>{doc.poNumber}</td>
                </tr>
                <tr>
                  <th>Date</th>
                  <td>{docDate(doc.raisedOn)}</td>
                </tr>
                {/* Omitted rather than dashed: a blank row on a formal document reads as
                    something left unfinished. */}
                {doc.requiredBy && (
                  <tr>
                    <th>Required by</th>
                    <td>{docDate(doc.requiredBy)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </header>
      <hr className="doc-rule" />

      <section className="doc-parties">
        <div className="doc-party">
          <div className="doc-party-label">Supplier</div>
          <div className="doc-party-name">{doc.supplier.name}</div>
          {doc.supplier.contact && <div>Attn: {doc.supplier.contact}</div>}
          {doc.supplier.address ? (
            <div className="doc-pre">{doc.supplier.address}</div>
          ) : (
            <div className="doc-faint no-print">No address on file for this supplier</div>
          )}
          {doc.supplier.email && <div>{doc.supplier.email}</div>}
        </div>
        <div className="doc-party">
          <div className="doc-party-label">Deliver to</div>
          {doc.company.name && <div className="doc-party-name">{doc.company.name}</div>}
          {doc.deliverTo ? (
            <div className="doc-pre">{doc.deliverTo}</div>
          ) : (
            <div className="doc-faint no-print">No delivery address set</div>
          )}
        </div>
      </section>

      <table className="doc-table">
        <thead>
          <tr>
            <th className="doc-n">#</th>
            <th className="doc-code">Item number</th>
            <th>Description</th>
            <th className="num doc-qty">Qty</th>
            <th className="num doc-unit">Unit ({cur})</th>
            <th className="num doc-amt">Amount ({cur})</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.n}>
              <td className="doc-n num">{l.n}</td>
              <td className="doc-code">{l.partNumber}</td>
              <td>
                {l.description}
                {l.mpn && <div className="doc-mpn">MPN: {l.mpn}</div>}
              </td>
              <td className="num">{l.qty.toLocaleString("en-AU")}</td>
              <td className="num">{unit(l.unitCost)}</td>
              <td className="num">{amount(l.amount)}</td>
            </tr>
          ))}
          {doc.lines.length === 0 && (
            <tr>
              <td colSpan={6} className="doc-faint" style={{ padding: "8mm 2mm", textAlign: "center" }}>
                This order has no lines.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="doc-totals">
        <table>
          <tbody>
            <tr>
              <th>Subtotal</th>
              <td>{amount(doc.subtotal)}</td>
            </tr>
            {doc.gst != null && (
              <tr>
                <th>GST ({Math.round(doc.gstRate * 100)}%)</th>
                <td>{amount(doc.gst)}</td>
              </tr>
            )}
            <tr className="doc-total-row">
              <th>Total {cur}</th>
              <td>{amount(doc.total)}</td>
            </tr>
          </tbody>
        </table>
        {doc.gst == null && <p className="doc-gst-note">No GST — overseas supply.</p>}
      </section>

      <footer className="doc-foot">
        <table>
          <tbody>
            {doc.notes && (
              <tr>
                <th>Notes</th>
                <td className="doc-pre">{doc.notes}</td>
              </tr>
            )}
            <tr>
              <th>Terms</th>
              <td className="doc-pre">
                {doc.terms ?? `Please quote ${doc.poNumber} on all correspondence, invoices and delivery dockets.`}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="doc-sign">
          <span>{doc.raisedBy ? `Raised by ${doc.raisedBy}` : ""}</span>
          <span>{doc.poNumber}</span>
        </div>
      </footer>
    </article>
  );
}
