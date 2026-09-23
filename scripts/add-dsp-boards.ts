/**
 * Add the AN3142 DSP and AN3143 OLED boards to the DSP Unit, and reconcile the
 * AN3170 video board against its build (pick-and-place) export.
 *
 * Three files, three shapes:
 *   an3142_a_dsp / an3143_a_oled — ordinary Altium purchasing BOMs -> new ASSEMBLY boards
 *   Build-an3170_c_video.xlsm    — a placement export (one row per designator, Fitted
 *                                  flag, no Quantity column). Imported through the build
 *                                  path so DNP placements are dropped and the Comment is
 *                                  read as a value, not as a description.
 *
 * Costs: only parts CREATED by this run take a price from the sheet — an existing part's
 * cost is owned by POs and the master price sheets, and is never touched here.
 *
 *   npx tsx scripts/add-dsp-boards.ts --dry   # parse + report, write nothing
 *   npx tsx scripts/add-dsp-boards.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { clean, parseBomFile } from "@/lib/bom/parse";
import { importBom } from "@/lib/bom/import";
import { explodeProduct } from "@/lib/bom/explode";
import { setItemCost } from "@/lib/pricing";

const dir = join(process.cwd(), "sample-boms");
const dry = process.argv.includes("--dry");

const BOARDS = [
  { file: "Bill of Materials Purchasing-an3142_a_dsp(DSP).xlsx", partNumber: "an3142_a_dsp", name: "AN3142 DSP" },
  {
    file: "Bill of Materials Purchasing-an3143_a_oled(DISPLAY) - Copy.xlsx",
    partNumber: "an3143_a_oled",
    name: "AN3143 OLED Display",
  },
];
const VIDEO_BUILD = "Bill of Materials Build-an3170_c_video(PRODUCTION).xlsm";
const VIDEO_PN = "an3170_c_video";
const PRODUCT_PN = "PROD-DSP";

/** "Price each" per item number, where the sheet carries one. */
function pricesFrom(file: string): Map<string, number> {
  const wb = XLSX.read(readFileSync(join(dir, file)), { type: "buffer" });
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
    raw: false,
  });
  const header = (aoa[0] ?? []).map((c) => clean(c).toLowerCase());
  const iPn = header.indexOf("item number");
  const iPrice = header.findIndex((h) => h === "price each" || h === "cost each");
  const out = new Map<string, number>();
  if (iPn < 0 || iPrice < 0) return out;
  for (const r of aoa.slice(1)) {
    const pn = clean(r[iPn]);
    const price = Number(clean(r[iPrice]).replace(/[$,\s]/g, ""));
    if (pn && Number.isFinite(price) && price > 0) out.set(pn, price);
  }
  return out;
}

async function main() {
  const newBoardIds: string[] = [];

  for (const b of BOARDS) {
    const buf = readFileSync(join(dir, b.file));
    const parsed = parseBomFile(b.file, buf);
    const prices = pricesFrom(b.file);
    const known = await prisma.item.findMany({
      where: { partNumber: { in: parsed.rows.map((r) => r.partNumber) } },
      select: { partNumber: true },
    });
    const knownPns = new Set(known.map((i) => i.partNumber));
    const fresh = parsed.rows.filter((r) => !knownPns.has(r.partNumber));

    console.log(`\n=== ${b.name} [${b.partNumber}] — ${b.file}`);
    console.log(`  ${parsed.rows.length} lines, ${fresh.length} new part(s)`);
    for (const w of parsed.warnings) console.log(`  ! ${w}`);
    for (const f of fresh) {
      const p = prices.get(f.partNumber);
      console.log(`  NEW  ${f.partNumber.padEnd(14)} x${String(f.qtyPer).padEnd(3)} ${p != null ? `$${p}` : "no price in sheet"}  "${f.name.slice(0, 44)}"`);
    }
    if (dry) continue;

    const s = await importBom({ partNumber: b.partNumber, name: b.name, type: "ASSEMBLY" }, parsed.rows, {
      filename: b.file,
    });
    newBoardIds.push(s.productItemId);
    console.log(`  imported: ${s.linesUpserted} lines, ${s.partsCreated} parts created, ${s.partsUpdated} updated`);

    // Price only what this run created — nothing else in the system knows these parts yet.
    let priced = 0;
    for (const f of fresh) {
      const cost = prices.get(f.partNumber);
      if (cost == null) continue;
      const item = await prisma.item.findUnique({ where: { partNumber: f.partNumber }, select: { id: true } });
      if (!item) continue;
      await setItemCost(item.id, cost, `BOM import — ${b.file}`);
      priced++;
    }
    console.log(`  priced ${priced} newly-created part(s) from the sheet`);
  }

  // --- AN3170 video board, from its build export ---
  const vbuf = readFileSync(join(dir, VIDEO_BUILD));
  const vparsed = parseBomFile(VIDEO_BUILD, vbuf);
  console.log(`\n=== ${VIDEO_PN} — ${VIDEO_BUILD}`);
  for (const w of vparsed.warnings) console.log(`  ! ${w}`);

  const existing = await prisma.item.findUnique({
    where: { partNumber: VIDEO_PN },
    include: { bomParents: { include: { child: { select: { partNumber: true } } } } },
  });
  if (!existing) {
    console.log(`  ${VIDEO_PN} not in the catalog — skipping.`);
  } else {
    const dbQty = new Map(existing.bomParents.map((l) => [l.child.partNumber, l.qtyPer]));
    const added = vparsed.rows.filter((r) => !dbQty.has(r.partNumber));
    const dropped = [...dbQty.keys()].filter((p) => !vparsed.rows.some((r) => r.partNumber === p));
    const changed = vparsed.rows.filter((r) => dbQty.has(r.partNumber) && dbQty.get(r.partNumber) !== r.qtyPer);
    console.log(`  stored BOM ${dbQty.size} lines vs build file ${vparsed.rows.length}`);
    console.log(`  + ${added.length} added: ${added.map((a) => `${a.partNumber} x${a.qtyPer}`).join(", ") || "none"}`);
    console.log(`  - ${dropped.length} dropped: ${dropped.join(", ") || "none"}`);
    console.log(`  ~ ${changed.length} qty changed: ${changed.map((c) => `${c.partNumber} ${dbQty.get(c.partNumber)}->${c.qtyPer}`).join(", ") || "none"}`);

    if (!dry) {
      // preserveMissing: a build export has no description column, so existing part
      // names must survive the import untouched.
      const s = await importBom({ partNumber: VIDEO_PN, name: existing.name, type: "ASSEMBLY" }, vparsed.rows, {
        filename: VIDEO_BUILD,
        preserveMissing: true,
      });
      console.log(`  imported: ${s.linesUpserted} lines, ${s.partsCreated} created, ${s.linesRemoved} removed`);

      // MECH-00046 arrives from the build file with no description of its own.
      const mech = await prisma.item.findUnique({ where: { partNumber: "MECH-00046" } });
      if (mech && (mech.name === "MECH-00046" || !mech.name)) {
        await prisma.item.update({
          where: { id: mech.id },
          data: { name: "M3 Clear Hole", value: "M3_CLEAR_HOLE", footprint: "M3_CLEAR_HOLE" },
        });
        console.log(`  named MECH-00046 "M3 Clear Hole" (no description in the build file — correct it if wrong)`);
      }
    }
  }

  if (dry) {
    console.log("\n(dry run — nothing written)");
    await prisma.$disconnect();
    return;
  }

  // --- Fit the two new boards to the DSP Unit ---
  const product = await prisma.item.findUnique({ where: { partNumber: PRODUCT_PN } });
  if (!product) throw new Error(`${PRODUCT_PN} not found`);
  for (const id of newBoardIds) {
    await prisma.bomLine.upsert({
      where: { parentItemId_childItemId: { parentItemId: product.id, childItemId: id } },
      create: { parentItemId: product.id, childItemId: id, qtyPer: 1 },
      update: { qtyPer: 1 },
    });
  }
  console.log(`\nFitted ${newBoardIds.length} new board(s) to ${product.name}.`);

  // The exploded cache is keyed by product; sweep any rows left against a board.
  const nonProducts = await prisma.item.findMany({ where: { type: { not: "PRODUCT" } }, select: { id: true } });
  const swept = await prisma.explodedBom.deleteMany({
    where: { productItemId: { in: nonProducts.map((i) => i.id) } },
  });
  if (swept.count > 0) console.log(`Swept ${swept.count} exploded-cache row(s) held against boards.`);

  for (const pn of [PRODUCT_PN, "PROD-ENCDEC"]) {
    const p = await prisma.item.findUnique({ where: { partNumber: pn }, select: { id: true, name: true } });
    if (!p) continue;
    await explodeProduct(p.id);
    const leaves = await prisma.explodedBom.count({ where: { productItemId: p.id } });
    console.log(`Re-exploded ${p.name}: ${leaves} leaf parts`);
  }

  const [products, assemblies, parts, lines] = await Promise.all([
    prisma.item.count({ where: { type: "PRODUCT" } }),
    prisma.item.count({ where: { type: "ASSEMBLY" } }),
    prisma.item.count({ where: { type: "PART" } }),
    prisma.bomLine.count(),
  ]);
  console.log(`\nDone. ${products} products, ${assemblies} boards, ${parts} parts, ${lines} BOM lines.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
