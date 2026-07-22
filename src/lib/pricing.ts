import { prisma } from "@/lib/prisma";

/**
 * Set a part's unit cost and append a PriceHistory entry when it actually
 * changes. Zero/invalid means "unknown" and never overwrites a known cost.
 */
export async function setItemCost(
  itemId: string,
  cost: number,
  note?: string,
  userId?: string | null,
): Promise<void> {
  if (!Number.isFinite(cost) || cost <= 0) return;
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { unitCost: true } });
  if (!item || item.unitCost === cost) return;
  await prisma.$transaction([
    prisma.item.update({ where: { id: itemId }, data: { unitCost: cost } }),
    prisma.priceHistory.create({
      data: { itemId, unitCost: cost, previousCost: item.unitCost, note: note ?? null, userId: userId ?? null },
    }),
  ]);
}

/** Log a price change that was already applied to the item elsewhere. */
export async function logPriceChange(
  itemId: string,
  unitCost: number,
  previousCost: number | null,
  note?: string,
  userId?: string | null,
): Promise<void> {
  await prisma.priceHistory.create({
    data: { itemId, unitCost, previousCost, note: note ?? null, userId: userId ?? null },
  });
}
