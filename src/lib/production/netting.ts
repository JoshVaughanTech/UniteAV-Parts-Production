import type { BomTree } from "@/lib/bom/rollup";

/**
 * Work out what a production run actually needs, netting against stock at every level.
 *
 * A run for 10 UR86 needs 10 AN3011 control boards. If 6 assembled boards are on the
 * shelf, only 4 have to be built — so only 4 boards' worth of components is required,
 * not 10. The same applies further down: a sub-assembly inside a board is netted before
 * its own children are exploded. Walking level by level is the whole point; a flat
 * product -> leaf explosion cannot express it.
 *
 * The finished products themselves are never netted. A run says "build 10", not
 * "end up holding 10", so stock of the finished product is irrelevant to it.
 *
 * Stock is a single pool shared by the whole run: two products that use the same board
 * can't both claim it. Lines are netted in the order given, so the first line gets first
 * call on scarce stock.
 */
export interface RunLineInput {
  productId: string;
  qty: number;
}

export interface NetRow {
  itemId: string;
  partNumber: string;
  name: string;
  type: string;
  /** Gross units the run consumes. */
  required: number;
  /** Covered by stock already on the shelf. */
  fromStock: number;
  /** Boards to assemble (ASSEMBLY) or units to obtain (PART). */
  toMake: number;
  /** On-hand when the run was planned. */
  onHand: number;
}

export interface RunLinePlan {
  productId: string;
  partNumber: string;
  name: string;
  qtyPlanned: number;
  /** How many of this line current stock actually covers, given the lines above it. */
  buildableNow: number;
}

export interface RunPlan {
  lines: RunLinePlan[];
  /** Boards and sub-assemblies the run consumes, deepest demand first. */
  boards: NetRow[];
  /** Purchasable parts the run consumes. */
  parts: NetRow[];
  /** Parts stock does not cover — what has to be bought. */
  shortParts: NetRow[];
  fullyCovered: boolean;
}

/** Stock pool for one netting pass. Negative on-hand counts as nothing available. */
function makePool(tree: BomTree, seed?: Map<string, number>): Map<string, number> {
  return seed ? new Map(seed) : new Map<string, number>();
}

function available(tree: BomTree, pool: Map<string, number>, itemId: string): number {
  const held = pool.get(itemId);
  if (held !== undefined) return held;
  const opening = Math.max(0, tree.item(itemId)?.onHand ?? 0);
  pool.set(itemId, opening);
  return opening;
}

/**
 * Net `qty` units of `itemId` against the pool, recursing into whatever still has to be
 * made. `agg` collects the totals; pass null to net for its effect on the pool alone.
 */
function consume(
  tree: BomTree,
  pool: Map<string, number>,
  itemId: string,
  qty: number,
  agg: Map<string, NetRow> | null,
  depth = 0,
): void {
  if (qty <= 0 || depth > 64) return; // depth guard: a cyclic BOM can't spin forever

  if (agg) {
    const item = tree.item(itemId);
    let row = agg.get(itemId);
    if (!row) {
      row = {
        itemId,
        partNumber: item?.partNumber ?? itemId,
        name: item?.name ?? "",
        type: item?.type ?? "PART",
        required: 0,
        fromStock: 0,
        toMake: 0,
        onHand: item?.onHand ?? 0,
      };
      agg.set(itemId, row);
    }
    row.required += qty;
    const drawn = Math.min(qty, available(tree, pool, itemId));
    pool.set(itemId, available(tree, pool, itemId) - drawn);
    row.fromStock += drawn;
    row.toMake += qty - drawn;
    for (const c of tree.childrenOf(itemId)) consume(tree, pool, c.childItemId, (qty - drawn) * c.qtyPer, agg, depth + 1);
    return;
  }

  const drawn = Math.min(qty, available(tree, pool, itemId));
  pool.set(itemId, available(tree, pool, itemId) - drawn);
  for (const c of tree.childrenOf(itemId)) consume(tree, pool, c.childItemId, (qty - drawn) * c.qtyPer, null, depth + 1);
}

/** Could `qty` of this product be built from `pool` without buying anything? */
function coveredBy(tree: BomTree, pool: Map<string, number>, productId: string, qty: number): boolean {
  const trial = makePool(tree, pool);
  const agg = new Map<string, NetRow>();
  for (const c of tree.childrenOf(productId)) consume(tree, trial, c.childItemId, qty * c.qtyPer, agg);
  for (const row of agg.values()) {
    if (row.type !== "ASSEMBLY" && row.toMake > 0) return false; // a part we'd have to buy
  }
  return true;
}

/** Largest k ≤ qty that current stock covers. Monotone in k, so binary search is safe. */
function buildableNow(tree: BomTree, pool: Map<string, number>, productId: string, qty: number): number {
  if (qty <= 0) return 0;
  if (coveredBy(tree, pool, productId, qty)) return qty;
  let lo = 0;
  let hi = qty;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (coveredBy(tree, pool, productId, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function planRun(tree: BomTree, inputs: RunLineInput[]): RunPlan {
  const pool = makePool(tree);
  const agg = new Map<string, NetRow>();
  const lines: RunLinePlan[] = [];

  for (const input of inputs) {
    const product = tree.item(input.productId);
    // Measured before this line consumes anything, so it reflects what the lines above
    // it have already claimed.
    const canBuild = buildableNow(tree, pool, input.productId, input.qty);
    lines.push({
      productId: input.productId,
      partNumber: product?.partNumber ?? input.productId,
      name: product?.name ?? "",
      qtyPlanned: input.qty,
      buildableNow: canBuild,
    });
    for (const c of tree.childrenOf(input.productId)) {
      consume(tree, pool, c.childItemId, input.qty * c.qtyPer, agg);
    }
  }

  const rows = [...agg.values()];
  const byNeed = (a: NetRow, b: NetRow) => b.toMake - a.toMake || a.partNumber.localeCompare(b.partNumber);
  const boards = rows.filter((r) => r.type === "ASSEMBLY").sort(byNeed);
  const parts = rows.filter((r) => r.type !== "ASSEMBLY").sort(byNeed);
  const shortParts = parts.filter((r) => r.toMake > 0);

  return { lines, boards, parts, shortParts, fullyCovered: shortParts.length === 0 };
}
