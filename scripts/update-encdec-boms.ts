/**
 * Apply the revised Encode/Decode Unit BOMs (2026-09-28): the three board purchasing
 * exports plus the an3170 price sheet.
 *
 * The board BOMs are structurally unchanged — same lines, same quantities — so this only
 * refreshes descriptive fields. The price sheet carries cost AND stock columns, but its
 * stock numbers are a snapshot that predates recorded consumption: every part it disagrees
 * with has receipts, counts or builds of its own. So cost is taken and on-hand is left to
 * the ledger, which is the same policy scripts/add-boms.ts uses.
 *
 *   npx tsx scripts/update-encdec-boms.ts --dry
 *   npx tsx scripts/update-encdec-boms.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { parseBomFile } from "@/lib/bom/parse";
import { importBom } from "@/lib/bom/import";
import { parseTopLevel, applyTopLevel } from "@/lib/bom/toplevel";

const dir = join(process.cwd(), "sample-boms");
const dry = process.argv.includes("--dry");

const BOARDS = [
  {
    file: "Bill of Materials Purchasing-an3170_c_video(PRODUCTION).xlsx",
    partNumber: "an3170_c_video",
    name: "An3170 C Video — PRODUCTION",
  },
  {
    file: "Bill of Materials Purchasing-an3171_c_oled(an3171_production).xlsx",
    partNumber: "an3171_c_oled",
    name: "An3171 C Oled — an3171_production",
  },
  {
    file: "Bill of Materials Purchasing-an3172_c_audio(an3172_production).xlsx",
    partNumber: "an3172_c_audio",
    name: "An3172 C Audio — an3172_production",
  },
];
const PRICE_SHEET = "Encode Decode Top Level Bom Purchasing.xlsx";

async function main() {
  for (const b of BOARDS) {
    const parsed = parseBomFile(b.file, readFileSync(join(dir, b.file)));
    const existing = await prisma.item.findUnique({
      where: { partNumber: b.partNumber },
      include: { bomParents: { select: { childItemId: true } } },
    });
    console.log(`\n=== ${b.partNumber}`);
    for (const w of parsed.warnings.slice(0, 3)) console.log(`  ! ${w}`);
    console.log(`  ${parsed.rows.length} lines in file, ${existing?.bomParents.length ?? 0} in the catalogue`);
    if (dry) continue;

    const s = await importBom({ partNumber: b.partNumber, name: b.name, type: "ASSEMBLY" }, parsed.rows, {
      filename: b.file,
      preserveMissing: true,
    });
    console.log(`  imported: ${s.linesUpserted} lines, ${s.partsCreated} created, ${s.linesRemoved} removed`);
  }

  console.log(`\n=== ${PRICE_SHEET}`);
  const parse = parseTopLevel(readFileSync(join(dir, PRICE_SHEET)));
  console.log(`  ${parse.parts.length} rows, sections: ${parse.sections.join(", ")}`);
  for (const w of parse.warnings) console.log(`  ! ${w}`);

  // Anything with ledger history owns its own on-hand — the sheet may not have seen the
  // consumption since. Parts with no history at all have no better source than the sheet.
  const managed = await prisma.item.findMany({ where: { invTxns: { some: {} } }, select: { partNumber: true } });
  const preserveStockFor = new Set(managed.map((i) => i.partNumber));
  console.log(`  preserving on-hand for ${preserveStockFor.size} part(s) with ledger history`);

  if (dry) {
    console.log("\n(dry run — nothing written)");
    await prisma.$disconnect();
    return;
  }

  const s = await applyTopLevel(parse, { preserveStockFor });
  console.log(`  ${s.partsSeen} parts seen, ${s.partsCreated} created, ${s.costUpdated} costs updated, ${s.stockUpdated} stock levels set`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
