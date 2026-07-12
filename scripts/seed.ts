import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { parseBomFile } from "@/lib/bom/parse";
import { importBom, productMetaFromFilename } from "@/lib/bom/import";
import { parseTopLevel, parseTopLevelWorkbook, applyTopLevel } from "@/lib/bom/toplevel";
import { buildConnectorPcb, buildFinishedGoods } from "@/lib/bom/assemble";

// Sectioned single-sheet top-level BOM (has section headers + connector section).
const isTopLevel = (f: string) => /top\s*level/i.test(f);
// Multi-sheet master purchasing workbook (price/stock source only).
const isMaster = (f: string) => /all products purchasing/i.test(f);
const isPriceSheet = (f: string) => isTopLevel(f) || isMaster(f);

// Explicit product identity for boards whose filenames don't parse cleanly.
const BOARD_META: { match: RegExp; partNumber: string; name: string }[] = [
  { match: /an3010_h_dsp_pca/i, partNumber: "an3010_h_dsp_pca", name: "AN3010 DSP PCA" },
  { match: /AN3011 B/i, partNumber: "an3011_b_control", name: "AN3011 Control" },
];

async function main() {
  // 1. Settings singleton.
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  // 2. Demo users (one per role) — LOCAL ONLY. Skipped in production so the
  //    shared deployment never ships known "password123" logins.
  //    Set SEED_DEMO_USERS="false" to skip (deployment seeds an admin separately).
  if (process.env.SEED_DEMO_USERS !== "false") {
    const users: { email: string; name: string; role: string }[] = [
      { email: "admin@unite.local", name: "Admin", role: "ADMIN" },
      { email: "manager@unite.local", name: "Manager", role: "MANAGER" },
      { email: "operator@unite.local", name: "Operator", role: "OPERATOR" },
      { email: "viewer@unite.local", name: "Viewer", role: "VIEWER" },
    ];
    const passwordHash = await bcrypt.hash("password123", 10);
    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        create: { ...u, passwordHash },
        update: { name: u.name, role: u.role },
      });
    }
    console.log(`Seeded ${users.length} demo users (password: "password123").`);
  } else {
    console.log("Skipped demo users (SEED_DEMO_USERS=false).");
  }

  // 3. Import every BOM in sample-boms/.
  const dir = join(process.cwd(), "sample-boms");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(xlsx|xls|csv)$/i.test(f));
  } catch {
    console.warn(`No sample-boms/ directory found at ${dir} — skipping BOM import.`);
  }

  // Board BOMs become products; price sheets update cost + stock afterwards.
  const boardFiles = files.filter((f) => !isPriceSheet(f));
  const priceFiles = files.filter(isPriceSheet);

  for (const file of boardFiles) {
    const buf = readFileSync(join(dir, file));
    const parsed = parseBomFile(file, buf);
    const override = BOARD_META.find((m) => m.match.test(file));
    const meta = override ?? productMetaFromFilename(file);
    const summary = await importBom(meta, parsed.rows, { filename: file });
    console.log(
      `Imported "${file}" -> ${meta.name} [${meta.partNumber}]: ` +
        `${summary.linesUpserted} lines, ${summary.partsCreated} new parts, ` +
        `${summary.partsUpdated} updated, ${summary.leafCount} exploded leaves` +
        (parsed.warnings.length ? ` (${parsed.warnings.length} warnings)` : ""),
    );
  }

  let lastTopLevel = null;
  for (const file of priceFiles) {
    const buf = readFileSync(join(dir, file));
    // Single-sheet sectioned top-level vs multi-sheet master workbook.
    const parse = isMaster(file) ? parseTopLevelWorkbook(buf) : parseTopLevel(buf);
    if (isTopLevel(file)) lastTopLevel = parse;
    const s = await applyTopLevel(parse);
    console.log(
      `Price sheet "${file}": ${s.partsSeen} parts (${s.partsCreated} new), ` +
        `${s.costUpdated} costs updated, ${s.stockUpdated} stock levels set. Sheets/sections: ${s.sections.join(", ")}.`,
    );
  }

  // Build finished-goods hierarchy (boards -> sub-assemblies under finished products).
  if (lastTopLevel) {
    const cp = await buildConnectorPcb(lastTopLevel);
    console.log(`Built Connector PCB sub-assembly from ${cp} top-level connector parts.`);
  }
  const asm = await buildFinishedGoods();
  for (const p of asm.productsBuilt) {
    console.log(
      `Finished product "${p.name}": ${p.boards} boards` +
        (p.missing.length ? ` (missing: ${p.missing.join(", ")})` : ""),
    );
  }

  const [products, assemblies, parts, lines] = await Promise.all([
    prisma.item.count({ where: { type: "PRODUCT" } }),
    prisma.item.count({ where: { type: "ASSEMBLY" } }),
    prisma.item.count({ where: { type: "PART" } }),
    prisma.bomLine.count(),
  ]);
  console.log(`\nDone. ${products} finished products, ${assemblies} boards/assemblies, ${parts} distinct parts, ${lines} BOM lines.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
