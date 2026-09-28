"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getSettings } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { planRun } from "@/lib/production/netting";

export type RunResult = { ok: true; message?: string } | { ok: false; error: string };

function revalidateRun(id?: string) {
  if (id) revalidatePath(`/production/${id}`);
  for (const p of ["/production", "/parts", "/to-order", "/purchase-orders", "/"]) revalidatePath(p);
}

async function nextRunNumber(): Promise<string> {
  const count = await prisma.productionRun.count();
  return `RUN-${(count + 1).toString().padStart(4, "0")}`;
}

function intOf(v: FormDataEntryValue | null): number {
  const n = Math.floor(Number(String(v ?? "").trim()));
  return Number.isFinite(n) ? n : 0;
}

/** Start a run from the new-run form: product ids + quantities in parallel fields. */
export async function createRun(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    const user = await requireRole("OPERATOR");
    const ids = formData.getAll("productItemId").map(String);
    const qtys = formData.getAll("qty").map((q) => intOf(q));

    // Same product twice on one run is just a bigger number.
    const merged = new Map<string, number>();
    ids.forEach((id, i) => {
      if (!id || qtys[i] <= 0) return;
      merged.set(id, (merged.get(id) ?? 0) + qtys[i]);
    });
    if (merged.size === 0) return { ok: false, error: "Add at least one product with a quantity." };

    const dateStr = String(formData.get("plannedAt") ?? "");
    const run = await prisma.productionRun.create({
      data: {
        runNumber: await nextRunNumber(),
        status: "PLANNED",
        note: String(formData.get("note") ?? "").trim() || null,
        plannedAt: dateStr ? new Date(dateStr) : null,
        userId: user.id,
        lines: { create: [...merged].map(([productItemId, qtyPlanned]) => ({ productItemId, qtyPlanned })) },
      },
    });
    revalidateRun();
    redirect(`/production/${run.id}`);
  } catch (e) {
    // redirect() throws by design — let it through.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT"))
      throw e;
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the run." };
  }
}

/** Change planned quantities on a run; a quantity of 0 drops the line. */
export async function updateRunLines(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    await requireRole("OPERATOR");
    const runId = String(formData.get("runId") ?? "");
    const run = await prisma.productionRun.findUnique({ where: { id: runId }, include: { lines: true } });
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status !== "PLANNED") return { ok: false, error: "Only a planned run can be changed." };

    let dropped = 0;
    for (const line of run.lines) {
      const qty = intOf(formData.get(`qty_${line.id}`));
      if (qty <= 0) {
        await prisma.productionRunLine.delete({ where: { id: line.id } });
        dropped++;
      } else if (qty !== line.qtyPlanned) {
        await prisma.productionRunLine.update({ where: { id: line.id }, data: { qtyPlanned: qty } });
      }
    }
    revalidateRun(runId);
    return { ok: true, message: dropped > 0 ? `Run updated; ${dropped} line(s) removed.` : "Run updated." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update the run." };
  }
}

/** Add one more product to a planned run. */
export async function addRunLine(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    await requireRole("OPERATOR");
    const runId = String(formData.get("runId") ?? "");
    const productItemId = String(formData.get("productItemId") ?? "");
    const qty = intOf(formData.get("qty"));
    if (!productItemId) return { ok: false, error: "Choose a product." };
    if (qty <= 0) return { ok: false, error: "Quantity must be greater than 0." };

    const existing = await prisma.productionRunLine.findUnique({
      where: { runId_productItemId: { runId, productItemId } },
    });
    if (existing) {
      await prisma.productionRunLine.update({
        where: { id: existing.id },
        data: { qtyPlanned: existing.qtyPlanned + qty },
      });
    } else {
      await prisma.productionRunLine.create({ data: { runId, productItemId, qtyPlanned: qty } });
    }
    revalidateRun(runId);
    return { ok: true, message: "Product added to the run." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add the product." };
  }
}

/**
 * Build the run: consume stock and write the build history.
 *
 * Quantities come from built_<lineId> inputs, defaulting to the planned amount, so a
 * short build is recorded as what actually happened. Consumption follows the same
 * netting the plan showed:
 *   - an assembly is drawn from stock only as far as stock goes; the rest was built
 *     out of its own components, which are consumed in their own right
 *   - a leaf part is consumed in full, so a genuine shortage shows as a negative
 *     balance rather than quietly vanishing
 * A shortfall blocks the build unless `allowShort` is set.
 */
export async function buildRun(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    const user = await requireRole("OPERATOR");
    const runId = String(formData.get("runId") ?? "");
    const allowShort = formData.get("allowShort") === "on";

    const run = await prisma.productionRun.findUnique({
      where: { id: runId },
      include: { lines: { include: { product: { select: { name: true } } } } },
    });
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status !== "PLANNED") return { ok: false, error: `This run is already ${run.status.toLowerCase()}.` };
    if (run.lines.length === 0) return { ok: false, error: "This run has no products on it." };

    const built = run.lines.map((l) => {
      const raw = formData.get(`built_${l.id}`);
      const qty = raw == null || String(raw).trim() === "" ? l.qtyPlanned : intOf(raw);
      return { line: l, qty: Math.max(0, qty) };
    });
    if (built.every((b) => b.qty === 0)) return { ok: false, error: "Nothing to build — every quantity is 0." };

    const tree = await loadBomTree();
    const plan = planRun(
      tree,
      built.filter((b) => b.qty > 0).map((b) => ({ productId: b.line.productItemId, qty: b.qty })),
    );
    if (!plan.fullyCovered && !allowShort) {
      const worst = plan.shortParts
        .slice(0, 3)
        .map((p) => `${p.partNumber} (short ${p.toMake})`)
        .join(", ");
      return {
        ok: false,
        error: `${plan.shortParts.length} part(s) short — ${worst}. Order them, or tick "build anyway" to consume past zero.`,
      };
    }

    // An assembly leaves the shelf only as far as stock went; a leaf part is consumed
    // in full, shortfall included.
    const movements = [...plan.boards, ...plan.parts]
      .map((r) => ({ itemId: r.itemId, qty: tree.childrenOf(r.itemId).length > 0 ? r.fromStock : r.required }))
      .filter((m) => m.qty > 0);

    const date = new Date();
    await prisma.$transaction(
      async (tx) => {
        await tx.productionRun.update({
          where: { id: runId },
          data: { status: "BUILT", builtAt: date },
        });
        for (const b of built) {
          await tx.productionRunLine.update({ where: { id: b.line.id }, data: { qtyBuilt: b.qty } });
          if (b.qty === 0) continue;
          await tx.productionLog.create({
            data: {
              date,
              productItemId: b.line.productItemId,
              qtyBuilt: b.qty,
              note: run.runNumber,
              runId,
              userId: user.id,
            },
          });
        }
        if (movements.length > 0) {
          await tx.inventoryTxn.createMany({
            data: movements.map((m) => ({
              itemId: m.itemId,
              qtyDelta: -m.qty,
              type: "BUILD_CONSUMPTION",
              refType: "ProductionRun",
              refId: runId,
              userId: user.id,
            })),
          });
          const values = movements.map((m) => `('${m.itemId}',${-m.qty})`).join(",");
          await tx.$executeRawUnsafe(
            `UPDATE "Item" AS i SET "onHand" = i."onHand" + v.delta FROM (VALUES ${values}) AS v(id, delta) WHERE i.id = v.id`,
          );
        }
      },
      { timeout: 60000, maxWait: 20000 },
    );

    const negatives = await prisma.item.count({
      where: { id: { in: movements.map((m) => m.itemId) }, onHand: { lt: 0 } },
    });
    revalidateRun(runId);
    const total = built.reduce((s, b) => s + b.qty, 0);
    return {
      ok: true,
      message:
        `Built ${total} unit(s) from ${run.runNumber}; consumed ${movements.length} item type(s).` +
        (negatives > 0 ? ` ⚠ ${negatives} part(s) are now below zero.` : ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not build the run." };
  }
}

/** Undo a built run: restore every movement it made and drop its logs. */
export async function unbuildRun(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    await requireRole("MANAGER");
    const runId = String(formData.get("runId") ?? "");
    const run = await prisma.productionRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status !== "BUILT") return { ok: false, error: "Only a built run can be unbuilt." };

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE "Item" AS i SET "onHand" = i."onHand" - agg.d
           FROM (SELECT "itemId", SUM("qtyDelta") AS d FROM "InventoryTxn"
                 WHERE "refType" = 'ProductionRun' AND "refId" = $1 GROUP BY "itemId") AS agg
           WHERE i.id = agg."itemId"`,
          runId,
        );
        await tx.inventoryTxn.deleteMany({ where: { refType: "ProductionRun", refId: runId } });
        await tx.productionLog.deleteMany({ where: { runId } });
        await tx.productionRunLine.updateMany({ where: { runId }, data: { qtyBuilt: 0 } });
        await tx.productionRun.update({ where: { id: runId }, data: { status: "PLANNED", builtAt: null } });
      },
      { timeout: 60000, maxWait: 20000 },
    );
    revalidateRun(runId);
    return { ok: true, message: `${run.runNumber} unbuilt — stock restored and it is planned again.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not unbuild the run." };
  }
}

/**
 * Delete a run outright. Only a run that has moved no stock can go: a built run holds
 * ledger rows and build history keyed to it, so it has to be unbuilt first — that
 * restores the stock and clears those rows, leaving nothing to orphan.
 */
export async function deleteRun(runId: string): Promise<RunResult> {
  try {
    await requireRole("MANAGER");
    const run = await prisma.productionRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status === "BUILT")
      return { ok: false, error: `${run.runNumber} has been built — unbuild it first, then delete it.` };

    // Belt and braces: a non-built run should own no movements at all.
    const movements = await prisma.inventoryTxn.count({ where: { refType: "ProductionRun", refId: runId } });
    if (movements > 0)
      return { ok: false, error: `${run.runNumber} still has ${movements} stock movement(s) — unbuild it first.` };

    await prisma.productionRun.delete({ where: { id: runId } }); // lines cascade
    revalidateRun();
    return { ok: true, message: `Deleted ${run.runNumber}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete the run." };
  }
}

export async function cancelRun(_prev: RunResult | null, formData: FormData): Promise<RunResult> {
  try {
    await requireRole("OPERATOR");
    const runId = String(formData.get("runId") ?? "");
    const run = await prisma.productionRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status === "BUILT") return { ok: false, error: "Unbuild it first — it has already consumed stock." };
    await prisma.productionRun.update({ where: { id: runId }, data: { status: "CANCELLED" } });
    revalidateRun(runId);
    return { ok: true, message: `${run.runNumber} cancelled.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not cancel the run." };
  }
}

/** Raise draft POs for everything the run is short of, one per supplier. */
export async function orderRunShortfall(formData: FormData): Promise<void> {
  const user = await requireRole("MANAGER");
  const runId = String(formData.get("runId") ?? "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId }, include: { lines: true } });
  if (!run) redirect("/production");

  const [tree, settings] = await Promise.all([loadBomTree(), getSettings()]);
  const plan = planRun(
    tree,
    run.lines.map((l) => ({ productId: l.productItemId, qty: l.qtyPlanned })),
  );
  if (plan.shortParts.length === 0) redirect(`/production/${runId}`);

  const parts = await prisma.item.findMany({
    where: { id: { in: plan.shortParts.map((p) => p.itemId) } },
    select: { id: true, supplierId: true, unitCost: true, minPackQty: true },
  });
  const meta = new Map(parts.map((p) => [p.id, p]));

  // One PO per supplier, unassigned parts collected into their own draft.
  const bySupplier = new Map<string, { supplierId: string | null; lines: { itemId: string; qty: number }[] }>();
  for (const short of plan.shortParts) {
    const m = meta.get(short.itemId);
    const key = m?.supplierId ?? "__none__";
    const pack = Math.max(1, m?.minPackQty ?? 1);
    const g = bySupplier.get(key) ?? { supplierId: m?.supplierId ?? null, lines: [] };
    g.lines.push({ itemId: short.itemId, qty: Math.ceil(short.toMake / pack) * pack });
    bySupplier.set(key, g);
  }

  let firstPoId: string | null = null;
  for (const g of bySupplier.values()) {
    const count = await prisma.purchaseOrder.count();
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${(count + 1).toString().padStart(4, "0")}`,
        supplierId: g.supplierId,
        status: "DRAFT",
        currency: settings.currency,
        notes: `Shortfall for ${run.runNumber}`,
        userId: user.id,
        lines: {
          create: g.lines.map((l) => ({
            itemId: l.itemId,
            qtyOrdered: l.qty,
            unitCost: meta.get(l.itemId)?.unitCost ?? 0,
          })),
        },
      },
    });
    firstPoId ??= po.id;
  }

  revalidateRun(runId);
  redirect(firstPoId ? `/purchase-orders/${firstPoId}` : `/production/${runId}`);
}
