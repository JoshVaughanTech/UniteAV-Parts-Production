"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { assessRemoval, applyRemoval, type RemovalImpact } from "@/lib/item-removal";

/** Every page whose content can change when an item leaves or rejoins the catalogue. */
const AFFECTED_PAGES = ["/products", "/parts", "/to-order", "/production", "/count", "/purchase-orders", "/"];

/** What would happen if this item were removed — drives the confirmation dialog. */
export async function assessItemRemoval(
  itemId: string,
): Promise<{ ok: true; impact: RemovalImpact } | { ok: false; error: string }> {
  try {
    await requireRole("ADMIN");
    const impact = await assessRemoval(itemId);
    if (!impact) return { ok: false, error: "Item not found." };
    return { ok: true, impact };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not assess this item." };
  }
}

/** Delete or archive an item, then rebuild the products that depended on it. */
export async function removeItem(
  itemId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    await requireRole("ADMIN");
    const r = await applyRemoval(itemId);
    for (const path of AFFECTED_PAGES) revalidatePath(path);

    const detached = r.detachedFrom > 0 ? ` Removed from ${r.detachedFrom} BOM(s).` : "";
    const rebuilt = r.rebuilt.length > 0 ? ` Rebuilt ${r.rebuilt.join(", ")}.` : "";
    return {
      ok: true,
      message:
        r.verdict === "DELETE"
          ? `Deleted ${r.partNumber}.${detached}${rebuilt}`
          : `Archived ${r.partNumber} — kept ${r.preserved.join(", ")}.${detached}${rebuilt}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

/** Bring an archived item back into the catalogue (not back onto any BOM). */
export async function restoreItem(itemId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    await requireRole("ADMIN");
    const item = await prisma.item.update({ where: { id: itemId }, data: { active: true } });
    for (const path of AFFECTED_PAGES) revalidatePath(path);
    return {
      ok: true,
      message: `Restored ${item.partNumber}. It is back in the catalogue but not on any BOM — re-add it where it belongs.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Restore failed." };
  }
}
