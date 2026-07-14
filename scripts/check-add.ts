import { prisma } from "@/lib/prisma";

async function main() {
  const p = await prisma.item.findUniqueOrThrow({ where: { partNumber: "PROD-AMPONE-V2" } });
  const boards = await prisma.bomLine.findMany({ where: { parentItemId: p.id }, include: { child: true } });
  const leaves = await prisma.explodedBom.findMany({ where: { productItemId: p.id }, include: { leaf: true } });
  const cost = leaves.reduce((s, l) => s + l.totalQtyPer * (l.leaf.unitCost ?? 0), 0);
  console.log(`${p.name}: boards = ${boards.map((b) => b.child.partNumber).join(", ")}`);
  console.log(`  exploded parts: ${leaves.length}, parts cost/unit: A$${cost.toFixed(2)}`);

  for (const pn of ["an3127_c_main", "an3120_b_cpu"]) {
    const b = await prisma.item.findUnique({ where: { partNumber: pn } });
    console.log(`  ${pn}: type=${b?.type}`);
  }

  // Preserved on-hand check
  for (const pn of ["CAPS-00085", "RESS-00571"]) {
    const it = await prisma.item.findUnique({ where: { partNumber: pn } });
    console.log(`  ${pn}: onHand=${it?.onHand} (should be unchanged from your counts)`);
  }
  await prisma.$disconnect();
}
main();
