/**
 * Add the U74 / UR86 / UR64 chassis products from their product workbooks in sample-boms/.
 *
 * Every component item number in these files already exists in the catalog, so this adds
 * PRODUCT + board-assembly structure plus the chassis parts (metalwork, looms, plugs,
 * carton, knobs) that carry no item number in the source.
 *
 * Existing parts keep their unit cost and on-hand untouched. Only chassis parts created by
 * this run take an initial cost + stock from the sheet.
 *
 *   npx tsx scripts/add-chassis-products.ts --dry    # parse + report, write nothing
 *   npx tsx scripts/add-chassis-products.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { parseWorkbookSheet } from "@/lib/bom/parse";
import { PRODUCT_WORKBOOKS, parseChassisSheet, importProductWorkbook } from "@/lib/bom/product-workbook";

const dir = join(process.cwd(), "sample-boms");
const dry = process.argv.includes("--dry");

async function main() {
  for (const spec of PRODUCT_WORKBOOKS) {
    const file = spec.match.source.replace(/^\^/, "");
    // Resolve the real filename from the directory via the spec's own matcher.
    const { readdirSync } = await import("node:fs");
    const actual = readdirSync(dir).find((f) => spec.match.test(f));
    if (!actual) {
      console.error(`MISSING: no file in sample-boms/ matches ${file}`);
      continue;
    }
    const buf = readFileSync(join(dir, actual));
    console.log(`\n=== ${actual} -> ${spec.name} [${spec.partNumber}] ===`);

    if (dry) {
      for (const b of spec.boards) {
        if (b.reuse) {
          const existing = await prisma.item.findUnique({ where: { partNumber: b.partNumber } });
          const lines = existing ? await prisma.bomLine.count({ where: { parentItemId: existing.id } }) : 0;
          console.log(`  board ${b.partNumber}: REUSE existing assembly (${lines} lines) — ${b.note ?? ""}`);
          continue;
        }
        const p = parseWorkbookSheet(buf, b.sheet);
        const missingCols = ["footprint", "manufacturer", "value"].filter((c) => p.detectedHeader[c] === undefined);
        console.log(
          `  board ${b.partNumber}: ${p.rows.length} parts from "${b.sheet}"` +
            (missingCols.length ? ` — sheet has no ${missingCols.join("/")} column (existing values preserved)` : ""),
        );
        if (p.rows[0]) console.log(`     e.g. ${p.rows[0].partNumber} x${p.rows[0].qtyPer} "${p.rows[0].name.slice(0, 60)}"`);
        for (const w of p.warnings) console.log(`     ! ${w}`);
      }

      const chassis = parseChassisSheet(buf, spec.chassisSheet, spec.skipChassis);
      const existing = new Set(
        (await prisma.item.findMany({ where: { partNumber: { in: chassis.rows.map((r) => r.partNumber) } }, select: { partNumber: true } })).map(
          (i) => i.partNumber,
        ),
      );
      const fitted = chassis.rows.filter((r) => r.qty > 0).length;
      console.log(`  chassis "${spec.chassisSheet}": ${fitted} fitted lines of ${chassis.rows.length} rows`);
      for (const r of chassis.rows) {
        console.log(
          `     ${existing.has(r.partNumber) ? "exists" : "NEW   "} ${r.partNumber.padEnd(26)} x${String(r.qty).padStart(2)}${r.qty > 0 ? " " : "*"} ` +
            `${r.unitCost != null ? `$${r.unitCost.toFixed(4)}` : "no cost"}  stock=${r.stock ?? "-"}  "${r.name}"` +
            (r.supplierNote ? `  [${r.supplierNote.slice(0, 40)}]` : ""),
        );
      }
      console.log(`     (* qty 0 — part created for its price, no BOM line)`);
      for (const w of chassis.warnings) console.log(`     ! ${w}`);
      continue;
    }

    const s = await importProductWorkbook(spec, buf, { filename: actual });
    for (const b of s.boards) console.log(`  board ${b.partNumber}: ${b.lines} lines${b.reused ? " (reused)" : ""}${b.note ? ` — ${b.note}` : ""}`);
    console.log(`  chassis: ${s.chassisLines} lines, ${s.chassisCreated} new parts`);
    console.log(`  product: ${s.leafCount} exploded leaf parts`);
    for (const w of s.warnings) console.log(`  ! ${w}`);
  }

  if (!dry) {
    const [products, assemblies, parts, lines] = await Promise.all([
      prisma.item.count({ where: { type: "PRODUCT" } }),
      prisma.item.count({ where: { type: "ASSEMBLY" } }),
      prisma.item.count({ where: { type: "PART" } }),
      prisma.bomLine.count(),
    ]);
    console.log(`\nDone. ${products} finished products, ${assemblies} boards/assemblies, ${parts} distinct parts, ${lines} BOM lines.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
