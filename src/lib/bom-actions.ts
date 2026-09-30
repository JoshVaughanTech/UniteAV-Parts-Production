"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { explodeProduct } from "@/lib/bom/explode";
import { productsAbove } from "@/lib/item-removal";
import { createPartRecord, partInputFromForm } from "@/lib/part-create";

/**
 * Hand-editing BOM lines. Anything changed here is subject to the same pruning an import
 * does: re-importing a board's BOM rebuilds it from the sheet and drops lines the sheet
 * doesn't carry. The UI says so where you edit.
 */
export type BomResult = { ok: true; message: string } | { ok: false; error: string };

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Products whose exploded requirements change when `itemId`'s own BOM changes. */
async function rebuildAbove(itemId: string): Promise<string[]> {
  const above = await productsAbove(itemId);
  const self = await prisma.item.findUnique({ where: { id: itemId }, select: { type: true, name: true } });
  const targets = self?.type === "PRODUCT" ? [{ id: itemId, name: self.name }, ...above] : above;
  for (const t of targets) await explodeProduct(t.id);
  return targets.map((t) => t.name);
}

function revalidateBom(parentId: string) {
  revalidatePath(`/products/${parentId}`);
  for (const p of ["/products", "/parts", "/to-order", "/production", "/"]) revalidatePath(p);
}

/** Would adding `childId` under `parentId` create a loop? */
async function wouldCycle(parentId: string, childId: string): Promise<boolean> {
  if (parentId === childId) return true;
  const edges = await prisma.bomLine.findMany({ select: { parentItemId: true, childItemId: true } });
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const arr = childrenOf.get(e.parentItemId);
    if (arr) arr.push(e.childItemId);
    else childrenOf.set(e.parentItemId, [e.childItemId]);
  }
  // Walk down from the prospective child: reaching the parent means a loop.
  const seen = new Set<string>();
  const queue = [childId];
  while (queue.length) {
    const cur = queue.pop()!;
    if (cur === parentId) return true;
    for (const next of childrenOf.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Put a part or board onto a product's or board's BOM.
 *
 * If the item number isn't in the catalogue yet and a description came with it, the part is
 * created here and joins the BOM in one step — it then appears in Parts & Inventory like
 * any other, at zero stock until it is received or counted. Without a description the form
 * refuses rather than inventing a nameless part.
 */
export async function addBomLine(_prev: BomResult | null, formData: FormData): Promise<BomResult> {
  try {
    const user = await requireRole("MANAGER");
    const parentItemId = String(formData.get("parentItemId") ?? "");
    const partNumber = String(formData.get("partNumber") ?? "").trim();
    const qtyPer = num(formData.get("qtyPer"));
    const reference = String(formData.get("reference") ?? "").trim() || null;

    if (!partNumber) return { ok: false, error: "Enter an item number." };
    if (qtyPer <= 0) return { ok: false, error: "Quantity must be greater than 0." };

    const parent = await prisma.item.findUnique({ where: { id: parentItemId }, select: { id: true, type: true } });
    if (!parent) return { ok: false, error: "Parent not found." };
    if (parent.type !== "PRODUCT" && parent.type !== "ASSEMBLY")
      return { ok: false, error: "Only a product or board can have a BOM." };

    let child = await prisma.item.findUnique({ where: { partNumber } });
    let created = false;
    if (!child) {
      const name = String(formData.get("name") ?? "").trim();
      if (!name)
        return {
          ok: false,
          error: `"${partNumber}" isn't in the catalogue. Give it a description to create it here.`,
        };
      const res = await createPartRecord({ ...partInputFromForm(formData), partNumber, name }, user.id);
      if (!res.ok) return { ok: false, error: res.error };
      child = await prisma.item.findUniqueOrThrow({ where: { id: res.id } });
      created = true;
    }
    if (!child.active) return { ok: false, error: `${partNumber} is archived — restore it before adding it to a BOM.` };

    const existing = await prisma.bomLine.findUnique({
      where: { parentItemId_childItemId: { parentItemId, childItemId: child.id } },
    });
    if (existing) return { ok: false, error: `${partNumber} is already on this BOM at ×${existing.qtyPer}.` };

    if (await wouldCycle(parentItemId, child.id))
      return { ok: false, error: `That would make the BOM contain itself through ${partNumber}.` };

    await prisma.bomLine.create({ data: { parentItemId, childItemId: child.id, qtyPer, reference } });
    const rebuilt = await rebuildAbove(parentItemId);
    revalidateBom(parentItemId);
    revalidatePath("/count");
    return {
      ok: true,
      message:
        (created ? `Created ${partNumber} and added it ×${qtyPer}.` : `Added ${partNumber} ×${qtyPer}.`) +
        (rebuilt.length ? ` Rebuilt ${rebuilt.join(", ")}.` : "") +
        (created ? " It's in Parts & Inventory at zero stock — receive or count it in." : ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add the line." };
  }
}

