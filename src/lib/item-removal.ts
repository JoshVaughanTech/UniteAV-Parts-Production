import { prisma } from "@/lib/prisma";
import { explodeProduct } from "@/lib/bom/explode";

/**
 * Removing an item is either a hard delete or an archive, decided by what history it
 * carries. A stock ledger, a price trail and a build log can't be reconstructed, so an
 * item that has any of them is archived instead of destroyed: `Item.active` goes false,
 * it drops out of every list and picker, and its history stays queryable.
 *
 * Either way the item leaves the active BOM structure — its lines are removed and every
 * product above it is re-exploded. Restoring an archived item returns it to the catalogue,
 * NOT to the BOMs it used to sit on; those have to be re-added deliberately.
 *
 * This module is the mechanism only. Permission checks and cache revalidation live in
 * src/lib/item-actions.ts, which is what the UI calls.
 */
export type RemovalVerdict = "DELETE" | "ARCHIVE" | "BLOCKED";

export interface RemovalImpact {
  id: string;
  partNumber: string;
  name: string;
  type: string;
  active: boolean;
  verdict: RemovalVerdict;
  /** Set when verdict is BLOCKED — what has to be undone first. */
  blockedReason?: string;
  /** History that forces an archive rather than a delete, in plain words. */
  preserves: string[];
  onHand: number;
  stockValue: number;
  /** BOM lines that disappear: the parents that currently use this item. */
  usedBy: { partNumber: string; name: string; type: string }[];
  /** Products whose part requirements change as a result. */
  affectedProducts: { id: string; name: string }[];
  /** This item's own BOM lines (a board's or product's children). */
  ownLines: number;
}

/** Every PRODUCT above `itemId` in the BOM tree — the ones whose explosion has to change. */
export async function productsAbove(itemId: string): Promise<{ id: string; name: string }[]> {
  const edges = await prisma.bomLine.findMany({ select: { parentItemId: true, childItemId: true } });
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) {
    const arr = parentsOf.get(e.childItemId);
    if (arr) arr.push(e.parentItemId);
    else parentsOf.set(e.childItemId, [e.parentItemId]);
  }

  const seen = new Set<string>();
  const queue = [itemId];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const parent of parentsOf.get(cur) ?? []) {
      if (seen.has(parent)) continue; // also the cycle guard
      seen.add(parent);
      queue.push(parent);
    }
  }
  if (seen.size === 0) return [];
  return prisma.item.findMany({
    where: { id: { in: [...seen] }, type: "PRODUCT" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** What would happen if this item were removed. Read-only. */
export async function assessRemoval(itemId: string): Promise<RemovalImpact | null> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      bomChildren: {
        include: { parent: { select: { partNumber: true, name: true, type: true } } },
        orderBy: { parent: { name: "asc" } },
      },
      poLines: { include: { purchaseOrder: { select: { poNumber: true, status: true } } } },
      _count: { select: { bomParents: true, invTxns: true, priceHistory: true, productionLogs: true } },
    },
  });
  if (!item) return null;

  const openPos = [
    ...new Set(
      item.poLines
        .filter((l) => ["DRAFT", "ORDERED", "PARTIAL"].includes(l.purchaseOrder.status))
        .map((l) => l.purchaseOrder.poNumber),
    ),
  ];
  const closedPoLines = item.poLines.filter(
    (l) => !["DRAFT", "ORDERED", "PARTIAL"].includes(l.purchaseOrder.status),
  ).length;

  // A purchase-order line has no cascade rule, so the row itself pins the item: anything
  // that has ever been ordered can only be archived, never hard-deleted.
  const preserves: string[] = [];
  if (item._count.invTxns > 0) preserves.push(`${item._count.invTxns} stock movement(s)`);
  if (item._count.priceHistory > 0) preserves.push(`${item._count.priceHistory} price change(s)`);
  if (item._count.productionLogs > 0) preserves.push(`${item._count.productionLogs} production log(s)`);
  if (closedPoLines > 0) preserves.push(`${closedPoLines} closed purchase-order line(s)`);

  return {
    id: item.id,
    partNumber: item.partNumber,
    name: item.name,
    type: item.type,
    active: item.active,
    verdict: openPos.length > 0 ? "BLOCKED" : preserves.length > 0 ? "ARCHIVE" : "DELETE",
    blockedReason:
      openPos.length > 0
        ? `On open purchase order ${openPos.join(", ")} — remove the line from that PO first.`
        : undefined,
    preserves,
    onHand: item.onHand,
    stockValue: item.onHand * (item.unitCost ?? 0),
    usedBy: item.bomChildren.map((l) => l.parent),
    affectedProducts: await productsAbove(itemId),
    ownLines: item._count.bomParents,
  };
}

export interface RemovalResult {
  verdict: RemovalVerdict;
  partNumber: string;
  detachedFrom: number;
  rebuilt: string[];
  preserved: string[];
}

/** Delete or archive an item, then rebuild the products that depended on it. */
export async function applyRemoval(itemId: string): Promise<RemovalResult> {
  const impact = await assessRemoval(itemId);
  if (!impact) throw new Error("Item not found.");
  if (impact.verdict === "BLOCKED") throw new Error(impact.blockedReason ?? "Cannot remove this item.");

  await prisma.$transaction(
    async (tx) => {
      // Leave the active structure either way — both sides of the tree.
      await tx.bomLine.deleteMany({ where: { OR: [{ parentItemId: itemId }, { childItemId: itemId }] } });
      if (impact.verdict === "DELETE") {
        await tx.item.delete({ where: { id: itemId } }); // cascades the rest
      } else {
        await tx.explodedBom.deleteMany({ where: { OR: [{ productItemId: itemId }, { leafPartId: itemId }] } });
        await tx.item.update({ where: { id: itemId }, data: { active: false } });
      }
    },
    { timeout: 60000, maxWait: 20000 },
  );

  // Requirements changed for everything above it.
  for (const p of impact.affectedProducts) await explodeProduct(p.id);

  return {
    verdict: impact.verdict,
    partNumber: impact.partNumber,
    detachedFrom: impact.usedBy.length,
    rebuilt: impact.affectedProducts.map((p) => p.name),
    preserved: impact.preserves,
  };
}
