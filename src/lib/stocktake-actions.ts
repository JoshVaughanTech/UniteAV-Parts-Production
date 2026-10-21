"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { applyTxn } from "@/lib/inventory";
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

export interface CountResult {
  ok: true;
  itemId: string;
  partNumber: string;
  counted: number;
  expected: number;
  variance: number;
  counts: number;
}

/**
 * Record a count. Stock does not move — `expected` is stamped with the on-hand at this
 * moment so the variance stays meaningful however long the count takes. Counting the same
 * item again replaces the entry rather than adding a second.
 */
export async function recordCount(
  stocktakeId: string,
  itemId: string,
  counted: number,
): Promise<CountResult | { ok: false; error: string }> {
  try {
    const user = await requireRole("OPERATOR");
    if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: "Enter a count of 0 or more." };

    const [st, item] = await Promise.all([
      prisma.stocktake.findUnique({ where: { id: stocktakeId }, select: { status: true } }),
      prisma.item.findUnique({ where: { id: itemId }, select: { partNumber: true, onHand: true, active: true } }),
    ]);
    if (!st) return { ok: false, error: "Stocktake not found." };
    if (st.status !== "OPEN") return { ok: false, error: "This stocktake is closed." };
    if (!item) return { ok: false, error: "Item not found." };
    if (!item.active) return { ok: false, error: `${item.partNumber} is archived.` };

    await prisma.stocktakeEntry.upsert({
      where: { stocktakeId_itemId: { stocktakeId, itemId } },
      create: { stocktakeId, itemId, counted, expected: item.onHand, userId: user.id },
      // A recount re-stamps expected too — it is a fresh observation.
      update: { counted, expected: item.onHand, countedAt: new Date(), userId: user.id },
    });
    const counts = await prisma.stocktakeEntry.count({ where: { stocktakeId } });

    revalidateStocktake(stocktakeId);
    return {
      ok: true,
      itemId,
      partNumber: item.partNumber,
      counted,
      expected: item.onHand,
      variance: counted - item.onHand,
      counts,
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
