import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { setItemCost } from "@/lib/pricing";

/**
 * Creating a part, shared by the Parts page form and the add-to-BOM form so a part made
 * either way is identical.
 *
 * The item number is the key every BOM, purchase order and import file joins on, so it is
 * kept exactly as typed — an import matches on it verbatim, which is how a hand-made part
 * later gets adopted by its spreadsheet. Stock always starts at zero: on-hand belongs to
 * the ledger, so it arrives by receiving or counting, never by typing it into a create form.
 */
export interface NewPartInput {
  partNumber: string;
  name: string;
  value?: string | null;
  footprint?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  uom?: string | null;
  notes?: string | null;
  unitCost?: number | null;
  supplierId?: string | null;
  leadTimeDays?: number | null;
  safetyStock?: number | null;
  minPackQty?: number | null;
}

export type CreatePartResult =
  | { ok: true; id: string; partNumber: string }
  | { ok: false; error: string };

function text(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}
function numOrNull(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read the new-part fields off a form — shared by the Parts form and the add-to-BOM form. */
export function partInputFromForm(formData: FormData): NewPartInput {
  return {
    partNumber: String(formData.get("partNumber") ?? ""),
    name: String(formData.get("name") ?? ""),
    value: text(formData, "value"),
    footprint: text(formData, "footprint"),
    manufacturer: text(formData, "manufacturer"),
    mpn: text(formData, "mpn"),
    uom: text(formData, "uom"),
    notes: text(formData, "notes"),
    unitCost: numOrNull(formData, "unitCost"),
    supplierId: text(formData, "supplierId"),
    leadTimeDays: numOrNull(formData, "leadTimeDays"),
    safetyStock: numOrNull(formData, "safetyStock"),
    minPackQty: numOrNull(formData, "minPackQty"),
  };
}

export async function createPartRecord(input: NewPartInput, userId?: string | null): Promise<CreatePartResult> {
  const partNumber = input.partNumber.trim();
  const name = input.name.trim();
  if (!partNumber) return { ok: false, error: "Item number is required." };
  if (!name) return { ok: false, error: "Description is required." };
  if (partNumber.length > 80) return { ok: false, error: "Item number is too long." };

  const clash = await prisma.item.findUnique({
    where: { partNumber },
    select: { name: true, active: true },
  });
  if (clash)
    return {
      ok: false,
      error: `${partNumber} already exists ("${clash.name}")${clash.active ? "" : " — archived"}.`,
    };

  const item = await prisma.item.create({
    data: {
      partNumber,
      name,
      type: "PART",
      category: categoryFromPartNumber(partNumber),
      value: input.value ?? null,
      footprint: input.footprint ?? null,
      manufacturer: input.manufacturer ?? null,
      mpn: input.mpn ?? null,
      uom: input.uom ?? "each",
      notes: input.notes ?? null,
      supplierId: input.supplierId ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      safetyStock: Math.max(0, input.safetyStock ?? 0),
      minPackQty: Math.max(1, input.minPackQty ?? 1),
    },
  });
  // Through setItemCost so a hand-made part starts with a price-history entry like any other.
  if (input.unitCost != null && input.unitCost > 0) await setItemCost(item.id, input.unitCost, "Created by hand", userId);

  return { ok: true, id: item.id, partNumber };
}
