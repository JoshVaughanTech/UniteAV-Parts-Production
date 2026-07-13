import { prisma } from "@/lib/prisma";
import { getToOrderBySupplier, getSettings, type PartRow } from "@/lib/metrics";
import { sendEmail, getAlertRecipients } from "@/lib/email";
import { fmtMoney, fmtNum } from "@/lib/format";

const APP_URL = process.env.APP_URL || "https://unite-av-parts-production.vercel.app";

async function nextPoNumber(): Promise<string> {
  const count = await prisma.purchaseOrder.count();
  return `PO-${(count + 1).toString().padStart(4, "0")}`;
}

function poHtml(poNumber: string, supplierName: string, parts: PartRow[], total: number, cur: string): string {
  const td = "padding:6px 10px;font-size:13px;border-bottom:1px solid #f0efec";
  const rows = parts
    .map(
      (p) => `<tr>
      <td style="${td}"><strong>${p.partNumber}</strong>${p.mpn ? ` · ${p.mpn}` : ""}<br><span style="color:#898781;font-size:11px">${p.name}</span></td>
      <td style="${td};text-align:right"><strong>${fmtNum(p.reorder.suggestedOrderQty)}</strong></td>
    </tr>`,
    )
    .join("");
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b;max-width:640px">
    <h2 style="margin:0 0 4px">Purchase Order ${poNumber}</h2>
    <p style="color:#52514e">To ${supplierName} — from Unite AV. Please supply:</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e1e0d9;border-radius:8px">
      <tr><th style="text-align:left;padding:6px 10px;font-size:11px;color:#898781">Part</th><th style="text-align:right;padding:6px 10px;font-size:11px;color:#898781">Qty</th></tr>
      ${rows}
    </table>
    <p>Estimated total: <strong>${fmtMoney(total, cur)}</strong></p>
  </div>`;
}

interface PoSummary {
  id: string;
  poNumber: string;
  supplier: string;
  total: number;
  autoOrdered: boolean;
}

function summaryHtml(pos: PoSummary[], cur: string, limit: number): string {
  const td = "padding:6px 10px;font-size:13px;border-bottom:1px solid #f0efec";
  const rows = pos
    .map(
      (p) => `<tr>
      <td style="${td}"><a href="${APP_URL}/purchase-orders/${p.id}" style="color:#2a78d6;font-weight:600">${p.poNumber}</a> · ${p.supplier}</td>
      <td style="${td};text-align:right">${fmtMoney(p.total, cur)}</td>
      <td style="${td}">${p.autoOrdered ? "✅ Auto-ordered" : "⏳ Awaiting approval"}</td>
    </tr>`,
    )
    .join("");
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b;max-width:680px">
    <h2 style="margin:0 0 4px">Auto-order run</h2>
    <p style="color:#52514e">POs at or under ${fmtMoney(limit, cur)} are auto-ordered; larger ones wait for your approval.</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e1e0d9;border-radius:8px">${rows}</table>
    <p><a href="${APP_URL}/purchase-orders" style="display:inline-block;background:#2a78d6;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Review purchase orders →</a></p>
  </div>`;
}

export interface AutoOrderResult {
  enabled: boolean;
  created: number;
  autoOrdered: number;
  pendingApproval: number;
  pos: { poNumber: string; supplier: string; total: number; autoOrdered: boolean }[];
}

/**
 * Auto-create POs for parts needing reorder, grouped by (assigned) supplier.
 * Under the approval limit → auto-ordered (and emailed to the supplier); over → left
 * as a draft awaiting approval. Admins get a summary email.
 */
export async function runAutoOrder(): Promise<AutoOrderResult> {
  const settings = await getSettings();
  if (!settings.autoOrderEnabled) {
    return { enabled: false, created: 0, autoOrdered: 0, pendingApproval: 0, pos: [] };
  }

  const groups = (await getToOrderBySupplier()).filter((g) => g.supplierId && g.parts.length > 0);
  const summaries: PoSummary[] = [];
  let autoOrdered = 0;
  let pending = 0;

  for (const g of groups) {
    const underLimit = settings.autoApproveLimit > 0 && g.total <= settings.autoApproveLimit;
    const poNumber = await nextPoNumber();
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: g.supplierId,
        currency: settings.currency,
        autoCreated: true,
        status: underLimit ? "ORDERED" : "DRAFT",
        orderedAt: underLimit ? new Date() : null,
        lines: {
          create: g.parts.map((p) => ({
            itemId: p.id,
            qtyOrdered: p.reorder.suggestedOrderQty,
            unitCost: p.unitCost ?? 0,
          })),
        },
      },
    });
    summaries.push({ id: po.id, poNumber, supplier: g.supplierName, total: g.total, autoOrdered: underLimit });

    if (underLimit) {
      autoOrdered++;
      const supplier = await prisma.supplier.findUnique({ where: { id: g.supplierId! } });
      if (supplier?.email) {
        await sendEmail({
          to: [supplier.email],
          subject: `Purchase Order ${poNumber} — Unite AV`,
          html: poHtml(poNumber, g.supplierName, g.parts, g.total, settings.currency),
        });
      }
    } else {
      pending++;
    }
  }

  if (summaries.length > 0) {
    const to = await getAlertRecipients();
    await sendEmail({
      to,
      subject: `[Unite AV] Auto-order: ${autoOrdered} ordered, ${pending} awaiting approval`,
      html: summaryHtml(summaries, settings.currency, settings.autoApproveLimit),
    });
  }

  return {
    enabled: true,
    created: summaries.length,
    autoOrdered,
    pendingApproval: pending,
    pos: summaries.map((s) => ({ poNumber: s.poNumber, supplier: s.supplier, total: s.total, autoOrdered: s.autoOrdered })),
  };
}
