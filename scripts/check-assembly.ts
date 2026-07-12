import { prisma } from "@/lib/prisma";

async function main() {
  for (const pn of ["PROD-ENCDEC", "PROD-DSP", "PROD-AN3010DSP"]) {
    const p = await prisma.item.findUniqueOrThrow({ where: { partNumber: pn } });
    const boards = await prisma.bomLine.findMany({ where: { parentItemId: p.id }, include: { child: true } });
    const leaves = await prisma.explodedBom.findMany({ where: { productItemId: p.id }, include: { leaf: true } });
    const cost = leaves.reduce((s, l) => s + l.totalQtyPer * (l.leaf.unitCost ?? 0), 0);
    const totalPieces = leaves.reduce((s, l) => s + l.totalQtyPer, 0);
    console.log(`\n${p.name} [${pn}]`);
    console.log(`  boards: ${boards.map((b) => b.child.partNumber).join(", ")}`);
    console.log(`  exploded distinct parts: ${leaves.length}, total pieces/unit: ${totalPieces}`);
    console.log(`  parts cost / unit: A$${cost.toFixed(2)}`);
  }
  await prisma.$disconnect();
}
main();
