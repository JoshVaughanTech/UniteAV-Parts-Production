/**
 * Fill in Item.rev for boards whose revision is already encoded in their item number.
 *
 *   an3010_e_dsp        -> E      (anNNNN_<rev>_name)
 *   an3140_c_base(DSP)  -> C
 *   CONNECTOR_PCB_REVB  -> B      (…REV<rev>)
 *
 * Only touches boards whose rev is still unset, so re-running is a no-op and a revision
 * typed in the app is never overwritten.
 *
 *   npx tsx scripts/backfill-board-rev.ts --dry
 *   npx tsx scripts/backfill-board-rev.ts
 */
import { prisma } from "@/lib/prisma";

const dry = process.argv.includes("--dry");

/** The revision letter carried by an item number, if it carries one. */
export function revFromPartNumber(partNumber: string): string | null {
  const coded = partNumber.match(/^an\d{4}_([a-z])_/i);
  if (coded) return coded[1].toUpperCase();
  const suffixed = partNumber.match(/REV([A-Z])\b/i);
  if (suffixed) return suffixed[1].toUpperCase();
  return null;
}

async function main() {
  const boards = await prisma.item.findMany({
    where: { type: "ASSEMBLY" },
    orderBy: { partNumber: "asc" },
    select: { id: true, partNumber: true, name: true, rev: true },
  });

  let set = 0;
  for (const b of boards) {
    const rev = revFromPartNumber(b.partNumber);
    const action = b.rev ? `keep ${b.rev}` : rev ? `-> ${rev}` : "no rev in the number";
    console.log(`  ${b.partNumber.padEnd(26)} ${action}`);
    if (b.rev || !rev) continue;
    if (!dry) await prisma.item.update({ where: { id: b.id }, data: { rev } });
    set++;
  }

  console.log(`\n${dry ? "would set" : "set"} rev on ${set} of ${boards.length} board(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
