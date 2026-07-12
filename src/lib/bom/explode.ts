import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Recompute the ExplodedBom cache for a product: walk the BomLine tree, multiply
 * qtyPer down each path, and sum per leaf part. Cycle-safe.
 *
 * A "leaf" is any item that has no BomLine children (i.e. a purchasable PART).
 */
export async function explodeProduct(productItemId: string, db: Db = prisma): Promise<void> {
  // Preload all BOM edges once (medium scale -> fine to hold in memory).
  const edges = await db.bomLine.findMany({
    select: { parentItemId: true, childItemId: true, qtyPer: true },
  });
  const childrenOf = new Map<string, { childItemId: string; qtyPer: number }[]>();
  for (const e of edges) {
    const arr = childrenOf.get(e.parentItemId) ?? [];
    arr.push({ childItemId: e.childItemId, qtyPer: e.qtyPer });
    childrenOf.set(e.parentItemId, arr);
  }

  const totals = new Map<string, number>();
  const path = new Set<string>();

  function walk(itemId: string, multiplier: number): void {
    const kids = childrenOf.get(itemId);
    if (!kids || kids.length === 0) {
      // Leaf part — accumulate (but don't count the product itself as its own leaf).
      if (itemId !== productItemId) totals.set(itemId, (totals.get(itemId) ?? 0) + multiplier);
      return;
    }
    if (path.has(itemId)) {
      throw new Error(`Circular BOM reference detected at item ${itemId}`);
    }
    path.add(itemId);
    for (const k of kids) walk(k.childItemId, multiplier * k.qtyPer);
    path.delete(itemId);
  }

  walk(productItemId, 1);

  await db.explodedBom.deleteMany({ where: { productItemId } });
  if (totals.size > 0) {
    await db.explodedBom.createMany({
      data: [...totals.entries()].map(([leafPartId, totalQtyPer]) => ({
        productItemId,
        leafPartId,
        totalQtyPer,
      })),
    });
  }
}

/** Recompute exploded BOMs for every product. */
export async function explodeAllProducts(db: Db = prisma): Promise<void> {
  const products = await db.item.findMany({ where: { type: "PRODUCT" }, select: { id: true } });
  for (const p of products) await explodeProduct(p.id, db);
}
