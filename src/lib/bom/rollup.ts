import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Live BOM rollup — loads every edge + item once, then answers "what does one of
 * this item consume?" for any item, at any level.
 *
 * This is deliberately NOT the ExplodedBom cache: that table only covers PRODUCTs,
 * and it goes stale whenever a BOM changes underneath it (a deleted board leaves
 * the old quantities behind). The whole tree is a few hundred edges, so walking it
 * per request costs nothing and can never disagree with the BOM on screen.
 */
export interface BomItem {
  id: string;
  partNumber: string;
  name: string;
  type: string;
  unitCost: number | null;
  onHand: number;
}

export interface BomTree {
  /** Leaf parts consumed by one unit of `itemId` -> qty. A leaf resolves to itself. */
  leavesOf(itemId: string): Map<string, number>;
  /** Parts cost to build one unit, from leaf unit costs. Unpriced parts count as 0. */
  costOf(itemId: string): number;
  item(itemId: string): BomItem | undefined;
}

export const loadBomTree = cache(async (): Promise<BomTree> => {
  const [edges, items] = await Promise.all([
    prisma.bomLine.findMany({ select: { parentItemId: true, childItemId: true, qtyPer: true } }),
    prisma.item.findMany({
      select: { id: true, partNumber: true, name: true, type: true, unitCost: true, onHand: true },
    }),
  ]);

  const childrenOf = new Map<string, { childItemId: string; qtyPer: number }[]>();
  for (const e of edges) {
    const arr = childrenOf.get(e.parentItemId);
    if (arr) arr.push(e);
    else childrenOf.set(e.parentItemId, [e]);
  }
  const byId = new Map(items.map((i) => [i.id, i]));

  const memo = new Map<string, Map<string, number>>();
  const path = new Set<string>();

  function leavesOf(itemId: string): Map<string, number> {
    // Cycle guard: truncate the branch, and don't memoize the partial answer.
    if (path.has(itemId)) return new Map();
    const hit = memo.get(itemId);
    if (hit) return hit;

    const kids = childrenOf.get(itemId);
    const out = new Map<string, number>();
    if (!kids || kids.length === 0) {
      out.set(itemId, 1); // nothing below it — it is the leaf
    } else {
      path.add(itemId);
      for (const k of kids) {
        for (const [leafId, qty] of leavesOf(k.childItemId)) {
          out.set(leafId, (out.get(leafId) ?? 0) + qty * k.qtyPer);
        }
      }
      path.delete(itemId);
    }
    memo.set(itemId, out);
    return out;
  }

  return {
    leavesOf,
    costOf(itemId) {
      let total = 0;
      for (const [leafId, qty] of leavesOf(itemId)) total += qty * (byId.get(leafId)?.unitCost ?? 0);
      return total;
    },
    item: (itemId) => byId.get(itemId),
  };
});
