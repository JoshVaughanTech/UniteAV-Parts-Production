"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { applyTxn } from "@/lib/inventory";

/** Set a part's on-hand to a counted value (physical count). Records a COUNT ledger entry. */
export async function setStockCount(
  itemId: string,
  count: number,
): Promise<{ ok: boolean; onHand?: number; error?: string }> {
  try {
    const user = await requireRole("OPERATOR");
    if (!itemId || !Number.isFinite(count) || count < 0) return { ok: false, error: "Invalid count." };
    const item = await prisma.item.findUnique({ where: { id: itemId } });
    if (!item) return { ok: false, error: "Part not found." };

    const delta = count - item.onHand;
    if (delta !== 0) {
      await prisma.$transaction((tx) =>
        applyTxn(tx, { itemId, qtyDelta: delta, type: "COUNT", note: "Stock count", userId: user.id }),
      );
    }
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, onHand: count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to set count." };
  }
}
