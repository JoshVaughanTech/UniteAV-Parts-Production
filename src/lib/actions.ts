"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/rbac";
import { applyTxn } from "@/lib/inventory";
import { logPriceChange } from "@/lib/pricing";
import { parseBomFile } from "@/lib/bom/parse";
import { importBom, productMetaFromFilename } from "@/lib/bom/import";
import { parseTopLevel, applyTopLevel } from "@/lib/bom/toplevel";
import { explodeProduct } from "@/lib/bom/explode";
import { runReorderDigest } from "@/lib/email";
import { runAutoOrder } from "@/lib/auto-order";
import { loadBomTree } from "@/lib/bom/rollup";
import { planRun } from "@/lib/production/netting";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function num(v: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Log a build of an SMD board or a finished product, and move the stock it moved.
 *
 * Consumption is netted the same way a production run nets it: an assembly is drawn from
 * stock as far as stock goes and only the shortfall is built from its own components, so
 * logging a product with boards on the shelf doesn't consume those boards' parts twice.
 *
 * Building a board also puts it INTO stock — that is the point of building one, and it is
 * what a later run nets against. Finished products are not stocked: nothing in the system
 * consumes them, so a product build only takes parts out.
 */
export async function logProduction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("OPERATOR");
    const itemId = String(formData.get("productItemId") ?? "");
    const qtyBuilt = Math.floor(num(formData.get("qtyBuilt")));
    const dateStr = String(formData.get("date") ?? "");
    const note = String(formData.get("note") ?? "").trim() || undefined;

    if (!itemId) return { ok: false, error: "Choose what was built." };
    if (qtyBuilt <= 0) return { ok: false, error: "Quantity built must be greater than 0." };
    const date = dateStr ? new Date(dateStr) : new Date();

    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { type: true, partNumber: true, active: true },
    });
    if (!item) return { ok: false, error: "Item not found." };
    if (item.type !== "PRODUCT" && item.type !== "ASSEMBLY")
      return { ok: false, error: "Only an SMD board or a finished product can be built." };
    if (!item.active) return { ok: false, error: `${item.partNumber} is archived.` };

    const tree = await loadBomTree();
    const plan = planRun(tree, [{ productId: itemId, qty: qtyBuilt }]);
    if (plan.boards.length === 0 && plan.parts.length === 0)
      return { ok: false, error: "This item has no BOM to consume — add its lines first." };

    // An assembly leaves the shelf only as far as stock went; a leaf part is consumed in
    // full, so a genuine shortage shows as a negative balance rather than vanishing.
    const isBoard = item.type === "ASSEMBLY";
    const deltas = [...plan.boards, ...plan.parts]
      .map((r) => ({ itemId: r.itemId, delta: -(tree.childrenOf(r.itemId).length > 0 ? r.fromStock : r.required) }))
      .filter((d) => d.delta !== 0);
    const consumedCount = deltas.length;
    if (isBoard) deltas.push({ itemId, delta: qtyBuilt }); // the board itself, now on the shelf

    await prisma.$transaction(
      async (tx) => {
        const log = await tx.productionLog.create({
          data: { productItemId: itemId, qtyBuilt, date, note, userId: user.id },
        });
        await tx.inventoryTxn.createMany({
          data: deltas.map((d) => ({
            itemId: d.itemId,
            qtyDelta: d.delta,
            type: d.delta > 0 ? "BUILD_OUTPUT" : "BUILD_CONSUMPTION",
            refType: "ProductionLog",
            refId: log.id,
            userId: user.id,
          })),
        });
        // Every balance in one statement. Reversing sums these back out by refId.
        const values = deltas.map((d) => `('${d.itemId}',${d.delta})`).join(",");
        await tx.$executeRawUnsafe(
          `UPDATE "Item" AS i SET "onHand" = i."onHand" + v.delta FROM (VALUES ${values}) AS v(id, delta) WHERE i.id = v.id`,
        );
      },
      { timeout: 60000, maxWait: 20000 },
    );

    const zeroed = await prisma.item.count({
      where: { id: { in: deltas.filter((d) => d.delta < 0).map((d) => d.itemId) }, onHand: { lt: 0 } },
    });

    for (const p of ["/production", "/parts", "/products", "/to-order", "/"]) revalidatePath(p);
    const base = isBoard
      ? `Built ${qtyBuilt} × ${item.partNumber} into stock; consumed ${consumedCount} item type(s).`
      : `Logged ${qtyBuilt} unit(s); consumed ${consumedCount} item type(s).`;
    return {
      ok: true,
      message: zeroed > 0 ? `${base} ⚠ ${zeroed} part(s) now below zero — see To-Order.` : base,
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

    // A run's consumption is netted across all its lines, so a single line can't be
    // unwound on its own — the run is unbuilt as a whole.
    const log = await prisma.productionLog.findUnique({ where: { id: logId }, select: { runId: true } });
    if (log?.runId) return { ok: false, error: "This build came from a run — unbuild the run instead." };

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
    const user = await requireRole("MANAGER");
    const itemId = String(formData.get("itemId") ?? "");
    if (!itemId) return { ok: false, error: "Missing part." };

    const leadRaw = String(formData.get("leadTimeDays") ?? "").trim();
    const costRaw = String(formData.get("unitCost") ?? "").trim();
    const supplierId = String(formData.get("supplierId") ?? "").trim();
    const newCost = costRaw === "" ? null : Math.max(0, Number(costRaw));

    const prev = await prisma.item.findUnique({ where: { id: itemId }, select: { unitCost: true } });
    await prisma.item.update({
      where: { id: itemId },
      data: {
        leadTimeDays: leadRaw === "" ? null : Math.max(0, Math.floor(Number(leadRaw))),
        safetyStock: Math.max(0, num(formData.get("safetyStock"))),
        minPackQty: Math.max(1, num(formData.get("minPackQty"), 1)),
        unitCost: newCost,
        supplierId: supplierId === "" ? null : supplierId,
      },
    });
    if (prev && newCost != null && newCost !== prev.unitCost) {
      await logPriceChange(itemId, newCost, prev.unitCost, "Manual edit", user.id);
    }

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
    const user = await requireRole("MANAGER");
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

    // Snapshot previous costs so a bulk cost change lands in each part's price history.
    const prevCosts =
      typeof data.unitCost === "number"
        ? await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, unitCost: true } })
        : [];

    const res = await prisma.item.updateMany({ where: { id: { in: ids } }, data });

    if (typeof data.unitCost === "number") {
      const cost = data.unitCost;
      const changed = prevCosts.filter((p) => p.unitCost !== cost);
      if (changed.length > 0) {
        await prisma.priceHistory.createMany({
          data: changed.map((p) => ({
            itemId: p.id,
            unitCost: cost,
            previousCost: p.unitCost,
            note: "Bulk edit",
            userId: user.id,
          })),
        });
      }
    }
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: `Updated ${res.count} part(s).` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bulk update failed." };
  }
}

// Deleting an item lives in src/lib/item-actions.ts — it has to decide between a hard
// delete and an archive, detach BOM lines and re-explode the products above it.

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
      address: String(formData.get("address") ?? "").trim() || null,
      // Unticked means an overseas supply, which carries no Australian GST. The checkbox
      // is absent from the form data when unticked, so a missing value is a deliberate no.
      chargesGst: formData.get("chargesGst") != null,
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

/**
 * Import a board BOM and say where it belongs.
 *
 * The form names the three things a filename can only guess at: which board this is (an
 * existing one to re-import, or a new one), its revision, and which finished product it is
 * fitted to. Picking a product adds the board to that product's top-level BOM at qty 1 and
 * re-explodes it, so the parts show up in that product's requirements straight away.
 */
export async function importBomAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRole("MANAGER");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a BOM file to upload." };

    const boardId = String(formData.get("boardId") ?? "").trim(); // "" = new board
    const productId = String(formData.get("productItemId") ?? "").trim(); // "" = standalone
    const rev = String(formData.get("rev") ?? "").trim().toUpperCase() || null;

    // Resolve the board's identity before touching the file, so a bad choice fails cheaply.
    let partNumber: string;
    let name: string;
    if (boardId) {
      const board = await prisma.item.findUnique({ where: { id: boardId } });
      if (!board) return { ok: false, error: "That board no longer exists." };
      if (board.type === "PART") return { ok: false, error: `${board.partNumber} is a part, not a board.` };
      partNumber = board.partNumber;
      name = board.name;
    } else {
      const fallback = productMetaFromFilename(file.name);
      partNumber = String(formData.get("newBoardNumber") ?? "").trim() || fallback.partNumber;
      name = String(formData.get("newBoardName") ?? "").trim() || fallback.name;
      const clash = await prisma.item.findUnique({ where: { partNumber }, select: { type: true } });
      if (clash?.type === "PART")
        return { ok: false, error: `${partNumber} already exists as a part — give the board its own item number.` };
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseBomFile(file.name, buf);
    if (parsed.rows.length === 0)
      return { ok: false, error: `No parts found. ${parsed.warnings.join(" ") || ""}`.trim() };

    const summary = await importBom({ partNumber, name, type: "ASSEMBLY", rev }, parsed.rows, {
      filename: file.name,
      userId: user.id,
      // A build/placement export carries no description column; never blank real ones.
      preserveMissing: true,
    });

    // Fit it to the chosen product, then rebuild that product's requirements.
    let fitted = "";
    if (productId) {
      const product = await prisma.item.findUnique({ where: { id: productId }, select: { id: true, name: true, type: true } });
      if (!product || product.type !== "PRODUCT") return { ok: false, error: "That product no longer exists." };
      await prisma.bomLine.upsert({
        where: { parentItemId_childItemId: { parentItemId: product.id, childItemId: summary.productItemId } },
        create: { parentItemId: product.id, childItemId: summary.productItemId, qtyPer: 1 },
        update: {},
      });
      await explodeProduct(product.id);
      fitted = ` Fitted to ${product.name}.`;
    } else {
      // Not under a product, so its own exploded rows would be a second, stale answer.
      await prisma.explodedBom.deleteMany({ where: { productItemId: summary.productItemId } });
    }

    for (const p of ["/products", "/parts", "/import", "/production", "/"]) revalidatePath(p);
    return {
      ok: true,
      message:
        `Imported ${partNumber}${rev ? ` rev ${rev}` : ""}: ${summary.linesUpserted} lines, ` +
        `${summary.partsCreated} new / ${summary.partsUpdated} updated parts.${fitted}` +
        (summary.linesRemoved > 0 ? ` ${summary.linesRemoved} line(s) no longer on the sheet were removed.` : ""),
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

/** Manually send the reorder digest email now (for testing the alert setup). */
export async function sendReorderDigestNow(_prev: ActionResult | null): Promise<ActionResult> {
  try {
    await requireRole("MANAGER");
    const r = await runReorderDigest();
    if (r.skipped && r.reason === "Nothing to reorder")
      return { ok: true, message: "Nothing to reorder right now — no email sent." };
    if (r.skipped) return { ok: false, error: `Email not configured (${r.reason}). Add RESEND_API_KEY in Vercel.` };
    if (!r.ok) return { ok: false, error: `Send failed: ${r.reason}` };
    return { ok: true, message: `Sent reorder digest (${r.lineCount} line[s]) to ${r.recipients} recipient(s).` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send." };
  }
}

/** Update auto-ordering settings (enable + approval $ limit). */
export async function updateAutoOrderSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        autoOrderEnabled: formData.get("autoOrderEnabled") === "on",
        autoApproveLimit: Math.max(0, num(formData.get("autoApproveLimit"), 0)),
      },
    });
    revalidatePath("/settings");
    revalidatePath("/to-order");
    return { ok: true, message: "Auto-ordering settings saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }
}

/** Run the auto-order engine now (manual trigger / test). */
export async function runAutoOrderNow(_prev: ActionResult | null): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    const r = await runAutoOrder();
    if (!r.enabled) return { ok: false, error: "Auto-ordering is turned off — enable it first, above." };
    if (r.created === 0) return { ok: true, message: "Nothing to auto-order (no low parts with an assigned supplier)." };
    revalidatePath("/purchase-orders");
    revalidatePath("/to-order");
    return {
      ok: true,
      message: `Created ${r.created} PO(s): ${r.autoOrdered} auto-ordered, ${r.pendingApproval} awaiting approval.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Auto-order failed." };
  }
}

/** Update global reorder settings. */
/**
 * The letterhead a purchase order goes out under, and the GST rate applied to it.
 *
 * Kept separate from the planning settings above because it is a different kind of thing:
 * these fields are what a supplier reads, and an order sent with them blank is an
 * anonymous request for goods. The PO document says as much until they are filled in.
 */
export async function updateCompanyDetails(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole("ADMIN");
    const text = (key: string) => String(formData.get(key) ?? "").trim() || null;

    await prisma.settings.update({
      where: { id: 1 },
      data: {
        companyName: text("companyName"),
        companyAbn: text("companyAbn"),
        companyAddress: text("companyAddress"),
        companyPhone: text("companyPhone"),
        companyEmail: text("companyEmail"),
        deliverTo: text("deliverTo"),
        poTerms: text("poTerms"),
        // A rate outside 0–100% is a typo, and it would land on every order.
        gstRate: Math.min(1, Math.max(0, num(formData.get("gstRate"), 0.1))),
      },
    });
    revalidatePath("/settings");
    revalidatePath("/purchase-orders");
    return { ok: true, message: "Company details saved. They appear on every purchase order from now on." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save the company details." };
  }
}

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
        // Bounded so a typo can't silently price a whole PO wrong.
        usdRateFallback: Math.min(100, Math.max(0.01, num(formData.get("usdRateFallback"), 0.66))),
      },
    });
    revalidatePath("/settings");
    revalidatePath("/purchase-orders");
    revalidatePath("/parts");
    revalidatePath("/to-order");
    revalidatePath("/");
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save settings." };
  }
}
