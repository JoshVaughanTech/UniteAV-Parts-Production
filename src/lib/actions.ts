"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/rbac";
import { applyTxn } from "@/lib/inventory";
import { parseBomFile } from "@/lib/bom/parse";
import { importBom, productMetaFromFilename } from "@/lib/bom/import";
import { parseTopLevel, applyTopLevel } from "@/lib/bom/toplevel";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function num(v: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Log a day's production of a product; consume exploded parts from inventory. */
export async function logProduction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("OPERATOR");
    const productItemId = String(formData.get("productItemId") ?? "");
    const qtyBuilt = Math.floor(num(formData.get("qtyBuilt")));
    const dateStr = String(formData.get("date") ?? "");
    const note = String(formData.get("note") ?? "").trim() || undefined;

    if (!productItemId) return { ok: false, error: "Choose a product." };
    if (qtyBuilt <= 0) return { ok: false, error: "Quantity built must be greater than 0." };
    const date = dateStr ? new Date(dateStr) : new Date();

    const leaves = await prisma.explodedBom.findMany({ where: { productItemId } });
    if (leaves.length === 0) return { ok: false, error: "This product has no BOM parts to consume." };

    await prisma.$transaction(
      async (tx) => {
        const log = await tx.productionLog.create({
          data: { productItemId, qtyBuilt, date, note, userId: user.id },
        });
        // Ledger rows in one insert...
        await tx.inventoryTxn.createMany({
          data: leaves.map((leaf) => ({
            itemId: leaf.leafPartId,
            qtyDelta: -(qtyBuilt * leaf.totalQtyPer),
            type: "BUILD_CONSUMPTION",
            refType: "ProductionLog",
            refId: log.id,
            userId: user.id,
          })),
        });
        // ...and all on-hand decrements in one statement.
        const values = leaves
          .map((leaf) => `('${leaf.leafPartId}',${-(qtyBuilt * leaf.totalQtyPer)})`)
          .join(",");
        await tx.$executeRawUnsafe(
          `UPDATE "Item" AS i SET "onHand" = i."onHand" + v.delta FROM (VALUES ${values}) AS v(id, delta) WHERE i.id = v.id`,
        );
      },
      { timeout: 60000, maxWait: 20000 },
    );

    // Flag any consumed parts that are now at or below zero.
    const zeroed = await prisma.item.count({
      where: { id: { in: leaves.map((l) => l.leafPartId) }, onHand: { lte: 0 } },
    });

    revalidatePath("/production");
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    const base = `Logged ${qtyBuilt} unit(s); consumed ${leaves.length} part types.`;
    return {
      ok: true,
      message: zeroed > 0 ? `${base} ⚠ ${zeroed} part(s) now at/below zero — flagged for reorder (see To-Order).` : base,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to log production." };
  }
}

/** Reverse a production log: restore consumed stock and delete its ledger rows + the log. */
export async function reverseProduction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("MANAGER");
    const logId = String(formData.get("logId") ?? "");
    if (!logId) return { ok: false, error: "Missing log id." };

    void user;
    await prisma.$transaction(
      async (tx) => {
        // Restore stock: subtract this log's net delta per item in one statement.
        await tx.$executeRawUnsafe(
          `UPDATE "Item" AS i SET "onHand" = i."onHand" - agg.d
           FROM (SELECT "itemId", SUM("qtyDelta") AS d FROM "InventoryTxn"
                 WHERE "refType" = 'ProductionLog' AND "refId" = $1 GROUP BY "itemId") AS agg
           WHERE i.id = agg."itemId"`,
          logId,
        );
        await tx.inventoryTxn.deleteMany({ where: { refType: "ProductionLog", refId: logId } });
        await tx.productionLog.delete({ where: { id: logId } });
      },
      { timeout: 60000, maxWait: 20000 },
    );

    revalidatePath("/production");
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: "Production entry reversed; stock restored." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reverse production." };
  }
}

/** Receive stock (positive) or record an adjustment for a single part. */
export async function receiveStock(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("OPERATOR");
    const itemId = String(formData.get("itemId") ?? "");
    const qty = num(formData.get("qty"));
    const mode = String(formData.get("mode") ?? "RECEIPT"); // RECEIPT | ADJUSTMENT | COUNT
    const note = String(formData.get("note") ?? "").trim() || undefined;
    if (!itemId) return { ok: false, error: "Missing part." };

    await prisma.$transaction(async (tx) => {
      if (mode === "COUNT") {
        // Set on-hand to an absolute counted value.
        const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
        await applyTxn(tx, {
          itemId,
          qtyDelta: qty - item.onHand,
          type: "COUNT",
          note: note ?? `Physical count set to ${qty}`,
          userId: user.id,
        });
      } else {
        await applyTxn(tx, {
          itemId,
          qtyDelta: qty,
          type: mode === "ADJUSTMENT" ? "ADJUSTMENT" : "RECEIPT",
          note,
          userId: user.id,
        });
      }
    });

    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: "Inventory updated." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update inventory." };
  }
}

/** Edit a part's planning fields (lead time, safety stock, pack qty, cost, supplier). */
export async function updatePart(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("MANAGER");
    const itemId = String(formData.get("itemId") ?? "");
    if (!itemId) return { ok: false, error: "Missing part." };

    const leadRaw = String(formData.get("leadTimeDays") ?? "").trim();
    const costRaw = String(formData.get("unitCost") ?? "").trim();
    const supplierId = String(formData.get("supplierId") ?? "").trim();

    await prisma.item.update({
      where: { id: itemId },
      data: {
        leadTimeDays: leadRaw === "" ? null : Math.max(0, Math.floor(Number(leadRaw))),
        safetyStock: Math.max(0, num(formData.get("safetyStock"))),
        minPackQty: Math.max(1, num(formData.get("minPackQty"), 1)),
        unitCost: costRaw === "" ? null : Math.max(0, Number(costRaw)),
        supplierId: supplierId === "" ? null : supplierId,
      },
    });

    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: "Part updated." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update part." };
  }
}

/** Apply planning fields to many parts at once (only the fields provided are changed). */
export async function bulkUpdateParts(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("MANAGER");
    const ids = String(formData.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return { ok: false, error: "No parts selected." };

    const data: Record<string, unknown> = {};
    const supplierId = String(formData.get("supplierId") ?? "");
    if (supplierId === "__none__") data.supplierId = null;
    else if (supplierId) data.supplierId = supplierId;

    const lead = String(formData.get("leadTimeDays") ?? "").trim();
    if (lead !== "") data.leadTimeDays = Math.max(0, Math.floor(Number(lead)));
    const ss = String(formData.get("safetyStock") ?? "").trim();
    if (ss !== "") data.safetyStock = Math.max(0, Number(ss));
    const pack = String(formData.get("minPackQty") ?? "").trim();
    if (pack !== "") data.minPackQty = Math.max(1, Number(pack));
    const cost = String(formData.get("unitCost") ?? "").trim();
    if (cost !== "") data.unitCost = Math.max(0, Number(cost));

    if (Object.keys(data).length === 0) return { ok: false, error: "Fill at least one field to apply." };

    const res = await prisma.item.updateMany({ where: { id: { in: ids } }, data });
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: `Updated ${res.count} part(s).` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bulk update failed." };
  }
}

/** Create or update a supplier. */
export async function upsertSupplier(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("MANAGER");
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Supplier name is required." };
    const data = {
      name,
      email: String(formData.get("email") ?? "").trim() || null,
      contact: String(formData.get("contact") ?? "").trim() || null,
      defaultLeadTimeDays: Math.max(0, Math.floor(num(formData.get("defaultLeadTimeDays"), 14))),
    };
    if (id) await prisma.supplier.update({ where: { id }, data });
    else await prisma.supplier.create({ data });

    revalidatePath("/suppliers");
    revalidatePath("/parts");
    return { ok: true, message: "Supplier saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save supplier." };
  }
}

/** Import a BOM file uploaded via the Import page. */
export async function importBomAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("MANAGER");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a BOM file to upload." };

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseBomFile(file.name, buf);
    if (parsed.rows.length === 0)
      return { ok: false, error: `No parts found. ${parsed.warnings.join(" ") || ""}`.trim() };

    const meta = productMetaFromFilename(file.name);
    // Allow overriding the product label/number from the form.
    const label = String(formData.get("productName") ?? "").trim();
    const pn = String(formData.get("productNumber") ?? "").trim();
    const summary = await importBom(
      { partNumber: pn || meta.partNumber, name: label || meta.name },
      parsed.rows,
      { filename: file.name, userId: user.id },
    );

    revalidatePath("/products");
    revalidatePath("/parts");
    revalidatePath("/import");
    revalidatePath("/");
    return {
      ok: true,
      message: `Imported ${summary.productLabel}: ${summary.linesUpserted} lines, ${summary.partsCreated} new / ${summary.partsUpdated} updated parts.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to import BOM." };
  }
}

/** Create a user with a role (Admin only). */
export async function createUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    const email = String(formData.get("email") ?? "").toLowerCase().trim();
    const name = String(formData.get("name") ?? "").trim() || null;
    const role = String(formData.get("role") ?? "VIEWER");
    const password = String(formData.get("password") ?? "");
    if (!email) return { ok: false, error: "Email is required." };
    if (!ROLES.includes(role as (typeof ROLES)[number])) return { ok: false, error: "Invalid role." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { ok: false, error: "A user with that email already exists." };

    await prisma.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(password, 10) } });
    revalidatePath("/settings");
    return { ok: true, message: `Created ${email} (${role}).` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create user." };
  }
}

/** Change a user's role (Admin only). */
export async function setUserRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    const userId = String(formData.get("userId") ?? "");
    const role = String(formData.get("role") ?? "");
    if (!userId || !ROLES.includes(role as (typeof ROLES)[number])) return { ok: false, error: "Invalid input." };
    await prisma.user.update({ where: { id: userId }, data: { role } });
    revalidatePath("/settings");
    return { ok: true, message: "Role updated." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update role." };
  }
}

/** Import a top-level purchasing sheet to update unit cost + on-hand stock across parts. */
export async function importTopLevelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("MANAGER");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a top-level BOM file." };

    const buf = Buffer.from(await file.arrayBuffer());
    const parse = parseTopLevel(buf);
    if (parse.parts.length === 0)
      return { ok: false, error: `No parts found. ${parse.warnings.join(" ")}`.trim() };

    const s = await applyTopLevel(parse, { userId: user.id });
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/import");
    revalidatePath("/");
    return {
      ok: true,
      message: `Updated ${s.partsSeen} parts — ${s.costUpdated} costs, ${s.stockUpdated} stock levels set${
        s.partsCreated ? `, ${s.partsCreated} new parts created` : ""
      }.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to import top-level BOM." };
  }
}

/** Update global reorder settings. */
export async function updateSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        usageWindowDays: Math.max(1, Math.floor(num(formData.get("usageWindowDays"), 30))),
        reviewPeriodDays: Math.max(1, Math.floor(num(formData.get("reviewPeriodDays"), 7))),
        defaultSafetyStockDays: Math.max(0, Math.floor(num(formData.get("defaultSafetyStockDays"), 7))),
        currency: String(formData.get("currency") ?? "AUD").trim() || "AUD",
      },
    });
    revalidatePath("/settings");
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save settings." };
  }
}
