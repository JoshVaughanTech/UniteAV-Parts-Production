import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { clean } from "@/lib/bom/parse";

/**
 * The "Encode Decode Top Level" purchasing sheet: a flat, sectioned rollup that —
 * unlike the board BOMs — carries **Price Each** (unit cost) and **Quantity in Stock**
 * (on-hand) per part. We use it as the master updater for cost + inventory.
 *
 * Layout: header row, then part rows grouped under section headers (e.g.
 * "CONNECTOR PCB Rev B") with section total / "PCB" / mechanical rows in between.
 * Only rows with a real Item Number are parts; everything else is skipped.
 */
export interface TopLevelPart {
  partNumber: string;
  section: string;
  qty: number;
  unitCost: number | null;
  stock: number | null;
  name: string;
  value?: string;
  manufacturer?: string;
  mpn?: string;
}

export interface TopLevelParse {
  parts: TopLevelPart[]; // one row per (section, part) occurrence
  sections: string[];
  warnings: string[];
}

function money(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function intOf(v: unknown): number | null {
  const s = String(v ?? "").replace(/[,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Return the column of the first needle (in priority order) found in the header. */
function findCol(header: string[], ...needles: string[]): number {
  for (const n of needles) {
    const i = header.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/** Parse one worksheet (array-of-arrays) into parts + section labels. */
function parseSheet(aoa: unknown[][], sheetName: string): TopLevelParse {
  const warnings: string[] = [];
  if (!aoa.length) return { parts: [], sections: [], warnings: [] };

  const header = aoa[0].map((c) => clean(c).toLowerCase());
  const col = {
    qty: findCol(header, "quantity"),
    pn: findCol(header, "item number", "part number"),
    comment: findCol(header, "comment"),
    // Prefer the full "item name"; fall back to a "description" column.
    name: findCol(header, "item name", "description"),
    mfr: findCol(header, "manufacturer 1", "manufacturer"),
    mpn: findCol(header, "manufacturer item"),
    // "price each" / "cost each" only — never the "total" columns.
    cost: findCol(header, "price each", "cost each"),
    stock: findCol(header, "quantity in stock", "qty in stock", "qty stock", "current stock level", "stock level", "in stock"),
  };
  if (col.pn < 0) return { parts: [], sections: [], warnings: [] }; // not a parts sheet

  const parts: TopLevelPart[] = [];
  const sections: string[] = [];
  let section = sheetName || "Main";

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const pn = clean(row[col.pn]);
    const qtyRaw = clean(row[col.qty]);
    const comment = col.comment >= 0 ? clean(row[col.comment]) : "";

    // Section header: no item number, no quantity, but a label in the Comment cell.
    if (!pn && !qtyRaw && comment) {
      section = comment;
      if (!sections.includes(section)) sections.push(section);
      continue;
    }
    if (!pn) continue; // totals / PCB / mechanical / freight lines

    parts.push({
      partNumber: pn,
      section,
      qty: intOf(qtyRaw) ?? 0,
      unitCost: col.cost >= 0 ? money(row[col.cost]) : null,
      stock: col.stock >= 0 ? intOf(row[col.stock]) : null,
      name: col.name >= 0 ? clean(row[col.name]) || pn : pn,
      value: col.comment >= 0 ? comment || undefined : undefined,
      manufacturer: col.mfr >= 0 ? clean(row[col.mfr]) || undefined : undefined,
      mpn: col.mpn >= 0 ? clean(row[col.mpn]) || undefined : undefined,
    });
  }

  return { parts, sections, warnings };
}

/** Parse the first sheet only (sectioned single-sheet top-level BOMs). */
export function parseTopLevel(buf: Buffer | ArrayBuffer): TopLevelParse {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  const res = parseSheet(aoa, wb.SheetNames[0]);
  if (!res.sections.length) res.sections.push("Main");
  return res;
}

/** Parse every parts-bearing sheet in a workbook and concatenate (multi-sheet masters). */
export function parseTopLevelWorkbook(buf: Buffer | ArrayBuffer): TopLevelParse {
  const wb = XLSX.read(buf, { type: "buffer" });
  const parts: TopLevelPart[] = [];
  const sections: string[] = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws || !ws["!ref"]) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
    const res = parseSheet(aoa, sn);
    if (res.parts.length) {
      parts.push(...res.parts);
      if (!sections.includes(sn)) sections.push(sn);
    }
  }
  return { parts, sections, warnings: parts.length ? [] : ["No parts-bearing sheets found."] };
}

export interface TopLevelApplySummary {
  partsSeen: number;
  partsCreated: number;
  costUpdated: number;
  stockUpdated: number;
  sections: string[];
}

/**
 * Apply the top-level sheet: for each unique Item Number (first occurrence wins),
 * set unit cost and on-hand stock. Missing parts are created. On-hand is adjusted
 * through a COUNT ledger entry so the change is auditable and idempotent (re-running
 * with the same stock produces a zero-delta no-op).
 */
export async function applyTopLevel(
  parse: TopLevelParse,
  opts: { userId?: string; preserveStockFor?: Set<string> } = {},
): Promise<TopLevelApplySummary> {
  // First occurrence per part carries the authoritative cost + stock.
  const byPart = new Map<string, TopLevelPart>();
  for (const p of parse.parts) if (!byPart.has(p.partNumber)) byPart.set(p.partNumber, p);

  let partsCreated = 0;
  let costUpdated = 0;
  let stockUpdated = 0;

  // Per-part work runs OUTSIDE a transaction (each op idempotent) so a slow/dropped
  // connection can't expire a long-held interactive transaction.
  for (const p of byPart.values()) {
    let item = await prisma.item.findUnique({ where: { partNumber: p.partNumber } });
    if (!item) {
      item = await prisma.item.create({
        data: {
          partNumber: p.partNumber,
          type: "PART",
          name: p.name,
          value: p.value ?? null,
          manufacturer: p.manufacturer ?? null,
          mpn: p.mpn ?? null,
          category: categoryFromPartNumber(p.partNumber),
        },
      });
      partsCreated++;
    }

    if (p.unitCost != null && p.unitCost !== item.unitCost) {
      await prisma.item.update({ where: { id: item.id }, data: { unitCost: p.unitCost } });
      await prisma.priceHistory.create({
        data: {
          itemId: item.id,
          unitCost: p.unitCost,
          previousCost: item.unitCost,
          note: "BOM import",
          userId: opts.userId ?? null,
        },
      });
      costUpdated++;
    }

    if (p.stock != null && !opts.preserveStockFor?.has(p.partNumber)) {
      const delta = p.stock - item.onHand;
      if (delta !== 0) {
        await prisma.inventoryTxn.create({
          data: { itemId: item.id, qtyDelta: delta, type: "COUNT", note: "Stock set from BOM", userId: opts.userId ?? null },
        });
        await prisma.item.update({ where: { id: item.id }, data: { onHand: { increment: delta } } });
        stockUpdated++;
      }
    }
  }

  return {
    partsSeen: byPart.size,
    partsCreated,
    costUpdated,
    stockUpdated,
    sections: parse.sections,
  };
}
