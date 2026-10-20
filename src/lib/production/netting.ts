import type { BomTree } from "@/lib/bom/rollup";

/**
 * What a production run needs, and how much of it stock already covers.
 *
 * The rule is one sentence: a run requires everything one level below the items on it, and
 * an assembly it meets there is required AS A WHOLE UNIT, drawn from stock and never
 * exploded.
 *
 * That is what keeps the two run kinds honest about each other:
 *
 *   An SMD run's lines are boards, so it requires their components — that run is where a
 *   board's parts get consumed, and its output is board stock.
 *
 *   A finished build's lines are products, so it requires their boards and their chassis,
 *   looms, screws and packaging. The boards come off the shelf. Being short of boards is a
 *   shortage of BOARDS — you answer it with an SMD run, not by buying their resistors a
 *   second time. Those resistors were already consumed when the boards were built.
 *
 * Exploding a short board into its parts, which an earlier version did, double-counts: it
 * bills the components once to the SMD run that built the board and again to the finished
 * build that fitted it.
 *
 * Stock is a single pool shared by the whole run, so two products cannot both claim the
 * same board. Lines are netted in order, so the first gets first call on scarce stock.
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
  /** Not covered. Parts to buy; boards to build with an SMD run. */
  short: number;
  /** On-hand when the run was planned. */
  onHand: number;
}

export interface RunLinePlan {
  productId: string;
  partNumber: string;
  name: string;
  qtyPlanned: number;
  /** How many of this line current stock covers, given the lines above it. */
  buildableNow: number;
}

export interface RunPlan {
  lines: RunLinePlan[];
  /** Assemblies the run consumes, drawn from board stock. */
  boards: NetRow[];
  /** Purchasable parts the run consumes. */
  parts: NetRow[];
  /** Parts stock doesn't cover — buy these. */
  shortParts: NetRow[];
  /** Boards stock doesn't cover — build these with an SMD run. */
  shortBoards: NetRow[];
  fullyCovered: boolean;
}

/** Remaining stock for one netting pass. A negative balance counts as nothing available. */
function available(tree: BomTree, pool: Map<string, number>, itemId: string): number {
  const held = pool.get(itemId);
  if (held !== undefined) return held;
  const opening = Math.max(0, tree.item(itemId)?.onHand ?? 0);
  pool.set(itemId, opening);
  return opening;
}

/**
 * Book one requirement against the pool. Terminal by design — an assembly is not walked
 * into, because whatever is inside it was consumed by the run that built it.
 */
function requireUnits(
  tree: BomTree,
  pool: Map<string, number>,
  itemId: string,
  qty: number,
  agg: Map<string, NetRow> | null,
): void {
  if (qty <= 0) return;

  const have = available(tree, pool, itemId);
  const drawn = Math.min(qty, have);
  pool.set(itemId, have - drawn);
  if (!agg) return;

  let row = agg.get(itemId);
  if (!row) {
    const item = tree.item(itemId);
    row = {
      itemId,
      partNumber: item?.partNumber ?? itemId,
      name: item?.name ?? "",
      type: item?.type ?? "PART",
      required: 0,
      fromStock: 0,
      short: 0,
      onHand: item?.onHand ?? 0,
    };
    agg.set(itemId, row);
  }
  row.required += qty;
  row.fromStock += drawn;
  row.short += qty - drawn;
}

/** Book everything one level below `itemId`, for `qty` of it. */
function requireFor(
  tree: BomTree,
  pool: Map<string, number>,
  itemId: string,
  qty: number,
  agg: Map<string, NetRow> | null,
): void {
  for (const c of tree.childrenOf(itemId)) requireUnits(tree, pool, c.childItemId, qty * c.qtyPer, agg);
}

/** Could `qty` of this item be built from `pool` with nothing left short? */
function coveredBy(tree: BomTree, pool: Map<string, number>, itemId: string, qty: number): boolean {
  const trial = new Map(pool);
  const agg = new Map<string, NetRow>();
  requireFor(tree, trial, itemId, qty, agg);
  for (const row of agg.values()) if (row.short > 0) return false;
  return true;
}

/** Largest k ≤ qty that current stock covers. Monotone in k, so binary search is safe. */
function buildableNow(tree: BomTree, pool: Map<string, number>, itemId: string, qty: number): number {
  if (qty <= 0) return 0;
  if (coveredBy(tree, pool, itemId, qty)) return qty;
  let lo = 0;
  let hi = qty;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (coveredBy(tree, pool, itemId, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function planRun(tree: BomTree, inputs: RunLineInput[]): RunPlan {
  const pool = new Map<string, number>();
  const agg = new Map<string, NetRow>();
  const lines: RunLinePlan[] = [];

  for (const input of inputs) {
    const item = tree.item(input.productId);
    // Measured before this line consumes anything, so it reflects what the lines above
    // it have already claimed.
    const canBuild = buildableNow(tree, pool, input.productId, input.qty);
    lines.push({
      productId: input.productId,
      partNumber: item?.partNumber ?? input.productId,
      name: item?.name ?? "",
      qtyPlanned: input.qty,
      buildableNow: canBuild,
    });
    requireFor(tree, pool, input.productId, input.qty, agg);
  }

  const rows = [...agg.values()];
  const byNeed = (a: NetRow, b: NetRow) => b.short - a.short || a.partNumber.localeCompare(b.partNumber);
  const boards = rows.filter((r) => r.type === "ASSEMBLY").sort(byNeed);
  const parts = rows.filter((r) => r.type !== "ASSEMBLY").sort(byNeed);
  const shortParts = parts.filter((r) => r.short > 0);
  const shortBoards = boards.filter((r) => r.short > 0);

  return {
    lines,
    boards,
    parts,
    shortParts,
    shortBoards,
    fullyCovered: shortParts.length === 0 && shortBoards.length === 0,
  };
}
