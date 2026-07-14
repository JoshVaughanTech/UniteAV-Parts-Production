/**
 * Incrementally add the AMP One V2 boards + product WITHOUT overwriting existing
 * on-hand counts. Only newly-created parts take their stock from the master sheet;
 * existing parts keep their counted on-hand and just get a price refresh.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { parseBomFile } from "@/lib/bom/parse";
import { importBom } from "@/lib/bom/import";
import { parseTopLevelWorkbook, applyTopLevel } from "@/lib/bom/toplevel";
import { buildFinishedGoods } from "@/lib/bom/assemble";

const dir = join(process.cwd(), "sample-boms");

async function main() {
  // Preserve on-hand for any part that has already been counted/received (has ledger
  // history) — so we never clobber a manually-counted stock level. Freshly-created
  // board parts (no ledger yet) still take their initial stock from the sheet.
  const counted = await prisma.item.findMany({ where: { invTxns: { some: {} } }, select: { partNumber: true } });
  const preserve = new Set(counted.map((i) => i.partNumber));
  console.log(`Preserving on-hand for ${preserve.size} already-managed parts.`);

  // 1. Import the two new boards as products.
  const boards = [
    { file: "Bill of Materials Purchasing-an3127_c_main(S1_Gen2).xlsx", partNumber: "an3127_c_main", name: "AN3127 Main (S1 Gen2)" },
    { file: "Bill of Materials Purchasing-an3120_b_cpu(production).xlsx", partNumber: "an3120_b_cpu", name: "AN3120 CPU" },
  ];
  for (const b of boards) {
    const parsed = parseBomFile(b.file, readFileSync(join(dir, b.file)));
    const s = await importBom({ partNumber: b.partNumber, name: b.name }, parsed.rows, { filename: b.file });
    console.log(`Imported ${b.name} [${b.partNumber}]: ${s.linesUpserted} lines, ${s.partsCreated} new, ${s.partsUpdated} updated`);
  }

  // 2. Cost + stock from the AMP One V2 master — stock only for NEW parts.
  const masterFile = "AMP One V2 Purchasing BOM C Main B CPU (2).xlsx";
  const parse = parseTopLevelWorkbook(readFileSync(join(dir, masterFile)));
  const ms = await applyTopLevel(parse, { preserveStockFor: preserve });
  console.log(
    `Master "${masterFile}": ${ms.partsSeen} parts (${ms.partsCreated} new), ${ms.costUpdated} costs updated, ` +
      `${ms.stockUpdated} stock set (new parts only). Sheets: ${ms.sections.join(", ")}`,
  );

  // 3. Rebuild finished products (adds AMP One V2 = an3127 + an3120).
  const asm = await buildFinishedGoods();
  for (const p of asm.productsBuilt) {
    console.log(`Finished product "${p.name}": ${p.boards} boards${p.missing.length ? ` (missing: ${p.missing.join(", ")})` : ""}`);
  }

  const [products, assemblies, parts, lines] = await Promise.all([
    prisma.item.count({ where: { type: "PRODUCT" } }),
    prisma.item.count({ where: { type: "ASSEMBLY" } }),
    prisma.item.count({ where: { type: "PART" } }),
    prisma.bomLine.count(),
  ]);
  console.log(`\nDone. ${products} finished products, ${assemblies} boards/assemblies, ${parts} distinct parts, ${lines} BOM lines.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
