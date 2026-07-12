import type { Prisma } from "@prisma/client";
import type { TxnType } from "@/lib/constants";

/**
 * Post an inventory movement: append a ledger row and update the mirrored
 * on-hand balance on the item, in one transaction.
 */
export async function applyTxn(
  tx: Prisma.TransactionClient,
  args: {
    itemId: string;
    qtyDelta: number;
    type: TxnType;
    refType?: string;
    refId?: string;
    note?: string;
    userId?: string;
  },
): Promise<void> {
  await tx.inventoryTxn.create({
    data: {
      itemId: args.itemId,
      qtyDelta: args.qtyDelta,
      type: args.type,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      note: args.note ?? null,
      userId: args.userId ?? null,
    },
  });
  await tx.item.update({
    where: { id: args.itemId },
    data: { onHand: { increment: args.qtyDelta } },
  });
}
