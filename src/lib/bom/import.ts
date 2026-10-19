import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { explodeProduct } from "@/lib/bom/explode";
import type { BomRow } from "@/lib/bom/parse";

export interface ProductMeta {
  partNumber: string; // product's own item number, e.g. "an3140_c_base(AMP)"
  name: string; // human label, e.g. "Base Board — AMP"
  /** What the imported item IS. Defaults to PRODUCT for a new item; an existing
   *  ASSEMBLY is never demoted to PRODUCT, which would unfit it from its product. */
  type?: "PRODUCT" | "ASSEMBLY";
  /** Board revision. Unlike the name, this is typed by whoever ran the import rather
   *  than derived, so it IS written on re-import — leave undefined to keep what's there. */
  rev?: string | null;
}

export interface ImportSummary {
  productItemId: string;
  productLabel: string;
  partsCreated: number;
  partsUpdated: number;
  linesUpserted: number;
  linesRemoved: number;
  leafCount: number;
}

/**
 * Drop keys that would overwrite existing data with a blank. Used for sheets that omit
 * columns other sheets carry (e.g. a cost rollup with no Footprint or Manufacturer
 * column) — absent ≠ "clear it". `name` falls back to the part number when the sheet has
 * no name column, so that case is dropped too.
 */
function omitBlanks(descriptive: Record<string, unknown>, partNumber: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(descriptive)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "name" && v === partNumber) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Import one BOM: upsert the product, upsert each part (by Item Number, shared across
 * products), (re)build its BOM lines, and recompute the exploded cache.
 *
 * On re-import, only BOM-sourced descriptive fields are refreshed — user-managed fields
 * (onHand, supplier, cost, lead time, safety stock, pack qty) are preserved.
 *
 * `preserveMissing` additionally keeps existing descriptive values when the sheet has no
 * column for them, instead of nulling them out.
 */
export async function importBom(
  meta: ProductMeta,
  rows: BomRow[],
  opts: { filename?: string; userId?: string; preserveMissing?: boolean } = {},
): Promise<ImportSummary> {
  // 1. Product item (idempotent). Re-importing a board must not demote it from
  //    ASSEMBLY back to PRODUCT — that silently unfits it from the product it builds.
  const prior = await prisma.item.findUnique({ where: { partNumber: meta.partNumber }, select: { type: true } });
  const type = meta.type ?? (prior?.type === "ASSEMBLY" ? "ASSEMBLY" : "PRODUCT");
  // The name is only a seed default, derived from a filename or a script constant. Once
  // the item exists its label belongs to whoever renamed it, so re-importing never
  // overwrites it — only the structure below is refreshed.
  const product = await prisma.item.upsert({
    where: { partNumber: meta.partNumber },
    create: { partNumber: meta.partNumber, name: meta.name, type, rev: meta.rev ?? null },
    update: { type, ...(meta.rev !== undefined ? { rev: meta.rev } : {}) },
  });

  // 2. Part sync, in BULK and OUTSIDE a transaction: every step is idempotent, so a slow
  //    or dropped connection can't expire a long-held interactive transaction. Reads and
  //    inserts are batched, and only genuinely-changed rows are written — a 100-part board
  //    used to cost ~300 sequential round trips, which a pooled connection can drop
  //    halfway through.
  const partNumbers = [...new Set(rows.map((r) => r.partNumber))];
  const existingItems = await prisma.item.findMany({ where: { partNumber: { in: partNumbers } } });
  const existingByPn = new Map(existingItems.map((i) => [i.partNumber, i]));

  const toCreate: { partNumber: string; type: string; [k: string]: unknown }[] = [];
  const toUpdate: { id: string; data: Record<string, unknown> }[] = [];

  for (const row of rows) {
    const descriptive: Record<string, unknown> = {
      name: row.name || row.partNumber,
      value: row.value ?? null,
      footprint: row.footprint ?? null,
      manufacturer: row.manufacturer ?? null,
      mpn: row.mpn ?? null,
      category: categoryFromPartNumber(row.partNumber),
    };

    const existing = existingByPn.get(row.partNumber);
    if (!existing) {
      toCreate.push({ partNumber: row.partNumber, type: "PART", ...descriptive });
      continue;
    }
    // Preserve PRODUCT/ASSEMBLY type if the part is used as a sub-assembly elsewhere.
    const data = opts.preserveMissing ? omitBlanks(descriptive, row.partNumber) : descriptive;
    const changed = Object.entries(data).filter(([k, v]) => (existing as unknown as Record<string, unknown>)[k] !== v);
    if (changed.length) toUpdate.push({ id: existing.id, data: Object.fromEntries(changed) });
  }

  const partsCreated = toCreate.length;
  const partsUpdated = rows.length - partsCreated;

  if (toCreate.length) {
    await prisma.item.createMany({ data: toCreate as never, skipDuplicates: true });
    const created = await prisma.item.findMany({
      where: { partNumber: { in: toCreate.map((c) => c.partNumber) } },
      select: { id: true, partNumber: true },
    });
    for (const c of created) existingByPn.set(c.partNumber, c as never);
  }
  for (const u of toUpdate) await prisma.item.update({ where: { id: u.id }, data: u.data });

  // 3. BOM lines, also batched: insert the new edges, touch only the quantities that moved.
  const idOf = (pn: string) => existingByPn.get(pn)?.id;
  const keptChildIds = partNumbers.map(idOf).filter((id): id is string => Boolean(id));
  const priorLines = await prisma.bomLine.findMany({
    where: { parentItemId: product.id },
    select: { childItemId: true, qtyPer: true },
  });
  const priorQty = new Map(priorLines.map((l) => [l.childItemId, l.qtyPer]));

  const linesToCreate: { parentItemId: string; childItemId: string; qtyPer: number }[] = [];
  const linesToUpdate: { childItemId: string; qtyPer: number }[] = [];
  for (const row of rows) {
    const childItemId = idOf(row.partNumber);
    if (!childItemId) continue;
    if (!priorQty.has(childItemId)) linesToCreate.push({ parentItemId: product.id, childItemId, qtyPer: row.qtyPer });
    else if (priorQty.get(childItemId) !== row.qtyPer) linesToUpdate.push({ childItemId, qtyPer: row.qtyPer });
  }
  if (linesToCreate.length) await prisma.bomLine.createMany({ data: linesToCreate, skipDuplicates: true });
  for (const l of linesToUpdate) {
    await prisma.bomLine.update({
      where: { parentItemId_childItemId: { parentItemId: product.id, childItemId: l.childItemId } },
      data: { qtyPer: l.qtyPer },
    });
  }
  const linesUpserted = rows.length;

  // 3. Short transaction: prune stale lines, rebuild the exploded cache, record the batch.
  const summary = await prisma.$transaction(
    async (tx) => {
      const removed = await tx.bomLine.deleteMany({
        where: { parentItemId: product.id, childItemId: { notIn: keptChildIds.length ? keptChildIds : ["__none__"] } },
      });
      await explodeProduct(product.id, tx);
      const leafCount = await tx.explodedBom.count({ where: { productItemId: product.id } });
      // The cache is keyed by product. A board's rows would linger as a second, stale
      // answer for an item whose parent product already covers it.
      if (type !== "PRODUCT") await tx.explodedBom.deleteMany({ where: { productItemId: product.id } });
      await tx.importBatch.create({
        data: {
          filename: opts.filename ?? "(unknown)",
          productItemId: product.id,
          productLabel: meta.name,
          rowCount: rows.length,
          createdCount: partsCreated,
          updatedCount: partsUpdated,
          status: "SUCCESS",
          userId: opts.userId ?? null,
        },
      });
      return {
        productItemId: product.id,
        productLabel: meta.name,
        partsCreated,
        partsUpdated,
        linesUpserted,
        linesRemoved: removed.count,
        leafCount,
      } satisfies ImportSummary;
    },
    { timeout: 120000, maxWait: 20000 },
  );

  return summary;
}

/**
 * Best-effort product metadata from a Unite AV BOM filename, e.g.
 *   "BOM Purchasing Amp-an3140_c_base(BASE AMP).xlsx" -> { partNumber: "an3140_c_base(AMP)", name: "Base Board — AMP" }
 * Falls back to the bare filename when the pattern isn't recognized.
 */
export function productMetaFromFilename(filename: string): ProductMeta {
  const base = filename.replace(/\.[^.]+$/, "");
  // Board code like an3140_c_base or an3130_a_module.
  const codeMatch = base.match(/(an\d{4}_[a-z]_\w+)/i);
  // Parenthetical variant/label, e.g. (BASE AMP), (PRODUCTION).
  const parenMatch = base.match(/\(([^)]+)\)/);
  const code = codeMatch ? codeMatch[1].toLowerCase() : base;
  const label = parenMatch ? parenMatch[1].trim() : "";

  let variant = "";
  if (/amp/i.test(label) || /amp/i.test(base)) variant = "AMP";
  else if (/dsp/i.test(label) || /dsp/i.test(base)) variant = "DSP";
  else if (/module/i.test(base)) variant = "MODULE";

  const partNumber = variant ? `${code}(${variant})` : code;

  const pretty = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const name = label ? `${pretty(code)} — ${label.replace(/\bBASE\b/i, "").trim() || label}` : pretty(code);

  return { partNumber, name };
}
