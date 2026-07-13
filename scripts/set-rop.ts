/**
 * Set the reorder point (safety stock) to 1000 for all CAPS and RESS parts.
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const caps = await prisma.item.updateMany({ where: { partNumber: { startsWith: "CAPS-" } }, data: { safetyStock: 1000 } });
  const ress = await prisma.item.updateMany({ where: { partNumber: { startsWith: "RESS-" } }, data: { safetyStock: 1000 } });
  console.log(`Set reorder point 1000 on ${caps.count} CAPS and ${ress.count} RESS parts.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
