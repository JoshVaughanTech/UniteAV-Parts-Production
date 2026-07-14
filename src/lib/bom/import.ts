import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { explodeProduct } from "@/lib/bom/explode";
import type { BomRow } from "@/lib/bom/parse";

export interface ProductMeta {
  partNumber: string; // product's own item number, e.g. "an3140_c_base(AMP)"
  name: string; // human label, e.g. "Base Board — AMP"
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
 * Import one BOM: upsert the product, upsert each part (by Item Number, shared across
 * products), (re)build its BOM lines, and recompute the exploded cache.
 *
 * On re-import, only BOM-sourced descriptive fields are refreshed — user-managed fields
 * (onHand, supplier, cost, lead time, safety stock, pack qty) are preserved.
 */
export async function importBom(
  meta: ProductMeta,
  rows: BomRow[],
  opts: { filename?: string; userId?: string } = {},
): Promise<ImportSummary> {
  let partsCreated = 0;
  let partsUpdated = 0;
  let linesUpserted = 0;

  // 1. Product item (idempotent).
  const product = await prisma.item.upsert({
    where: { partNumber: meta.partNumber },
    create: { partNumber: meta.partNumber, name: meta.name, type: "PRODUCT" },
    update: { name: meta.name, type: "PRODUCT" },
  });

  // 2. Per-part upserts run OUTSIDE a transaction — each op is idempotent, so a slow
  //    or dropped connection can't expire a long-held interactive transaction.
  const keptChildIds: string[] = [];
  for (const row of rows) {
    const existing = await prisma.item.findUnique({ where: { partNumber: row.partNumber } });
    const descriptive = {
      name: row.name || row.partNumber,
      value: row.value ?? null,
      footprint: row.footprint ?? null,
      manufacturer: row.manufacturer ?? null,
      mpn: row.mpn ?? null,
      category: categoryFromPartNumber(row.partNumber),
    };

    let child;
    if (existing) {
      // Preserve PRODUCT/ASSEMBLY type if the part is used as a sub-assembly elsewhere.
      child = await prisma.item.update({ where: { id: existing.id }, data: descriptive });
      partsUpdated++;
    } else {
      child = await prisma.item.create({ data: { partNumber: row.partNumber, type: "PART", ...descriptive } });
      partsCreated++;
    }
    keptChildIds.push(child.id);

    await prisma.bomLine.upsert({
      where: { parentItemId_childItemId: { parentItemId: product.id, childItemId: child.id } },
      create: { parentItemId: product.id, childItemId: child.id, qtyPer: row.qtyPer },
      update: { qtyPer: row.qtyPer },
    });
    linesUpserted++;
  }

  // 3. Short transaction: prune stale lines, rebuild the exploded cache, record the batch.
  const summary = await prisma.$transaction(
    async (tx) => {
      const removed = await tx.bomLine.deleteMany({
        where: { parentItemId: product.id, childItemId: { notIn: keptChildIds.length ? keptChildIds : ["__none__"] } },
      });
      await explodeProduct(product.id, tx);
      const leafCount = await tx.explodedBom.count({ where: { productItemId: product.id } });
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
