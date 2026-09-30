"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { ActionResult } from "@/lib/actions";
import { createPartRecord, partInputFromForm } from "@/lib/part-create";

// Same shape as ActionResult so these actions drop straight into <ActionForm>.
export type PartResult = ActionResult;

function text(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}
function revalidateParts(id?: string) {
  if (id) revalidatePath(`/parts/${id}`);
  for (const p of ["/parts", "/products", "/to-order", "/count", "/"]) revalidatePath(p);
}

/**
 * Create a part by hand, for anything that never came off a spreadsheet.
 *
 * The item number is the key every BOM, purchase order and import file joins on, so it
 * must be unique and is kept exactly as typed — imports match on it verbatim. Choosing a
 * number an import will later use is how a hand-made part gets adopted by its BOM.
 */
export async function createPart(_prev: PartResult | null, formData: FormData): Promise<PartResult> {
  try {
    const user = await requireRole("MANAGER");
    const res = await createPartRecord(partInputFromForm(formData), user.id);
    if (!res.ok) return { ok: false, error: `${res.error} Edit that part instead.` };

    revalidateParts();
    return { ok: true, message: `Created ${res.partNumber}. Add it to a BOM from a product or board page.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the part." };
  }
}


/**
 * Edit a part's descriptive fields.
 *
 * These are the fields a BOM import owns — it refreshes description, value, footprint,
 * manufacturer and MPN from the sheet every time. An edit here holds until the next import
 * of a BOM that carries this part, which the UI warns about. Unit of measure and notes are
 * app-only and always survive.
 */
export async function updatePartDetails(_prev: PartResult | null, formData: FormData): Promise<PartResult> {
  try {
    await requireRole("MANAGER");
    const itemId = String(formData.get("itemId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!itemId) return { ok: false, error: "Missing part." };
    if (!name) return { ok: false, error: "Description can't be empty." };

    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { type: true } });
    if (!item) return { ok: false, error: "Part not found." };
    if (item.type !== "PART")
      return { ok: false, error: "Use Rename on a product or board — this form is for parts." };

    await prisma.item.update({
      where: { id: itemId },
      data: {
        name,
        value: text(formData, "value"),
        footprint: text(formData, "footprint"),
        manufacturer: text(formData, "manufacturer"),
        mpn: text(formData, "mpn"),
        uom: text(formData, "uom") ?? "each",
        notes: text(formData, "notes"),
      },
    });

    revalidateParts(itemId);
    return { ok: true, message: "Details saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the details." };
  }
}
