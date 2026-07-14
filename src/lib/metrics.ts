import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { computeReorder, type ReorderResult } from "@/lib/reorder";

export interface Settings {
  usageWindowDays: number;
  reviewPeriodDays: number;
  defaultSafetyStockDays: number;
  currency: string;
  autoOrderEnabled: boolean;
  autoApproveLimit: number;
}

// cache() dedupes these within a single request/render so repeated calls across
// helpers + the page don't hit the database more than once.
export const getSettings = cache(async (): Promise<Settings> => {
  // Read (not upsert) on the hot path; only create the row if it's somehow missing.
  const s =
    (await prisma.settings.findUnique({ where: { id: 1 } })) ??
    (await prisma.settings.create({ data: { id: 1 } }));
  return {
    usageWindowDays: s.usageWindowDays,
    reviewPeriodDays: s.reviewPeriodDays,
    defaultSafetyStockDays: s.defaultSafetyStockDays,
    currency: s.currency,
    autoOrderEnabled: s.autoOrderEnabled,
    autoApproveLimit: s.autoApproveLimit,
  };
});

/**
 * Average daily usage per part = total BUILD_CONSUMPTION (absolute) over the usage
 * window ÷ window days. Returns a map of itemId -> ADU (units/day).
 */
export const getAduMap = cache(async (windowDays: number): Promise<Map<string, number>> => {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const grouped = await prisma.inventoryTxn.groupBy({
    by: ["itemId"],
    where: { type: "BUILD_CONSUMPTION", createdAt: { gte: since } },
    _sum: { qtyDelta: true },
  });
  const map = new Map<string, number>();
  for (const g of grouped) {
    const consumed = Math.abs(g._sum.qtyDelta ?? 0);
    map.set(g.itemId, consumed / windowDays);
  }
  return map;
});

export interface PartRow {
  id: string;
  partNumber: string;
  name: string;
  category: string | null;
  value: string | null;
  manufacturer: string | null;
  mpn: string | null;
  uom: string;
  onHand: number;
  safetyStock: number;
  minPackQty: number;
  leadTimeDays: number | null;
  unitCost: number | null;
  supplierId: string | null;
  supplierName: string | null;
  usedInCount: number; // how many products/assemblies use this part
  adu: number;
  reorder: ReorderResult;
}

/** All parts (non-product items) enriched with usage + reorder status. */
export const getPartRows = cache(async (): Promise<PartRow[]> => {
  const settings = await getSettings();
  const aduMap = await getAduMap(settings.usageWindowDays);

  // Parts on a SENT purchase order (ordered / partially received) show as "On order".
  const sentOrder = new Set(
    (
      await prisma.purchaseOrderLine.findMany({
        where: { purchaseOrder: { status: { in: ["ORDERED", "PARTIAL"] } } },
        select: { itemId: true },
      })
    ).map((l) => l.itemId),
  );

  const items = await prisma.item.findMany({
    where: { type: { in: ["PART", "ASSEMBLY"] } },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { bomChildren: true } }, // lines where this item is the child (i.e. used by a product)
    },
    orderBy: { partNumber: "asc" },
  });

  return items.map((it) => {
    const adu = aduMap.get(it.id) ?? 0;
    const reorder = computeReorder({
      onHand: it.onHand,
      adu,
      leadTimeDays: it.leadTimeDays,
      safetyStock: it.safetyStock,
      minPackQty: it.minPackQty,
      reviewPeriodDays: settings.reviewPeriodDays,
    });
    // A part that's been ordered (PO sent) is "on order" regardless of stock level.
    if (sentOrder.has(it.id)) reorder.status = "ON_ORDER";
    return {
      id: it.id,
      partNumber: it.partNumber,
      name: it.name,
      category: it.category,
      value: it.value,
      manufacturer: it.manufacturer,
      mpn: it.mpn,
      uom: it.uom,
      onHand: it.onHand,
      safetyStock: it.safetyStock,
      minPackQty: it.minPackQty,
      leadTimeDays: it.leadTimeDays,
      unitCost: it.unitCost,
      supplierId: it.supplierId,
      supplierName: it.supplier?.name ?? null,
      usedInCount: it._count.bomChildren,
      adu,
      reorder,
    };
  });
});

export interface DashboardKpis {
  productCount: number;
  partCount: number;
  reorderCount: number;
  outCount: number;
  lowCount: number;
  inventoryValue: number;
  buildsLast30: number;
}

export async function getDashboardData() {
  const parts = await getPartRows();
  const [productCount, buildsAgg] = await Promise.all([
    prisma.item.count({ where: { type: "PRODUCT" } }),
    prisma.productionLog.aggregate({
      _sum: { qtyBuilt: true },
      where: { date: { gte: new Date(Date.now() - 30 * 864e5) } },
    }),
  ]);

  const kpis: DashboardKpis = {
    productCount,
    partCount: parts.length,
    reorderCount: parts.filter((p) => p.reorder.status === "REORDER" || p.reorder.status === "OUT").length,
    outCount: parts.filter((p) => p.reorder.status === "OUT").length,
    lowCount: parts.filter((p) => p.reorder.status === "LOW").length,
    inventoryValue: parts.reduce((sum, p) => sum + (p.unitCost ?? 0) * p.onHand, 0),
    buildsLast30: buildsAgg._sum.qtyBuilt ?? 0,
  };

  return { parts, kpis };
}

/** Item ids that already sit on an open (draft/ordered/partial) purchase order. */
export async function getOnOrderItemIds(): Promise<Set<string>> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrder: { status: { in: ["DRAFT", "ORDERED", "PARTIAL"] } } },
    select: { itemId: true },
  });
  return new Set(lines.map((l) => l.itemId));
}

/** Parts needing reorder, grouped by supplier, for the To-Order page.
 *  Parts already on an open PO are excluded (so they aren't re-ordered). */
export async function getToOrderBySupplier() {
  const [parts, onOrder] = await Promise.all([getPartRows(), getOnOrderItemIds()]);
  const needing = parts.filter(
    (p) =>
      (p.reorder.status === "REORDER" || p.reorder.status === "OUT") &&
      p.reorder.suggestedOrderQty > 0 &&
      !onOrder.has(p.id),
  );

  const groups = new Map<string, { supplierId: string | null; supplierName: string; parts: PartRow[]; total: number }>();
  for (const p of needing) {
    const key = p.supplierId ?? "__none__";
    const name = p.supplierName ?? "Unassigned supplier";
    const g = groups.get(key) ?? { supplierId: p.supplierId, supplierName: name, parts: [], total: 0 };
    g.parts.push(p);
    g.total += (p.unitCost ?? 0) * p.reorder.suggestedOrderQty;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}
