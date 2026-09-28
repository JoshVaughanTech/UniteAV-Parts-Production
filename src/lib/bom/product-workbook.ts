import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { clean, parseWorkbookSheet } from "@/lib/bom/parse";
import { importBom } from "@/lib/bom/import";
import { explodeProduct } from "@/lib/bom/explode";

/**
 * A "product workbook" is one .xlsx per finished product: a chassis rollup sheet plus one
 * sheet per PCB it contains (U74 / UR86 / UR64). It differs from the other two shapes:
 *
 *   - board BOM  (src/lib/bom/parse.ts)    — one file, one board, all parts have item numbers
 *   - price sheet (src/lib/bom/toplevel.ts) — flat master, updates cost + stock everywhere
 *   - product workbook (this file)          — one file, one PRODUCT: boards + chassis parts
 *
 * The chassis rollup ("Total Cost") carries the metalwork, looms, plugs, carton and knobs.
 * Those rows have NO item number in the source, so we synthesize a stable one from the
 * drawing number or name — see `chassisPartNumber`.
 *
 * Cost/stock policy: this importer never touches an existing part's unit cost or on-hand
 * (those are owned by POs, counts and the master price sheets). Chassis parts it CREATES
 * take their initial cost and stock from the sheet, since nothing else knows them.
 */

export interface WorkbookBoard {
  sheet: string; // sheet name inside the workbook
  partNumber: string; // assembly item number
  name: string;
  /** Link an assembly that already exists instead of rebuilding it from this sheet. */
  reuse?: boolean;
  /** Why it is reused / how it differs — surfaced in the import log. */
  note?: string;
}

export interface ProductWorkbookSpec {
  match: RegExp; // filename
  partNumber: string; // product item number
  name: string;
  chassisSheet: string;
  boards: WorkbookBoard[];
  /** Chassis rows to drop (Item Name, case-insensitive) — e.g. already on a board sheet. */
  skipChassis?: string[];
}

/**
 * The three chassis products. Each pairs an AN3010-family DSP board revision with the
 * AN3011 control board; the control board is byte-identical across UR64/UR86 (verified
 * line-by-line against the existing assembly), while U74 additionally fits the LCD, its
 * FPC cable and four rotary encoders — so U74 gets its own control variant.
 */
export const PRODUCT_WORKBOOKS: ProductWorkbookSpec[] = [
  {
    match: /^UR64 Total BOM/i,
    partNumber: "PROD-UR64",
    name: "UR64",
    chassisSheet: "Total Cost",
    boards: [
      { sheet: "U64 DSP Cost", partNumber: "u64_dsp", name: "U64 DSP PCA" },
      {
        sheet: "U64 Control PCB Cost",
        partNumber: "an3011_b_control",
        name: "AN3011 Control",
        reuse: true,
        note: "same 21 lines as the existing assembly; LCD/FPC/encoder rows are qty 0 (not fitted)",
      },
    ],
  },
  {
    match: /^UR86 Total BOM/i,
    partNumber: "PROD-UR86",
    name: "UR86",
    chassisSheet: "Total Cost",
    boards: [
      { sheet: "BOM AN3010 G Main", partNumber: "an3010_g_main", name: "AN3010 G Main" },
      {
        sheet: "BOM AN3011 B Control",
        partNumber: "an3011_b_control",
        name: "AN3011 Control",
        reuse: true,
        note: "identical to the existing assembly (21/21 lines, same quantities)",
      },
    ],
    // The chassis sheet lists the fan separately, but MECH-00011 (FAN-3WIRE, same $5.98)
    // is already on the AN3010 G Main sheet — counting both would double it.
    skipChassis: ["Fan"],
  },
  {
    match: /^U74 BOM Cost and Purchasing/i,
    partNumber: "PROD-U74",
    name: "U74",
    chassisSheet: "Total cost",
    boards: [
      { sheet: "BOM an3010 e dsp", partNumber: "an3010_e_dsp", name: "AN3010 E DSP" },
      {
        sheet: "BOM an3011 b Control",
        partNumber: "an3011_b_control(U74)",
        name: "AN3011 Control — U74",
        note: "adds MECH-00008 LCD x1, CONS-00215 FPC x1, SWRT-00042 encoder x4",
      },
    ],
  },
];

export function specForFile(filename: string): ProductWorkbookSpec | undefined {
  return PRODUCT_WORKBOOKS.find((s) => s.match.test(filename));
}

/** One chassis line: mechanical/packaging items that live on the product, not a board. */
export interface ChassisRow {
  partNumber: string;
  name: string;
  qty: number;
  unitCost: number | null;
  stock: number | null;
  supplierNote?: string;
  value?: string;
  manufacturer?: string;
  mpn?: string;
}

function money(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
}

function intOf(v: unknown): number | null {
  const s = String(v ?? "").replace(/[,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function findCol(header: string[], ...needles: string[]): number {
  for (const n of needles) {
    const i = header.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Stable item number for a chassis row, which has none in the source:
 *   footprint holds a drawing number  -> MECH-AN4010-D
 *   name starts with a drawing code   -> MECH-AN7010-B  ("AN7010 Rev B Loom")
 *   otherwise                         -> MECH-IEC-MAINS-LEAD
 * The MECH- prefix puts them in the existing "Mechanical" category.
 */
export function chassisPartNumber(name: string, footprint?: string): string {
  const fp = (footprint ?? "").trim().toUpperCase();
  if (/^AN\d{4}-[A-Z]$/.test(fp)) return `MECH-${fp}`;

  const code = name.match(/^(AN\d{4})\b(?:.*?\bRev\s+([A-Z])\b)?/i);
  if (code) return `MECH-${code[1].toUpperCase()}${code[2] ? `-${code[2].toUpperCase()}` : ""}`;

  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `MECH-${slug}`;
}

// Rollup rows that restate a board's cost rather than naming a part.
const BOARD_ROLLUP = /^(dsp|control|main|pcb)\s*cost$/i;

/**
 * Parse the chassis rollup sheet. Column labels vary between workbooks: UR64 has no
 * "Cost Each" header and instead labels BOTH cost columns "Total Cost" (the first is
 * per-unit, the second extended), so we fall back to the first cost-ish column.
 */
export function parseChassisSheet(
  buf: Buffer | ArrayBuffer,
  sheetName: string,
  skip: string[] = [],
): { rows: ChassisRow[]; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"])
    return { rows: [], warnings: [`Chassis sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(", ")}.`] };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  const header = (aoa[0] ?? []).map((c) => clean(c).toLowerCase());
  const col = {
    qty: findCol(header, "quantity", "qty"),
    pn: findCol(header, "item number"),
    comment: findCol(header, "comment"),
    name: findCol(header, "item name", "description"),
    footprint: findCol(header, "footprint"),
    mfr: findCol(header, "manufacturer 1", "manufacturer"),
    cost: findCol(header, "cost each", "price each", "cost"),
    stock: findCol(header, "stock level", "quantity in stock", "in stock"),
    note: findCol(header, "on order", "supplier"),
  };
  if (col.name < 0) return { rows: [], warnings: [`Chassis sheet "${sheetName}" has no Item Name column.`] };

  const warnings: string[] = [];
  const skipSet = new Set(skip.map((s) => s.toLowerCase()));
  const rows: ChassisRow[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    const name = clean(raw[col.name]);
    if (!name) continue; // blank spacer / TOTAL row
    if (BOARD_ROLLUP.test(name)) continue; // "DSP Cost" / "Control Cost" — the boards themselves
    if (skipSet.has(name.toLowerCase())) {
      warnings.push(`Skipped chassis row "${name}" (configured skip).`);
      continue;
    }

    // qty 0 = listed but not fitted on this model. Kept, because the row still carries a
    // valid price/stock for a part another model does fit — it just gets no BOM line.
    const qty = col.qty >= 0 ? intOf(raw[col.qty]) ?? 0 : 1;

    const footprint = col.footprint >= 0 ? clean(raw[col.footprint]) : "";
    const partNumber = chassisPartNumber(name, footprint);
    const row: ChassisRow = {
      partNumber,
      name,
      qty,
      unitCost: col.cost >= 0 ? money(raw[col.cost]) : null,
      stock: col.stock >= 0 ? intOf(raw[col.stock]) : null,
      supplierNote: col.note >= 0 ? clean(raw[col.note]) || undefined : undefined,
      value: col.comment >= 0 ? clean(raw[col.comment]) || undefined : undefined,
      manufacturer: col.mfr >= 0 ? clean(raw[col.mfr]) || undefined : undefined,
      // The odd chassis row does carry a vendor part number in the Item Number column.
      mpn: col.pn >= 0 ? clean(raw[col.pn]) || undefined : undefined,
    };

    const at = seen.get(partNumber);
    if (at !== undefined) {
      rows[at].qty += qty;
      warnings.push(`Duplicate chassis row ${partNumber} ("${name}") — quantities summed.`);
    } else {
      seen.set(partNumber, rows.length);
      rows.push(row);
    }
  }

  return { rows, warnings };
}

export interface ProductWorkbookSummary {
  productLabel: string;
  boards: { partNumber: string; lines: number; reused: boolean; note?: string }[];
  chassisLines: number;
  chassisCreated: number;
  leafCount: number;
  warnings: string[];
}

/** Import one product workbook: its boards, its chassis parts, and the product that ties them together. */
export async function importProductWorkbook(
  spec: ProductWorkbookSpec,
  buf: Buffer,
  opts: { filename?: string; userId?: string } = {},
): Promise<ProductWorkbookSummary> {
  const filename = opts.filename ?? "(unknown)";
  const warnings: string[] = [];
  const boards: ProductWorkbookSummary["boards"] = [];
  const childQty = new Map<string, number>(); // item id -> qty on the product

  // 1. Boards — import each sheet as its own assembly, or link one that already exists.
  for (const b of spec.boards) {
    const existing = await prisma.item.findUnique({ where: { partNumber: b.partNumber } });

    if (b.reuse && existing) {
      const lines = await prisma.bomLine.count({ where: { parentItemId: existing.id } });
      childQty.set(existing.id, 1);
      boards.push({ partNumber: b.partNumber, lines, reused: true, note: b.note });
      continue;
    }
    if (b.reuse && !existing) warnings.push(`${b.partNumber} was marked reuse but does not exist — imported from "${b.sheet}".`);

    const parsed = parseWorkbookSheet(buf, b.sheet);
    warnings.push(...parsed.warnings.map((w) => `[${b.sheet}] ${w}`));
    if (!parsed.rows.length) {
      warnings.push(`Sheet "${b.sheet}" produced no parts — board ${b.partNumber} skipped.`);
      continue;
    }

    // preserveMissing: these rollup sheets omit Footprint/Manufacturer columns that the
    // Altium board exports carry, and absent must not mean "clear it".
    const s = await importBom({ partNumber: b.partNumber, name: b.name, type: "ASSEMBLY" }, parsed.rows, {
      filename: `${filename} :: ${b.sheet}`,
      userId: opts.userId,
      preserveMissing: true,
    });

    childQty.set(s.productItemId, 1);
    boards.push({ partNumber: b.partNumber, lines: s.linesUpserted, reused: false, note: b.note });
  }

  // 2. Chassis parts — created here if new (with cost + stock from the sheet), otherwise left alone.
  const chassis = parseChassisSheet(buf, spec.chassisSheet, spec.skipChassis);
  warnings.push(...chassis.warnings);
  let chassisCreated = 0;

  // One lookup for the whole sheet rather than one per row — the pooled connection is slow.
  const chassisExisting = await prisma.item.findMany({
    where: { partNumber: { in: chassis.rows.map((r) => r.partNumber) } },
    select: { id: true, partNumber: true },
  });
  const chassisById = new Map(chassisExisting.map((i) => [i.partNumber, i.id]));

  for (const c of chassis.rows) {
    let itemId = chassisById.get(c.partNumber);
    if (!itemId) {
      const created = await prisma.item.create({
        data: {
          partNumber: c.partNumber,
          type: "PART",
          name: c.name,
          value: c.value ?? null,
          manufacturer: c.manufacturer ?? null,
          mpn: c.mpn ?? null,
          category: categoryFromPartNumber(c.partNumber),
          unitCost: c.unitCost,
          // On-hand comes from the sheet below; a brand-new part has no other source for it.
          onHand: c.stock ?? 0,
          notes: c.supplierNote ? `${c.supplierNote} (from ${filename})` : null,
        },
      });
      itemId = created.id;
      chassisById.set(c.partNumber, itemId);
      chassisCreated++;

      if (c.unitCost != null) {
        await prisma.priceHistory.create({
          data: { itemId, unitCost: c.unitCost, previousCost: null, note: "BOM import", userId: opts.userId ?? null },
        });
      }
      // Booked through the ledger too, so on-hand stays explainable (sum of txns).
      if (c.stock != null && c.stock !== 0) {
        await prisma.inventoryTxn.create({
          data: { itemId, qtyDelta: c.stock, type: "COUNT", note: "Stock set from BOM", userId: opts.userId ?? null },
        });
      }
    }
    if (c.qty > 0) childQty.set(itemId, (childQty.get(itemId) ?? 0) + c.qty);
  }

  // 3. The product: boards at qty 1 + chassis at sheet quantities.
  const product = await prisma.item.upsert({
    where: { partNumber: spec.partNumber },
    create: { partNumber: spec.partNumber, name: spec.name, type: "PRODUCT" },
    update: { type: "PRODUCT" }, // keep any name it was given in the app
  });

  const priorLines = await prisma.bomLine.findMany({
    where: { parentItemId: product.id },
    select: { childItemId: true, qtyPer: true },
  });
  const priorQty = new Map(priorLines.map((l) => [l.childItemId, l.qtyPer]));
  const newLines = [...childQty].filter(([id]) => !priorQty.has(id)).map(([childItemId, qtyPer]) => ({ parentItemId: product.id, childItemId, qtyPer }));
  if (newLines.length) await prisma.bomLine.createMany({ data: newLines, skipDuplicates: true });
  for (const [childItemId, qtyPer] of childQty) {
    if (priorQty.has(childItemId) && priorQty.get(childItemId) !== qtyPer) {
      await prisma.bomLine.update({
        where: { parentItemId_childItemId: { parentItemId: product.id, childItemId } },
        data: { qtyPer },
      });
    }
  }

  const summary = await prisma.$transaction(
    async (tx) => {
      const kept = [...childQty.keys()];
      await tx.bomLine.deleteMany({
        where: { parentItemId: product.id, childItemId: { notIn: kept.length ? kept : ["__none__"] } },
      });
      await explodeProduct(product.id, tx);
      const leafCount = await tx.explodedBom.count({ where: { productItemId: product.id } });
      await tx.importBatch.create({
        data: {
          filename,
          productItemId: product.id,
          productLabel: spec.name,
          rowCount: childQty.size,
          createdCount: chassisCreated,
          updatedCount: boards.length,
          status: "SUCCESS",
          userId: opts.userId ?? null,
        },
      });
      return leafCount;
    },
    { timeout: 120000, maxWait: 20000 },
  );

  return {
    productLabel: spec.name,
    boards,
    chassisLines: chassis.rows.filter((r) => r.qty > 0).length,
    chassisCreated,
    leafCount: summary,
    warnings,
  };
}
