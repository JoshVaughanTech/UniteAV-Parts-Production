"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { applyTxn } from "@/lib/inventory";
import { createPartRecord } from "@/lib/part-create";
import type { ActionResult } from "@/lib/actions";

export type StocktakeResult = ActionResult;

function revalidateStocktake(id?: string) {
  if (id) revalidatePath(`/count/${id}`);
  for (const p of ["/count", "/parts", "/to-order", "/products", "/"]) revalidatePath(p);
}

/** ST-0001, read off the highest in use so abandoning one can't recycle its number. */
async function nextNumber(): Promise<string> {
  const last = await prisma.stocktake.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? Number(last.number.slice(3)) || 0 : 0;
  return `ST-${(n + 1).toString().padStart(4, "0")}`;
}

/**
 * Open a stocktake. Only one at a time: two open counts could each record their own
 * `expected` for the same item and then both post a delta, moving the stock twice.
 */
export async function startStocktake(_prev: StocktakeResult | null, formData: FormData): Promise<StocktakeResult> {
  try {
    const user = await requireRole("OPERATOR");
    const open = await prisma.stocktake.findFirst({ where: { status: "OPEN" }, select: { number: true } });
    if (open)
      return { ok: false, error: `${open.number} is still open — commit or abandon it before starting another.` };

    const category = String(formData.get("category") ?? "").trim() || null;
    const st = await prisma.stocktake.create({
      data: {
        number: await nextNumber(),
        status: "OPEN",
        category,
        note: String(formData.get("note") ?? "").trim() || null,
        userId: user.id,
      },
    });
    revalidateStocktake();
    redirect(`/count/${st.id}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT"))
      throw e;
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the stocktake." };
  }
}

/**
 * `set` is the count of everything on the shelf. `add` is more of the same part found
 * somewhere else — a second box in another bay, a bag on the bench — and tops up the
 * running total instead of replacing it.
 */
export type CountMode = "set" | "add";

export interface CountResult {
  ok: true;
  itemId: string;
  partNumber: string;
  /** The running total after this count. */
  counted: number;
  expected: number;
  variance: number;
  counts: number;
  /** What this call put on, which is the whole count for `set` and the top-up for `add`. */
  added: number;
  mode: CountMode;
}

/**
 * Record a count. Stock does not move — `expected` is stamped with the on-hand at this
 * moment so the variance stays meaningful however long the count takes.
 *
 * Counting the same item twice is two different intentions, so the caller says which:
 * `set` replaces the entry, for a recount of the same shelf, and re-stamps `expected`
 * because it is a fresh observation; `add` tops the total up for stock found elsewhere,
 * and deliberately keeps the original `expected`. Re-stamping on a top-up would move the
 * baseline under the operator mid-count — the first 100 would be measured against one
 * on-hand figure and the next 40 against another, and the variance would mean nothing.
 */
export async function recordCount(
  stocktakeId: string,
  itemId: string,
  counted: number,
  mode: CountMode = "set",
): Promise<CountResult | { ok: false; error: string }> {
  try {
    const user = await requireRole("OPERATOR");
    if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: "Enter a count of 0 or more." };
    if (mode === "add" && counted === 0) return { ok: false, error: "Enter how many more you found." };

    const [st, item, existing] = await Promise.all([
      prisma.stocktake.findUnique({ where: { id: stocktakeId }, select: { status: true } }),
      prisma.item.findUnique({ where: { id: itemId }, select: { partNumber: true, onHand: true, active: true } }),
      prisma.stocktakeEntry.findUnique({
        where: { stocktakeId_itemId: { stocktakeId, itemId } },
        select: { counted: true, expected: true },
      }),
    ]);
    if (!st) return { ok: false, error: "Stocktake not found." };
    if (st.status !== "OPEN") return { ok: false, error: "This stocktake is closed." };
    if (!item) return { ok: false, error: "Item not found." };
    if (!item.active) return { ok: false, error: `${item.partNumber} is archived.` };

    // Adding to nothing is just counting. Nobody should have to notice the difference.
    const topUp = mode === "add" && existing != null;
    const total = topUp ? existing.counted + counted : counted;
    const expected = topUp ? existing.expected : item.onHand;

    await prisma.stocktakeEntry.upsert({
      where: { stocktakeId_itemId: { stocktakeId, itemId } },
      create: { stocktakeId, itemId, counted: total, expected, userId: user.id },
      update: { counted: total, expected, countedAt: new Date(), userId: user.id },
    });
    const counts = await prisma.stocktakeEntry.count({ where: { stocktakeId } });

    revalidateStocktake(stocktakeId);
    return {
      ok: true,
      itemId,
      partNumber: item.partNumber,
      counted: total,
      expected,
      variance: total - expected,
      counts,
      added: counted,
      mode: topUp ? "add" : "set",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the count." };
  }
}

/** Drop a count from an open stocktake — a wrong part chosen, or a shelf to be recounted later. */
export async function removeCount(entryId: string): Promise<StocktakeResult> {
  try {
    await requireRole("OPERATOR");
    const entry = await prisma.stocktakeEntry.findUnique({
      where: { id: entryId },
      include: { stocktake: { select: { status: true } }, item: { select: { partNumber: true } } },
    });
    if (!entry) return { ok: false, error: "Count not found." };
    if (entry.stocktake.status !== "OPEN") return { ok: false, error: "This stocktake is closed." };

    await prisma.stocktakeEntry.delete({ where: { id: entryId } });
    revalidateStocktake(entry.stocktakeId);
    return { ok: true, message: `Removed the count for ${entry.item.partNumber}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove the count." };
  }
}

/** A part created mid-count, in the shape the counting screen needs to carry on using it. */
export interface CountedPart {
  id: string;
  partNumber: string;
  name: string;
  mpn: string | null;
  onHand: number;
}

export interface NewPartCountInput {
  partNumber: string;
  name: string;
  value?: string | null;
  footprint?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
}

/**
 * Create a part and count it, without leaving the stocktake.
 *
 * A count turns up stock the catalogue has never heard of — a bag nobody logged, a part
 * bought outside the system. Making the operator abandon the count, find the Parts page,
 * create the part and come back is how that stock ends up not counted at all, so it is
 * done here.
 *
 * An Operator may do this, where creating a part from the Parts page needs a Manager. The
 * fields that carry money and ordering consequences — cost, supplier, lead time, safety
 * stock, pack size — are not on this form and stay at their defaults, so what an operator
 * can make is a bare part with zero stock and a count attached. The count itself still
 * needs a Manager to commit, which is where the adjustment is actually agreed to.
 */
export async function addPartAndCount(
  stocktakeId: string,
  part: NewPartCountInput,
  counted: number,
): Promise<(CountResult & { part: CountedPart }) | { ok: false; error: string }> {
  try {
    const user = await requireRole("OPERATOR");
    if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: "Enter a count of 0 or more." };

    const st = await prisma.stocktake.findUnique({ where: { id: stocktakeId }, select: { status: true } });
    if (!st) return { ok: false, error: "Stocktake not found." };
    if (st.status !== "OPEN") return { ok: false, error: "This stocktake is closed." };

    const created = await createPartRecord(
      {
        partNumber: part.partNumber,
        name: part.name,
        value: part.value ?? null,
        footprint: part.footprint ?? null,
        manufacturer: part.manufacturer ?? null,
        mpn: part.mpn ?? null,
        notes: "Found during a stocktake.",
      },
      user.id,
    );
    if (!created.ok) return { ok: false, error: `${created.error} Search for it instead of adding it again.` };

    // On-hand starts at zero, so expected is zero and the whole count posts as found
    // stock when the stocktake commits — which is exactly what it is.
    const res = await recordCount(stocktakeId, created.id, counted, "set");
    if (!res.ok) return res;

    revalidatePath("/parts");
    return {
      ...res,
      part: { id: created.id, partNumber: created.partNumber, name: part.name.trim(), mpn: part.mpn ?? null, onHand: 0 },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that part." };
  }
}

/**
 * Post the stocktake.
 *
 * Each entry applies `counted - expected` as a COUNT movement, not an absolute set. That
 * matters when stock legitimately moved while the count was in progress: an item counted
 * at 100 against an expected 100, which a build then drew 10 from, ends at 90 rather than
 * being rewound to 100. The delta corrects the discrepancy the count found and leaves
 * real movements alone.
 */
export async function commitStocktake(_prev: StocktakeResult | null, formData: FormData): Promise<StocktakeResult> {
  try {
    const user = await requireRole("MANAGER");
    const id = String(formData.get("stocktakeId") ?? "");
    const st = await prisma.stocktake.findUnique({
      where: { id },
      include: { entries: { include: { item: { select: { partNumber: true } } } } },
    });
    if (!st) return { ok: false, error: "Stocktake not found." };
    if (st.status !== "OPEN") return { ok: false, error: `${st.number} is already ${st.status.toLowerCase()}.` };
    if (st.entries.length === 0) return { ok: false, error: "Nothing counted yet." };

    const moving = st.entries.filter((e) => e.counted !== e.expected);

    await prisma.$transaction(
      async (tx) => {
        for (const e of moving) {
          await applyTxn(tx, {
            itemId: e.itemId,
            qtyDelta: e.counted - e.expected,
            type: "COUNT",
            refType: "Stocktake",
            refId: st.id,
            note: `${st.number}: counted ${e.counted} against ${e.expected}`,
            userId: user.id,
          });
        }
        await tx.stocktake.update({
          where: { id: st.id },
          data: { status: "COMMITTED", committedAt: new Date() },
        });
      },
      { timeout: 120000, maxWait: 20000 },
    );

    revalidateStocktake(id);
    const matched = st.entries.length - moving.length;
    return {
      ok: true,
      message:
        `${st.number} committed: ${moving.length} item(s) adjusted` +
        (matched > 0 ? `, ${matched} already matched` : "") +
        ".",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not commit the stocktake." };
  }
}

/** Close a stocktake without posting anything. Its counts are kept as a record. */
export async function abandonStocktake(_prev: StocktakeResult | null, formData: FormData): Promise<StocktakeResult> {
  try {
    await requireRole("OPERATOR");
    const id = String(formData.get("stocktakeId") ?? "");
    const st = await prisma.stocktake.findUnique({ where: { id }, select: { number: true, status: true } });
    if (!st) return { ok: false, error: "Stocktake not found." };
    if (st.status !== "OPEN") return { ok: false, error: `${st.number} is already ${st.status.toLowerCase()}.` };

    await prisma.stocktake.update({ where: { id }, data: { status: "ABANDONED" } });
    revalidateStocktake(id);
    return { ok: true, message: `${st.number} abandoned — no stock was changed.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not abandon the stocktake." };
  }
}
