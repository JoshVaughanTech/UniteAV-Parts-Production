import { prisma } from "@/lib/prisma";
import { categoryFromPartNumber } from "@/lib/constants";
import { explodeProduct } from "@/lib/bom/explode";
import type { TopLevelParse } from "@/lib/bom/toplevel";

const CONNECTOR_PN = "CONNECTOR_PCB_REVB";

/** Finished products and the boards (by part number) they are assembled from. */
export const FINISHED_GOODS: { partNumber: string; name: string; boards: string[] }[] = [
  {
    partNumber: "PROD-ENCDEC",
    name: "Encode/Decode Unit",
    boards: ["an3170_c_video", "an3171_c_oled", "an3172_c_audio", CONNECTOR_PN],
  },
  {
    partNumber: "PROD-DSP",
    name: "DSP Unit",
    boards: ["an3130_a_module(MODULE)", "an3140_c_base(DSP)", "an3140_c_base(AMP)"],
  },
  {
    partNumber: "PROD-AN3010DSP",
    name: "AN3010 DSP Amplifier",
    boards: ["an3010_h_dsp_pca", "an3011_b_control"],
  },
];

/**
 * Build the "Connector PCB" sub-assembly from the top-level BOM's connector section
 * (it has no standalone board BOM file of its own).
 */
export async function buildConnectorPcb(parse: TopLevelParse): Promise<number> {
  const parts = parse.parts.filter((p) => /connector/i.test(p.section));
  if (parts.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    const asm = await tx.item.upsert({
      where: { partNumber: CONNECTOR_PN },
      create: { partNumber: CONNECTOR_PN, name: "Connector PCB (Rev B)", type: "ASSEMBLY" },
      update: { name: "Connector PCB (Rev B)", type: "ASSEMBLY" },
    });

    const keptChildIds: string[] = [];
    for (const cp of parts) {
      let child = await tx.item.findUnique({ where: { partNumber: cp.partNumber } });
      if (!child) {
        child = await tx.item.create({
          data: {
            partNumber: cp.partNumber,
            type: "PART",
            name: cp.name,
            value: cp.value ?? null,
            manufacturer: cp.manufacturer ?? null,
            mpn: cp.mpn ?? null,
            category: categoryFromPartNumber(cp.partNumber),
          },
        });
      }
      keptChildIds.push(child.id);
      await tx.bomLine.upsert({
        where: { parentItemId_childItemId: { parentItemId: asm.id, childItemId: child.id } },
        create: { parentItemId: asm.id, childItemId: child.id, qtyPer: cp.qty },
        update: { qtyPer: cp.qty },
      });
    }
    await tx.bomLine.deleteMany({
      where: { parentItemId: asm.id, childItemId: { notIn: keptChildIds } },
    });
    return parts.length;
  }, { timeout: 120000, maxWait: 20000 });
}

export interface AssembleSummary {
  productsBuilt: { name: string; boards: number; missing: string[] }[];
}

/**
 * Create the finished-goods products, link their boards as sub-assemblies (qty 1),
 * reclassify those boards as ASSEMBLY, and rebuild the exploded cache so a finished
 * product rolls all the way down to leaf parts.
 */
export async function buildFinishedGoods(): Promise<AssembleSummary> {
  const productsBuilt: AssembleSummary["productsBuilt"] = [];

  for (const fg of FINISHED_GOODS) {
    const missing: string[] = [];
    const productId = await prisma.$transaction(async (tx) => {
      const product = await tx.item.upsert({
        where: { partNumber: fg.partNumber },
        create: { partNumber: fg.partNumber, name: fg.name, type: "PRODUCT" },
        update: { name: fg.name, type: "PRODUCT" },
      });

      const keptBoardIds: string[] = [];
      for (const boardPn of fg.boards) {
        const board = await tx.item.findUnique({ where: { partNumber: boardPn } });
        if (!board) {
          missing.push(boardPn);
          continue;
        }
        // Boards become sub-assemblies (no longer standalone products).
        if (board.type !== "ASSEMBLY") await tx.item.update({ where: { id: board.id }, data: { type: "ASSEMBLY" } });
        keptBoardIds.push(board.id);
        await tx.bomLine.upsert({
          where: { parentItemId_childItemId: { parentItemId: product.id, childItemId: board.id } },
          create: { parentItemId: product.id, childItemId: board.id, qtyPer: 1 },
          update: { qtyPer: 1 },
        });
      }
      await tx.bomLine.deleteMany({
        where: { parentItemId: product.id, childItemId: { notIn: keptBoardIds.length ? keptBoardIds : ["__none__"] } },
      });
      return product.id;
    }, { timeout: 120000, maxWait: 20000 });

    await explodeProduct(productId);
    // Drop stale exploded rows for boards that used to be top-level products.
    productsBuilt.push({ name: fg.name, boards: fg.boards.length - missing.length, missing });
  }

  // Clean exploded-cache rows for items that are no longer PRODUCTs (former boards).
  const nonProducts = await prisma.item.findMany({ where: { type: { not: "PRODUCT" } }, select: { id: true } });
  await prisma.explodedBom.deleteMany({ where: { productItemId: { in: nonProducts.map((i) => i.id) } } });

  return { productsBuilt };
}
